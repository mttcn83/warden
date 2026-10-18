import { AuditLogEvent, type Guild, type GuildMember } from 'discord.js';
import type { Module } from '../../core/module.js';
import { onRaidEnded, onRaidProgress } from '../../core/bus.js';
import { postModLog } from '../../core/actions.js';
import type { Store } from '../../core/db.js';
import { isDangerous } from './logic.js';
import { runGuard, type GuardPlatform } from './engine.js';

/** Connects the guard engine to the real Discord server. */
function discordPlatform(guild: Guild, store: Store, meId: string): GuardPlatform {
  async function stripRoles(member: GuildMember, which: 'all' | 'dangerous', shadow: boolean, reason: string): Promise<string> {
    const removable = member.roles.cache.filter(r => r.id !== guild.id && !r.managed && r.editable && (which === 'all' || isDangerous(r.permissions)));
    if (!removable.size) return which === 'all' ? 'had no removable roles' : 'had no removable dangerous roles (roles above the bot cannot be changed)';
    const names = removable.map(r => r.name).join(', ');
    if (shadow) return `would remove roles: ${names}`;
    try { await member.roles.remove(removable.map(r => r.id), reason); return `removed roles: ${names}`; }
    catch (e) { return `failed: ${(e as Error).message}`; }
  }
  return {
    ownerId: () => guild.ownerId,
    meId: () => meId,
    async fetchAccount(id) { const m = await guild.members.fetch(id).catch(() => null); return m ? { id, tag: m.user.tag, bot: m.user.bot } : null; },
    async stripRoles(id, which, shadow, reason) {
      const m = await guild.members.fetch(id).catch(() => null);
      return m ? stripRoles(m, which, shadow, reason) : 'not in the server';
    },
    async findLetIn(report, lookbackMs) {
      const since = report.startedAt - lookbackMs, raid = new Set(report.memberIds);
      const botAdd: { id: string; target?: string | null }[] = [], grants: { id: string; target?: string | null }[] = [], roleEditors: string[] = [];
      try {
        const bots = await guild.fetchAuditLogs({ type: AuditLogEvent.BotAdd, limit: 50 });
        for (const e of bots.entries.values()) if (e.createdTimestamp >= since && e.executorId && (raid.has(e.targetId ?? '') || !e.targetId)) botAdd.push({ id: e.executorId, target: e.targetId });
        const roles = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberRoleUpdate, limit: 100 });
        for (const e of roles.entries.values()) if (e.createdTimestamp >= since && e.executorId && raid.has(e.targetId ?? '')) grants.push({ id: e.executorId, target: e.targetId });
        // Someone who gave a role dangerous permissions while raiders were holding it
        const heldByRaiders = new Set<string>();
        for (const id of raid) guild.members.cache.get(id)?.roles.cache.forEach(r => { if (isDangerous(r.permissions)) heldByRaiders.add(r.id); });
        if (heldByRaiders.size) {
          const edits = await guild.fetchAuditLogs({ type: AuditLogEvent.RoleUpdate, limit: 50 });
          for (const e of edits.entries.values()) if (e.createdTimestamp >= since && e.executorId && heldByRaiders.has(e.targetId ?? '')) roleEditors.push(e.executorId);
        }
      } catch (e) { store.audit(guild.id, 'guard', 'error', guild.id, `could not read the audit log: ${(e as Error).message} (needs View Audit Log)`); }
      const botIds = [...new Set([...report.inviterIds, ...botAdd.map(b => b.id), ...grants.map(g => g.id), ...roleEditors])].filter(id => guild.client.users.cache.get(id)?.bot);
      return { botAdd, grants, roleEditors, botIds };
    },
    record: (action, userId, text) => store.audit(guild.id, 'guard', action, userId, text),
    announce: text => postModLog(guild, store.getConfig(guild.id).modLogChannel, text),
  };
}

export const guardModule: Module = {
  id: 'guard',
  register(client, store) {
    const handled = new Map<string, Set<string>>(); // per server and raid: who the guard already dealt with
    const lastEarly = new Map<string, number>();
    const key = (r: { guildId: string; startedAt: number }) => `${r.guildId}:${r.startedAt}`;
    // While a raid is still going on, deal with whoever clearly let it in. Looks at the audit log at most every 20 seconds.
    onRaidProgress(async report => {
      const guild = client.guilds.cache.get(report.guildId);
      const g = guild && store.getConfig(report.guildId).guard;
      if (!guild || !g || !g.enabled || !g.early || !g.stripLetterIn) return;
      const now = Date.now();
      if (now - (lastEarly.get(report.guildId) ?? 0) < 20_000 || report.memberIds.length < 2) return;
      lastEarly.set(report.guildId, now);
      const seen = handled.get(key(report)) ?? new Set<string>(); handled.set(key(report), seen);
      await runGuard(report, g, discordPlatform(guild, store, client.user!.id), { early: true, handled: seen }).catch(() => {});
    });
    onRaidEnded(async report => {
      const guild = client.guilds.cache.get(report.guildId);
      if (!guild) return;
      const g = store.getConfig(report.guildId).guard;
      const seen = handled.get(key(report)); handled.delete(key(report));
      if (!g.enabled) return;
      await runGuard(report, g, discordPlatform(guild, store, client.user!.id), { handled: seen }).catch(e => store.audit(guild.id, 'guard', 'error', guild.id, `guard failed: ${(e as Error).message}`));
    });
  },
};
