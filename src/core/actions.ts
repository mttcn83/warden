import { ChannelType, Guild, GuildMember, Message, PermissionFlagsBits, TextChannel } from 'discord.js';
import type { Action } from './config.js';
import type { Store } from './db.js';

export interface ActionCtx { store: Store; module: string; action: Action; reason: string; timeoutSeconds: number; modLog: string | null }

/** Apply a moderation action to the author of `msg`, then audit-log and post to the mod-log channel. */
export async function punish(msg: Message<true>, ctx: ActionCtx): Promise<void> {
  const { action, reason } = ctx;
  const me = msg.guild.members.me;
  const member = msg.member;
  const done: string[] = [];

  try {
    if (msg.deletable) {
      try { await msg.delete(); done.push('deleted message'); }
      catch (e) { if ((e as { code?: number }).code === 10008) done.push('already deleted'); else throw e; } // 10008 = Unknown Message (another rule got there first)
    }
    if (member && me && member.id !== msg.guild.ownerId && me.roles.highest.comparePositionTo(member.roles.highest) > 0) {
      if (action === 'warn') { await msg.author.send(`Warning from ${msg.guild.name}: ${reason}`).catch(() => {}); done.push('warned'); }
      if (action === 'timeout' && me.permissions.has(PermissionFlagsBits.ModerateMembers)) { await member.timeout(ctx.timeoutSeconds * 1000, reason); done.push(`timed out ${ctx.timeoutSeconds}s`); }
      if (action === 'kick' && me.permissions.has(PermissionFlagsBits.KickMembers)) { await member.kick(reason); done.push('kicked'); }
      if (action === 'ban' && me.permissions.has(PermissionFlagsBits.BanMembers)) { await member.ban({ reason }); done.push('banned'); }
    } else if (action !== 'delete') {
      done.push('skipped (target outranks bot or is owner)');
    }
  } catch (e) {
    done.push(`failed: ${(e as Error).message}`);
  }

  const summary = `${ctx.module}: ${reason} -> ${done.join(', ') || 'no-op'}`;
  ctx.store.audit(msg.guild.id, ctx.module, action, msg.author.id, summary);
  if (ctx.modLog) await postModLog(msg.guild, ctx.modLog, removalNotice(msg, ctx.module, reason, done));
}

const PRIVATE_CATEGORIES = /\b(personalInfo|doxxing)\b/;
/** The mod-log line for a removed message: who, where, why, what was done, and the text (hidden for personal info, and never clickable). */
export function removalNotice(msg: Pick<Message<true>, 'author' | 'channelId' | 'content' | 'url'>, module: string, reason: string, done: string[]): string {
  const text = PRIVATE_CATEGORIES.test(reason) ? '(hidden: it contains personal information)' : '`' + msg.content.replace(/[`\n]+/g, ' ').slice(0, 240) + '`';
  return `**Removed** a message from <@${msg.author.id}> in <#${msg.channelId}>\nWhy: ${module}, ${reason}\nDone: ${done.join(', ') || 'nothing'}\n> ${text}`;
}

/** Whether a message author is exempt from automated moderation. */
export function isExempt(msg: Message<true>, exempt: { roles: string[]; channels: string[] }, testMode = false): boolean {
  if (msg.author.bot) return true;
  if (!testMode) {
    if (msg.author.id === msg.guild.ownerId) return true;
    if (msg.member?.permissions.has(PermissionFlagsBits.Administrator)) return true;
  }
  if (exempt.channels.includes(msg.channelId)) return true;
  return !!msg.member?.roles.cache.some(r => exempt.roles.includes(r.id));
}

export interface MessageRef { id: string; channelId: string }
/** Delete messages by id, grouped per channel, using bulk delete where Discord allows it. Returns how many were deleted. */
export async function deleteMessageRefs(guild: Guild, refs: MessageRef[]): Promise<number> {
  let deleted = 0;
  const byChannel = new Map<string, string[]>();
  for (const m of refs) byChannel.set(m.channelId, [...(byChannel.get(m.channelId) ?? []), m.id]);
  for (const [channelId, ids] of byChannel) {
    const ch = guild.channels.cache.get(channelId);
    if (!ch || !ch.isTextBased() || !('bulkDelete' in ch)) continue;
    for (let i = 0; i < ids.length; i += 100) {
      const chunk = ids.slice(i, i + 100);
      try {
        if (chunk.length === 1) { await ch.messages.delete(chunk[0]!); deleted++; }
        else deleted += (await ch.bulkDelete(chunk, true)).size;
      } catch { /* already deleted or missing permission */ }
    }
  }
  return deleted;
}

/** Remove what an account recently posted in the given channels, found by reading their history. Returns how many were deleted. */
export async function sweepAuthor(guild: Guild, authorId: string, channelIds: string[], maxChannels = 12): Promise<number> {
  let deleted = 0;
  for (const channelId of channelIds.slice(0, maxChannels)) {
    const ch = guild.channels.cache.get(channelId);
    if (!ch || !ch.isTextBased() || !('messages' in ch)) continue;
    try {
      const recent = await ch.messages.fetch({ limit: 100 });
      deleted += await deleteMessageRefs(guild, recent.filter(m => m.author.id === authorId).map(m => ({ id: m.id, channelId })));
    } catch { /* no access to this channel */ }
  }
  return deleted;
}

/** Roles that are meant to see the log: anyone who can moderate. Admins see every channel anyway. */
const isModRole = (perms: bigint) => (perms & (PermissionFlagsBits.ModerateMembers | PermissionFlagsBits.KickMembers | PermissionFlagsBits.BanMembers | PermissionFlagsBits.ManageMessages | PermissionFlagsBits.ManageGuild)) !== 0n;

/** Make a private text channel for the mod log: hidden from everyone, visible to moderator roles and the bot. */
export async function createModLogChannel(guild: Guild, name = 'warden-log'): Promise<{ ok: true; channel: TextChannel } | { ok: false; error: string }> {
  const me = guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageChannels)) return { ok: false, error: 'Warden needs the "Manage Channels" permission to create the channel (the Administrator invite has it). Create a private channel yourself and paste its ID instead.' };
  const mods = guild.roles.cache.filter(r => r.id !== guild.id && !r.managed && isModRole(r.permissions.bitfield));
  const see = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory];
  try {
    const channel = await guild.channels.create({
      name, type: ChannelType.GuildText, topic: 'Private. Warden posts what it did and what needs a look. Keep this channel moderators-only.',
      permissionOverwrites: [
        { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
        { id: me.id, allow: [...see, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks] },
        ...mods.map(r => ({ id: r.id, allow: see })),
      ],
      reason: 'Warden: private mod-log channel',
    });
    await channel.send('This is the private Warden log. Warden posts what it removed, who was timed out, raids, and messages that need a moderator to look. Keep it **moderators only** (the channel is already hidden from everyone else).').catch(() => {});
    return { ok: true, channel };
  } catch (e) { return { ok: false, error: `Discord refused: ${(e as Error).message}` }; }
}

/** Can ordinary members read the mod-log channel? Returns a warning when they can. */
export function modLogExposure(guild: Guild, channelId: string | null): { exists: boolean; name?: string; publicTo?: 'everyone' | null } {
  const ch = channelId ? guild.channels.cache.get(channelId) : undefined;
  if (!(ch instanceof TextChannel)) return { exists: false };
  const everyone = guild.roles.everyone;
  return { exists: true, name: ch.name, publicTo: ch.permissionsFor(everyone).has(PermissionFlagsBits.ViewChannel) ? 'everyone' : null };
}

/** Post a line to the server's mod-log channel, if one is set. */
export async function postModLog(guild: Guild, channelId: string | null, text: string): Promise<void> {
  if (!channelId) return;
  const ch = guild.channels.cache.get(channelId);
  if (ch instanceof TextChannel) await ch.send({ content: text.slice(0, 1900), allowedMentions: { parse: [] } }).catch(() => {});
}

/** Timeout / kick / ban a member (not tied to a message). Returns what happened, as text. Respects role hierarchy. */
export async function actOnMember(member: GuildMember, action: 'timeout' | 'kick' | 'ban', reason: string, timeoutSeconds: number): Promise<string> {
  const me = member.guild.members.me;
  if (!me) return 'skipped (bot not ready)';
  if (member.id === member.guild.ownerId) return 'skipped (server owner)';
  if (me.roles.highest.comparePositionTo(member.roles.highest) <= 0) return 'skipped (member outranks bot)';
  try {
    if (action === 'timeout') { if (!me.permissions.has(PermissionFlagsBits.ModerateMembers)) return 'skipped (bot lacks Moderate Members)'; await member.timeout(timeoutSeconds * 1000, reason); return `timed out ${timeoutSeconds}s`; }
    if (action === 'kick') { if (!me.permissions.has(PermissionFlagsBits.KickMembers)) return 'skipped (bot lacks Kick Members)'; await member.kick(reason); return 'kicked'; }
    if (!me.permissions.has(PermissionFlagsBits.BanMembers)) return 'skipped (bot lacks Ban Members)';
    await member.ban({ reason }); return 'banned';
  } catch (e) { return `failed: ${(e as Error).message}`; }
}
