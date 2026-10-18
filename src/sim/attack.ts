import type { GuardSettings, RaidSettings } from '../core/config.js';
import type { RaidReport } from '../core/bus.js';
import { RaidEngine, fingerprint, type RaidPlatform, type TrackedMessage } from '../modules/raid/engine.js';
import { runGuard, type GuardPlatform } from '../modules/guard/engine.js';

export interface SimOptions {
  attackers: number; // 20..200 raid accounts
  style: 'burst' | 'waves' | 'drip';
  adminRaiders: number; // how many raiders hold the Admin role
  outrankingAdmin: boolean; // one admin raider sits above the bot's role (messages can still be deleted, the account cannot be punished)
  messagesPerBot: number; // 1..10
  innocents: number; // normal members who join during the raid
  seed?: number;
}
export type SimKind = 'info' | 'join' | 'message' | 'deleted' | 'detected' | 'act' | 'purge' | 'lockdown' | 'end' | 'guard' | 'owner';
export interface SimEvent { t: number; kind: SimKind; text: string; count?: number }
export interface SimCheck { label: string; pass: boolean; detail: string; critical?: boolean } // critical defaults to true; a failed non-critical check is a warning
export interface SimResult {
  events: SimEvent[]; checks: SimCheck[]; verdict: 'pass' | 'fail';
  stats: {
    attackers: number; joined: number; detectedAfterJoins: number | null; detectedAt: number | null;
    messagesSent: number; messagesDeleted: number; blocked: number; purged: number; leaked: number;
    visibleAvg: number; visibleMax: number; spamGoneAt: number | null; punishDoneAt: number | null;
    accountsActed: number; accountsSkipped: number; innocentsAffected: number; duration: number;
  };
  spamProtection: string;
}

// ---------- how fast Discord really is ----------
// Approximate public rate limits and typical round-trip times. They are modelled on the virtual clock, so a run is instant but honest about timing.
const LIMITS = {
  deleteOne: { limit: 5, per: 1, latency: 0.18 }, // single message delete, per channel
  deleteBulk: { limit: 1, per: 1, latency: 0.3 }, // bulk delete (up to 100 messages), per channel
  member: { limit: 10, per: 10, latency: 0.25 }, // timeout / kick / ban, per server
  roles: { limit: 10, per: 10, latency: 0.25 }, // role changes, per server
  invites: { limit: 1, per: 1, latency: 0.4 },
};
const GATEWAY = { join: [0.08, 0.3], message: [0.06, 0.25] } as const; // seconds until the bot hears about it

class RateLimits {
  private starts = new Map<string, number[]>();
  constructor(private rand: () => number) {}
  /** When a request made at `now` finishes, given the bucket's limit. */
  request(bucket: string, rule: { limit: number; per: number; latency: number }, now: number): number {
    const list = this.starts.get(bucket) ?? [];
    let at = now, guardN = 0;
    for (;;) {
      if (++guardN > 10_000) throw new Error(`rate limit loop stuck: bucket=${bucket} now=${now} at=${at} list=${JSON.stringify(list.slice(-12))}`);
      const recent = list.filter(x => x > at - rule.per + 1e-9 && x <= at); // 1e-9: floating-point rounding must not keep an old request inside the window
      if (recent.length < rule.limit) break;
      at = Math.min(...recent) + rule.per; // wait until the oldest request leaves the window
    }
    list.push(at);
    this.starts.set(bucket, list.filter(x => x > at - 120));
    return at + rule.latency * (0.75 + this.rand() * 0.5);
  }
}

// ---------- virtual server ----------
interface VAccount { id: string; tag: string; bot: boolean; createdAt: number; rank: number; roles: Set<string>; kind: 'owner' | 'trusted' | 'careless' | 'innocent' | 'raider'; username?: string; hasAvatar?: boolean }
const BOT_RANK = 90, DAY = 86_400_000;
const DANGEROUS_ROLE = 'Admin';
const SPAM_LINES = ['this server is ours', 'THIS SERVER IS NOW OURS', 'raided, join us', 'you have been raided', 'we own this place now', 'server taken over'];

/** Small seeded random numbers so a run can be repeated. */
function rng(seed: number) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const r1 = (n: number) => Math.round(n * 10) / 10;

export async function simulateAttack(raidIn: RaidSettings, guardIn: GuardSettings, opts: SimOptions): Promise<SimResult> {
  const rand = rng(opts.seed ?? Date.now());
  const api = new RateLimits(rand);
  const between = (lo: number, hi: number) => lo + rand() * (hi - lo);
  // The test always runs with both protections on and out of shadow mode, whatever the real settings are.
  const raid: RaidSettings = { ...raidIn, enabled: true, shadow: false };
  const guard: GuardSettings = { ...guardIn, enabled: true, shadow: false, trustedAdmins: ['trusted'] };

  const base = 1_800_000_000_000; // a fixed starting "now" so account ages are predictable
  let t = 0; // virtual seconds
  const events: SimEvent[] = [];
  const emitAt = (at: number, kind: SimKind, text: string, count?: number) => events.push({ t: r1(at), kind, text, count });
  const emit = (kind: SimKind, text: string, count?: number) => emitAt(t, kind, text, count);

  const accounts = new Map<string, VAccount>();
  const add = (a: Omit<VAccount, 'roles'> & { roles?: string[] }) => { const v = { ...a, roles: new Set(a.roles ?? []) }; accounts.set(v.id, v); return v; };
  add({ id: 'owner', tag: 'ServerOwner#0001', bot: false, createdAt: base - 900 * DAY, rank: 100, kind: 'owner', roles: ['Owner'] });
  add({ id: 'trusted', tag: 'TrustedMod#0002', bot: false, createdAt: base - 700 * DAY, rank: 50, kind: 'trusted', roles: [DANGEROUS_ROLE] });
  add({ id: 'careless', tag: 'CarelessAdmin#0003', bot: false, createdAt: base - 500 * DAY, rank: 40, kind: 'careless', roles: [DANGEROUS_ROLE] });

  const removed = new Set<string>();
  const messages: { id: string; authorId: string; sentAt: number; deletedAt: number | null }[] = [];
  let invitesPaused = false, invitesResumed = false, acted = 0, skipped = 0, detectedAt: number | null = null, detectedAfter: number | null = null, joinCount = 0;
  let punishDoneAt: number | null = null;
  const state: { report: RaidReport | null } = { report: null };
  const touched = new Set<string>(); // accounts the protections punished

  const platform: RaidPlatform = {
    now: () => base + t * 1000,
    guildId: () => 'sim-guild', ownerId: () => 'owner', meId: () => 'sim-bot', trusted: () => ['trusted'],
    settings: () => raid,
    record(action, _userId, text) {
      if (action === 'raid-start') { detectedAt = t; detectedAfter = joinCount; emit('detected', text); }
      else if (action === 'raid-end') emit('end', text);
      else if (action === 'lockdown' || action === 'lockdown-end') emit('lockdown', text);
      else if (action === 'purge') emit('purge', text);
      // timeout / kick / ban are reported by act() below, at the moment Discord would finish them
    },
    async announce() { /* the mod-log channel does not exist in the simulation */ },
    async act(account, action, _reason, seconds) {
      const v = accounts.get(account.id);
      if (!v) return 'already gone';
      if (v.rank >= BOT_RANK) { skipped++; emit('act', `${v.tag}: skipped (member outranks bot)`); return 'skipped (member outranks bot)'; }
      const done = api.request('member', LIMITS.member, t);
      acted++; touched.add(v.id); punishDoneAt = Math.max(punishDoneAt ?? 0, done);
      const outcome = action === 'timeout' ? `timed out ${seconds}s` : action === 'kick' ? 'kicked' : 'banned';
      if (action !== 'timeout') removed.add(v.id);
      emitAt(done, 'act', `${v.tag}: ${outcome}`);
      return outcome;
    },
    async deleteMessages(list, source) {
      let n = 0;
      const byChannel = new Map<string, TrackedMessage[]>();
      for (const m of list) byChannel.set(m.channelId, [...(byChannel.get(m.channelId) ?? []), m]);
      for (const [channel, group] of byChannel) {
        const chunks: TrackedMessage[][] = [];
        if (group.length === 1) chunks.push(group);
        else for (let i = 0; i < group.length; i += 100) chunks.push(group.slice(i, i + 100));
        for (const chunk of chunks) {
          const rule = chunk.length === 1 ? LIMITS.deleteOne : LIMITS.deleteBulk;
          const done = api.request(`${chunk.length === 1 ? 'del' : 'bulk'}:${channel}`, rule, t);
          let k = 0;
          for (const m of chunk) { const rec = messages.find(x => x.id === m.id); if (rec && rec.deletedAt === null) { rec.deletedAt = done; k++; } }
          n += k;
          if (k) emitAt(done, 'deleted', source === 'purge' ? `${k} earlier message${k === 1 ? '' : 's'} purged` : k === 1 ? 'message deleted' : `${k} spam messages deleted in one go`, k);
        }
      }
      return n;
    },
    async pauseInvites(minutes) { invitesPaused = true; return `invites paused for ${minutes} min`; },
    async resumeInvites() { invitesResumed = true; return 'invites resumed'; },
    onEnded(r) { state.report = r; },
  };
  const engine = new RaidEngine(platform);

  // ---------- who is in the attack ----------
  const attackers = Math.max(20, Math.min(200, Math.round(opts.attackers)));
  const adminRaiders = Math.max(0, Math.min(attackers, Math.round(opts.adminRaiders)));
  const perBot = Math.max(1, Math.min(10, Math.round(opts.messagesPerBot)));
  const joins: { at: number; id: string }[] = [];
  const ids: string[] = [];
  for (let i = 0; i < attackers; i++) {
    const n = String(i + 1).padStart(2, '0');
    const isAdmin = i < adminRaiders;
    const outranks = opts.outrankingAdmin && i === 0;
    const bot = rand() < 0.7;
    const v = add({ id: `raider-${n}`, tag: `${bot ? 'RaidBot' : 'Raider'}-${n}#${String(1000 + i)}`, username: `${bot ? 'RaidBot' : 'Raider'}_${n}`, hasAvatar: rand() < 0.3, bot, createdAt: base - Math.floor(rand() * 3 * DAY), rank: outranks ? 95 : isAdmin ? 30 : 1, kind: 'raider', roles: isAdmin ? [DANGEROUS_ROLE, 'Member'] : ['Member'] });
    ids.push(v.id);
  }
  const spread = opts.style === 'burst' ? 4 : 3;
  const DRIP_SPACING = 15; // seconds between slow-drip raiders: far too slow for the burst limit
  ids.forEach((id, i) => {
    let at: number;
    if (opts.style === 'burst') at = rand() * spread;
    else if (opts.style === 'waves') at = Math.floor(i / Math.ceil(attackers / 3)) * 25 + rand() * spread;
    else at = i * DRIP_SPACING + rand() * 4;
    joins.push({ at, id });
  });
  for (let i = 0; i < Math.max(0, Math.min(10, opts.innocents)); i++) {
    const v = add({ id: `innocent-${i + 1}`, tag: `NormalMember${i + 1}#${2000 + i}`, username: ['maple', 'orbit', 'quill', 'basil', 'cedar', 'delta', 'ember', 'fjord', 'glint', 'harbor'][i]! + 'fan', hasAvatar: true, bot: false, createdAt: base - 400 * DAY, rank: 1, kind: 'innocent', roles: ['Member'] });
    joins.push({ at: 6 + i * 0.7, id: v.id });
  }
  // Kevin has been here for years. His connection drops and he rejoins five times in a few seconds, in the middle of the attack.
  add({ id: 'kevin', tag: 'Kevin#4242', username: 'kevin', hasAvatar: true, bot: false, createdAt: base - 800 * DAY, rank: 1, kind: 'trusted', roles: ['Member'] });
  for (let k = 0; k < 5; k++) joins.push({ at: 2 + k * 1.3, id: 'kevin' });
  joins.push({ at: 4, id: 'trusted' });

  type Step = { at: number; run: () => Promise<void> };
  const steps: Step[] = [];
  let msgSeq = 0;
  /** A message is sent at `at`; the bot hears about it a moment later (gateway delay). */
  const send = (at: number, authorId: string, line: string) => {
    const id = `m${++msgSeq}`, channelId = `c${1 + (msgSeq % 4)}`;
    const rec = { id, authorId, sentAt: at, deletedAt: null as number | null };
    steps.push({ at, run: async () => { messages.push(rec); if (accounts.get(authorId)?.kind === 'raider') emit('message', line); } });
    steps.push({ at: at + between(...GATEWAY.message), run: async () => { await engine.onMessage({ id, channelId, authorId, ts: base + t * 1000, fp: fingerprint(line) }); } });
  };
  for (const j of joins) {
    const v = accounts.get(j.id)!;
    steps.push({ at: j.at, run: async () => { joinCount++; if (v.kind === 'raider') emit('join', `${v.tag} joined${v.roles.has(DANGEROUS_ROLE) ? ' (has the Admin role)' : ''}`); else emit('info', `${v.tag} joined`); } });
    steps.push({ at: j.at + between(...GATEWAY.join), run: async () => { if (v.kind === 'raider') engine.setInviter(v.id, 'careless'); await engine.onJoin({ id: v.id, tag: v.tag, bot: v.bot, createdAt: v.createdAt, username: v.username ?? v.tag, hasAvatar: v.hasAvatar ?? true }); } });
    if (v.kind === 'raider') for (let k = 0; k < perBot; k++) send(j.at + 0.2 + k * (0.4 + rand() * 0.6), j.id, SPAM_LINES[Math.floor(rand() * SPAM_LINES.length)]!);
  }
  for (const at of [3, 9, 30]) { steps.push({ at, run: async () => { emit('owner', 'ServerOwner posted a message'); } }); send(at, 'owner', 'hello everyone'); }
  for (const at of [5, 20]) { steps.push({ at, run: async () => { emit('info', 'TrustedMod posted a message'); } }); send(at, 'trusted', 'what is going on?'); }
  steps.sort((a, b) => a.at - b.at);

  // ---------- run on a virtual clock ----------
  let next = 0;
  const end = steps[steps.length - 1]?.at ?? 0;
  const horizon = end + Math.max(raid.quietSeconds, 900) + 30 + (raid.lockdown ? raid.lockdownMinutes * 60 : 0);
  for (let clock = 0; clock <= horizon; clock += 0.1) {
    while (next < steps.length && steps[next]!.at <= clock) { const s = steps[next++]!; t = s.at; await s.run(); }
    t = Math.round(clock * 10) / 10;
    await engine.flush(); // the real bot does this four times a second
    if (Math.round(clock * 10) % 50 === 0) await engine.tick(); // and this every 5 seconds
    if (next >= steps.length && !engine.active && (!raid.lockdown || invitesResumed || !invitesPaused) && clock > end + 5) break;
  }

  // ---------- admin guard on the same virtual server ----------
  const guardDone = new Map<string, number>();
  if (state.report) {
    const gp: GuardPlatform = {
      ownerId: () => 'owner', meId: () => 'sim-bot',
      async fetchAccount(id) { const v = accounts.get(id); return v && !removed.has(id) ? { id, tag: v.tag, bot: v.bot } : null; },
      async stripRoles(id, which) {
        const v = accounts.get(id)!;
        if (v.rank >= BOT_RANK) return which === 'all' ? 'had no removable roles (above the bot)' : 'had no removable dangerous roles (roles above the bot cannot be changed)';
        const gone = [...v.roles].filter(role => which === 'all' || role === DANGEROUS_ROLE);
        if (gone.length) guardDone.set(id, api.request('roles', LIMITS.roles, t));
        gone.forEach(role => v.roles.delete(role));
        return gone.length ? `removed roles: ${gone.join(', ')}` : which === 'all' ? 'had no removable roles' : 'had no removable dangerous roles';
      },
      async findLetIn() { return { botAdd: [{ id: 'careless' }], grants: [{ id: 'trusted' }], botIds: [] }; },
      record(action, userId, text) { if (action !== 'error') emitAt(guardDone.get(userId) ?? t, 'guard', text); },
      async announce() { /* no mod-log channel in the simulation */ },
    };
    t += 1;
    await runGuard(state.report, guard, gp);
  }

  // ---------- results ----------
  events.sort((a, b) => a.t - b.t);
  const raiderSet = new Set(ids);
  const mine = messages.filter(m => raiderSet.has(m.authorId));
  const deleted = mine.filter(m => m.deletedAt !== null);
  const visible = deleted.map(m => m.deletedAt! - m.sentAt);
  const visibleAvg = visible.length ? visible.reduce((a, b) => a + b, 0) / visible.length : 0;
  const visibleMax = visible.length ? Math.max(...visible) : 0;
  const spamGoneAt = deleted.length ? Math.max(...deleted.map(m => m.deletedAt!)) : null;
  const leaked = mine.length - deleted.length;
  const purgedCount = events.filter(e => e.kind === 'deleted' && e.text.includes('earlier')).reduce((a, e) => a + (e.count ?? 0), 0);
  const innocentIds = [...accounts.values()].filter(a => a.kind === 'innocent').map(a => a.id);
  const innocentsAffected = innocentIds.filter(id => touched.has(id) || messages.some(m => m.authorId === id && m.deletedAt !== null)).length;
  const kevinOk = !touched.has('kevin') && !messages.some(m => m.authorId === 'kevin' && m.deletedAt !== null);
  const ownerOk = !touched.has('owner') && !messages.some(m => m.authorId === 'owner' && m.deletedAt !== null);
  const trustedOk = !touched.has('trusted') && !messages.some(m => m.authorId === 'trusted' && m.deletedAt !== null) && accounts.get('trusted')!.roles.has(DANGEROUS_ROLE);
  const carelessStripped = !accounts.get('careless')!.roles.has(DANGEROUS_ROLE);
  const adminRaidersCleaned = adminRaiders === 0 || ids.slice(0, adminRaiders).map(id => accounts.get(id)!).filter(a => a.rank < BOT_RANK).every(a => removed.has(a.id) || !a.roles.has(DANGEROUS_ROLE));
  const detected = detectedAt !== null;
  const pct = mine.length ? Math.round((deleted.length / mine.length) * 100) : 100;
  const firstMessage = mine.length ? Math.min(...mine.map(m => m.sentAt)) : 0;
  const punishSpan = punishDoneAt !== null && detectedAt !== null ? punishDoneAt - detectedAt : 0;
  const verb = raid.action === 'timeout' ? 'timed out' : raid.action === 'kick' ? 'kicked' : 'banned';
  const fast = spamGoneAt !== null && spamGoneAt - firstMessage <= 30 && visibleAvg <= 5;

  const checks: SimCheck[] = [
    { label: 'Raid detected', pass: detected, detail: detected ? `after ${detectedAfter} joins, ${detectedAt!.toFixed(1)}s in` : `not detected: ${opts.style === 'drip' ? 'raiders joined too slowly for the limit (' + raid.joinsPerWindow + ' joins in ' + raid.windowSeconds + 's). Lower the limit or the time window.' : 'check your join limit'}` },
    { label: 'Every raider message deleted', pass: leaked === 0, detail: `${deleted.length} of ${mine.length} deleted (${pct}%)${purgedCount ? `, ${purgedCount} of them purged after detection` : ''}${leaked ? `, ${leaked} got through` : ''}` },
    { label: 'Spam cleared quickly', pass: fast, detail: spamGoneAt === null ? 'nothing was deleted' : `each message was visible for ${visibleAvg.toFixed(1)}s on average (longest ${visibleMax.toFixed(1)}s). The last one was gone ${(spamGoneAt - firstMessage).toFixed(1)}s after the first. Deleting is limited to about 5 messages a second per channel, so the bot deletes in batches of up to 100.`, critical: false },
    { label: 'Raiders dealt with', pass: detected && ids.every(id => touched.has(id) || accounts.get(id)!.rank >= BOT_RANK), detail: `${acted} accounts ${verb}${acted ? ` over ${punishSpan.toFixed(0)}s` : ''}${skipped ? `, ${skipped} could not be punished (they outrank the bot), their messages were still deleted` : ''}${punishSpan > 60 ? '. Discord only allows about 10 member actions per 10 seconds, so a big raid takes a while. The spam is deleted first, so this does not leave it visible.' : ''}` },
    { label: 'Admins and bots were not spared', pass: adminRaiders === 0 || ids.slice(0, adminRaiders).every(id => touched.has(id) || accounts.get(id)!.rank >= BOT_RANK), detail: adminRaiders ? `${adminRaiders} raiders held the Admin role and were treated like any other raider` : 'no admin raiders in this run' },
    { label: 'Server owner untouched', pass: ownerOk, detail: ownerOk ? 'not punished, messages kept' : 'the owner was affected' },
    { label: 'Kevin, rejoining five times, left alone', pass: kevinOk, detail: kevinOk ? 'a long-standing member who leaves and rejoins quickly is not mistaken for a raider' : 'Kevin was caught. Raise “Let in accounts older than (days)” or check that his account is old' },
    { label: 'Trusted admin untouched', pass: trustedOk, detail: trustedOk ? 'not punished, messages and role kept, even though the audit log lists them' : 'the trusted admin was affected' },
    { label: 'Invites paused', pass: !raid.lockdown || invitesPaused, detail: raid.lockdown ? (invitesPaused ? `paused for ${raid.lockdownMinutes} min${invitesResumed ? ', then resumed' : ''}` : 'not paused') : 'turned off in your settings' },
    { label: 'Raiders’ roles stripped (Admin guard)', pass: adminRaidersCleaned, detail: 'roles removed from every raid account still in the server' },
    { label: 'Whoever let them in lost their admin role', pass: carelessStripped, detail: carelessStripped ? 'CarelessAdmin (who invited and added the bots) lost the Admin role' : 'the careless admin kept the Admin role' },
  ];
  if (opts.innocents > 0) checks.push({ label: 'Normal members left alone', pass: innocentsAffected === 0, detail: innocentsAffected ? `${innocentsAffected} normal member(s) were caught because they joined during the raid. Set “Let in accounts older than (days)” above 0 to let established accounts through.` : 'none were affected', critical: false });

  const duration = Math.round(Math.max(t, ...events.map(e => e.t)));
  return {
    events, checks, verdict: checks.every(c => c.pass || c.critical === false) ? 'pass' : 'fail',
    stats: { attackers, joined: joinCount, detectedAfterJoins: detectedAfter, detectedAt, messagesSent: mine.length, messagesDeleted: deleted.length, blocked: deleted.length - purgedCount, purged: purgedCount, leaked, visibleAvg: r1(visibleAvg), visibleMax: r1(visibleMax), spamGoneAt: spamGoneAt === null ? null : r1(spamGoneAt), punishDoneAt: punishDoneAt === null ? null : r1(punishDoneAt), accountsActed: acted, accountsSkipped: skipped, innocentsAffected, duration },
    spamProtection: 'Switched off for this test, so only Raid protection and Admin guard are tested. Your real Spam protection setting is not changed. Timings use typical Discord delays and rate limits.',
  };
}
