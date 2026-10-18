import { Events, type Guild, type GuildMember, type Message } from 'discord.js';
import type { Module } from '../../core/module.js';
import { actOnMember, deleteMessageRefs, postModLog, sweepAuthor } from '../../core/actions.js';
import { emitRaidEnded, emitRaidProgress } from '../../core/bus.js';
import type { Store } from '../../core/db.js';
import { InviteTracker } from './invites.js';
import { RaidEngine, fingerprint, type Account, type RaidPlatform, type TrackedMessage } from './engine.js';

/** Connects the raid engine to the real Discord server. */
function discordPlatform(guild: Guild, store: Store, clientId: () => string): RaidPlatform {
  const cfg = () => store.getConfig(guild.id);
  return {
    now: () => Date.now(),
    guildId: () => guild.id,
    ownerId: () => guild.ownerId,
    meId: clientId,
    trusted: () => cfg().guard.trustedAdmins,
    settings: () => cfg().raid,
    record: (action, userId, text) => store.audit(guild.id, 'raid', action, userId, text),
    announce: text => postModLog(guild, cfg().modLogChannel, text),
    async act(account, action, reason, seconds) {
      const member = guild.members.cache.get(account.id) ?? await guild.members.fetch(account.id).catch(() => null);
      if (!member) return 'already gone';
      return actOnMember(member, action, reason, seconds);
    },
    deleteMessages: (messages, _source) => deleteMessageRefs(guild, messages),
    sweep: (accountId, channelIds) => sweepAuthor(guild, accountId, channelIds),
    async pauseInvites(minutes) {
      try { await guild.disableInvites(true); return `invites paused for ${minutes} min`; }
      catch (e) { return `could not pause invites: ${(e as Error).message} (needs Manage Server)`; }
    },
    async resumeInvites() {
      try { await guild.disableInvites(false); return 'invites resumed'; }
      catch (e) { return `could not resume invites: ${(e as Error).message}`; }
    },
    onProgress: emitRaidProgress,
    onEnded: emitRaidEnded,
  };
}

export const raidModule: Module = {
  id: 'raid',
  register(client, store) {
    const invites = new InviteTracker();
    const engines = new Map<string, RaidEngine>();
    const engineFor = (guild: Guild) => {
      let e = engines.get(guild.id);
      if (!e) { e = new RaidEngine(discordPlatform(guild, store, () => client.user!.id)); engines.set(guild.id, e); }
      return e;
    };

    client.once(Events.ClientReady, c => { for (const g of c.guilds.cache.values()) void invites.snapshot(g); });
    client.on(Events.GuildCreate, g => void invites.snapshot(g));
    client.on(Events.InviteCreate, i => { if (i.guild && 'invites' in i.guild) void invites.snapshot(i.guild as Guild); });

    client.on(Events.GuildMemberAdd, async (member: GuildMember) => {
      if (!store.getConfig(member.guild.id).raid.enabled) return;
      const engine = engineFor(member.guild);
      const account: Account = { id: member.id, tag: member.user.tag, bot: member.user.bot, createdAt: member.user.createdTimestamp, username: member.user.username, hasAvatar: !!member.user.avatar };
      invites.request(member.guild, member.id, inviter => engine.setInviter(member.id, inviter));
      await engine.onJoin(account);
    });

    client.on(Events.MessageCreate, async (msg: Message) => {
      if (!msg.inGuild() || !store.getConfig(msg.guild.id).raid.enabled) return;
      const tracked: TrackedMessage = { id: msg.id, channelId: msg.channelId, authorId: msg.author.id, ts: Date.now(), fp: fingerprint(msg.content) };
      await engineFor(msg.guild).onMessage(tracked);
    });

    // Every 5 seconds: end quiet raids, resume invites, tidy up. Four times a second: delete the batch of spam that has piled up.
    setInterval(() => { for (const e of engines.values()) void e.tick(); }, 5_000).unref();
    setInterval(() => { for (const e of engines.values()) void e.flush(); }, 250).unref();
  },
};
