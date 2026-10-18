import type { RaidSettings } from '../../core/config.js';
import type { RaidReport } from '../../core/bus.js';
import { JoinWindow, SUSPICIOUS_AT, isRaider, joinWeight, raidOver, suspicion, type Join, type Profile, type Raid } from './detector.js';

export interface Account { id: string; tag: string; bot: boolean; createdAt: number; username?: string; hasAvatar?: boolean }
/** `fp` is a fingerprint of what the message says (see fingerprint()), so identical spam from different accounts can be matched. */
export interface TrackedMessage { id: string; channelId: string; authorId: string; ts: number; fp?: string }

/** Same text with the numbers, spacing and case that bots vary taken out. Short messages get no fingerprint: "hi" proves nothing. */
export function fingerprint(content: string): string | undefined {
  const t = content.toLowerCase().replace(/https?:\/\/\S+/g, 'link').replace(/[^\p{L}]+/gu, '');
  return t.length >= 8 ? t.slice(0, 80) : undefined;
}

/** Everything the engine needs from the outside world. The real bot and the attack simulator each provide one. */
export interface RaidPlatform {
  now(): number;
  guildId(): string;
  ownerId(): string;
  meId(): string;
  trusted(): string[];
  settings(): RaidSettings;
  record(action: string, userId: string, text: string): void; // audit log
  announce(text: string): Promise<void>; // mod-log channel
  act(account: Account, action: 'timeout' | 'kick' | 'ban', reason: string, seconds: number): Promise<string>;
  /** Delete messages (the platform groups them by channel and uses bulk delete where it can). Returns how many were deleted. */
  deleteMessages(messages: TrackedMessage[], source: 'block' | 'purge'): Promise<number>;
  pauseInvites(minutes: number): Promise<string>;
  resumeInvites(): Promise<string>;
  /** Delete whatever an account still has in these channels' recent history (messages the bot never saw, or that slipped through). Returns how many. */
  sweep?(accountId: string, channelIds: string[]): Promise<number>;
  /** Called every few seconds while a raid is going on, so Admin guard can act before it ends. */
  onProgress?(report: RaidReport): void;
  onEnded(report: RaidReport): void;
}

const TRACK_MINUTES = 15; // remember messages from brand-new accounts this long, so they can be purged if a raid is detected
const MAX_PER_ACCOUNT = 1000; // messages remembered per new account, so all of them can be deleted once it is known to be a raider
const BATCH_MS = 250; // blocked messages are collected for at least this long, then deleted together (one bulk delete per channel)
const BATCH_GAP_MS = 1000; // Discord allows about one bulk delete per second per channel, so batches are spaced out instead of queueing up behind the limit
const BATCH_MAX = 100; // Discord's bulk-delete limit
const RING_SECONDS = 120; // every message is remembered this long, in case its author turns out to be a raider (its join event can arrive late)
const RING_MAX = 20_000;

/**
 * Raid protection. Detects a burst of joins, acts on every raid account (admins and bots included: only the owner,
 * this bot and trusted admins are never touched), deletes everything they send, purges what they sent before detection,
 * and pauses invites while it lasts.
 */
export class RaidEngine {
  private window = new JoinWindow();
  private profiles = new Map<string, Profile & { ts: number }>();
  private channelsSeen = new Map<string, Set<string>>();
  private letThrough = new Set<string>();
  private raidFps = new Set<string>(); // what the raiders have been saying, so accounts that look normal but say the same thing can be caught
  private raid: Raid | null = null;
  private blocked = new Map<string, number>(); // raider -> keep deleting their messages until
  private tracked = new Map<string, TrackedMessage[]>();
  private joinedAt = new Map<string, number>();
  private accounts = new Map<string, Account>();
  private noted = new Set<string>(); // raiders already announced as "blocked" in the log
  private blockedCount = 0;
  private purgedCount = 0;
  private lockdownUntil = 0;
  private pending = new Map<string, { since: number; msgs: TrackedMessage[]; purge: Set<string> }>(); // messages waiting for their batch
  private queued = new Set<string>(); // ids already waiting, so nothing is deleted twice
  private lastBatch = new Map<string, number>(); // when each channel last had a batch deleted
  private ring: TrackedMessage[] = []; // recent messages from everyone, used to find a raider's earlier messages even if the join event came late

  constructor(private p: RaidPlatform) {}

  get active() { return this.raid !== null; }
  isBlocked(id: string) { return (this.blocked.get(id) ?? 0) > this.p.now(); }
  raiderIds() { return this.raid ? [...this.raid.members.keys()] : []; }
  private isProtected(id: string) { return id === this.p.ownerId() || id === this.p.meId() || this.p.trusted().includes(id); }

  /** Best effort: remember who invited an account (arrives a moment after the join). */
  setInviter(accountId: string, inviterId: string | null) {
    const j = this.raid?.members.get(accountId);
    if (j) j.inviterId = inviterId;
    const pending = this.pendingInviters; if (inviterId) pending.set(accountId, inviterId);
  }
  private pendingInviters = new Map<string, string>();

  async onJoin(a: Account): Promise<void> {
    const s = this.p.settings();
    if (!s.enabled || this.isProtected(a.id)) return;
    const now = this.p.now();
    this.accounts.set(a.id, a);
    this.joinedAt.set(a.id, now);
    const profile: Profile = { id: a.id, username: a.username ?? a.tag.replace(/#\d+$/, ''), createdAt: a.createdAt, hasAvatar: a.hasAvatar ?? true, bot: a.bot };
    const horizon = Math.max(s.dripWindowMinutes * 60_000, 60_000);
    for (const [id, pr] of this.profiles) if (now - pr.ts > horizon) this.profiles.delete(id);
    const sus = suspicion(profile, [...this.profiles.values()], now);
    this.profiles.set(a.id, { ...profile, ts: now });
    // A long-standing account with a picture and nothing odd about it (think of Kevin leaving and rejoining) counts for a quarter of a join, and is let through during a raid.
    const established = !isRaider({ bot: a.bot, accountCreatedAt: a.createdAt, now, minAccountAgeDays: s.minAccountAgeDays, hasAvatar: profile.hasAvatar }) && sus.score < 2;
    const join: Join = { id: a.id, ts: now, bot: a.bot, inviterId: null, weight: established ? 0.25 : 1 };
    const recent = this.window.record(this.p.guildId(), join, s.windowSeconds);
    // Slow raids: look at the latest joins together. Every account is judged against all the others, so a bot farm shows up as soon as a few siblings have joined.
    let dripRecent: Join[] = [];
    if (!this.raid && s.dripJoins > 0) {
      const cand = [...this.profiles.values()].slice(-60);
      dripRecent = cand.filter(pr => suspicion(pr, cand, now).score >= SUSPICIOUS_AT).map(pr => ({ id: pr.id, ts: pr.ts, bot: pr.bot, inviterId: null }));
    }

    if (!this.raid && joinWeight(recent) >= s.joinsPerWindow) {
      await this.startRaid('burst', recent.filter(j => (j.weight ?? 1) >= 1 || this.accounts.get(j.id)?.bot), `${recent.length} joins in ${s.windowSeconds}s`, now);
      return;
    }
    if (!this.raid && s.dripJoins > 0 && dripRecent.length >= s.dripJoins) {
      const spanMs = now - Math.min(...dripRecent.map(j => j.ts));
      const fast = spanMs <= s.windowSeconds * 2000; // suspicious accounts piling in within seconds are a burst, not a trickle
      await this.startRaid(fast ? 'burst' : 'drip', fast ? [...new Map([...recent.filter(j => (j.weight ?? 1) >= 1), ...dripRecent].map(j => [j.id, j])).values()] : dripRecent, fast ? `${dripRecent.length} suspicious accounts in ${Math.max(1, Math.round(spanMs / 1000))}s` : `${dripRecent.length} suspicious accounts in ${Math.max(1, Math.round(spanMs / 60_000))} min (${sus.reasons.join(', ')})`, now);
      return;
    }
    if (this.raid && this.raid.kind === 'drip' && joinWeight(recent) >= s.joinsPerWindow) {
      // What looked like a slow raid is speeding up into a burst: everyone who joined in the last few seconds is part of it now.
      this.raid.kind = 'burst';
      this.p.record('raid-escalate', this.p.guildId(), `the slow raid turned into a burst: ${recent.length} joins in ${s.windowSeconds}s`);
      for (const j of recent) {
        const acc = this.accounts.get(j.id);
        if (!acc || this.isProtected(j.id) || this.raid.members.has(j.id) || (j.weight ?? 1) < 1) continue;
        await this.markRaider(j, acc, true); await this.punish(j, acc, 'part of a join burst');
      }
      return;
    }
    if (this.raid) {
      const raider = a.bot || (this.raid.kind === 'drip' ? sus.score >= 2 : !established);
      if (raider) { await this.markRaider(join, a, true); await this.punish(join, a, 'joined during a raid'); }
      else if (!this.letThrough.has(a.id)) { this.letThrough.add(a.id); this.p.record('let-through', a.id, `${a.tag} joined during the raid but is an established account, so it was left alone`); }
    }
  }

  private async startRaid(kind: 'burst' | 'drip', recentIn: Join[], what: string, now: number) {
    let recent = recentIn;
    const s = this.p.settings();
    this.raid = { startedAt: now, lastRaidJoin: now, members: new Map(), kind };
    this.blockedCount = 0; this.purgedCount = 0; this.noted.clear(); this.letThrough.clear();
    this.p.record('raid-start', this.p.guildId(), `${kind === 'drip' ? 'slow raid: ' : ''}${what}${s.shadow ? ' (shadow: no action taken)' : ''}`);
    await this.p.announce(`**${kind === 'drip' ? 'Slow raid' : 'Raid'} detected**: ${what}${s.shadow ? ' (shadow mode: logging only)' : ''}.`);
    // Messages first (fast, and it is what people see), invites in parallel, punishments after that.
    const lockdown = s.lockdown ? this.startLockdown(s) : Promise.resolve();
    const queue: [Join, Account][] = [];
    if (kind === 'drip') {
      // With the whole picture in hand, look again at everyone who joined lately: the first bot of a trickle only looks odd once its siblings have shown up.
      const all = [...this.profiles.values()];
      const known = new Set(recent.map(j => j.id));
      for (const pr of all) if (!known.has(pr.id) && suspicion(pr, all, now).score >= SUSPICIOUS_AT) { recent = [...recent, { id: pr.id, ts: pr.ts, bot: pr.bot, inviterId: null }]; known.add(pr.id); }
    }
    for (const j of recent) {
      const acc = this.accounts.get(j.id);
      if (!acc || this.isProtected(j.id)) continue;
      queue.push([j, acc]);
    }
    for (const [j, acc] of queue) await this.markRaider(j, acc, false);
    for (const [j, acc] of queue) await this.punish(j, acc, kind === 'drip' ? 'part of a slow raid' : 'part of a join burst');
    await this.catchSameText();
    await lockdown;
  }

  /** Mark an account as a raider: from now on every message it sends is deleted, and what it already sent is purged. */
  private async markRaider(j: Join, a: Account, extendsRaid: boolean) {
    const s = this.p.settings(), raid = this.raid!;
    const now = this.p.now();
    j.inviterId = this.pendingInviters.get(j.id) ?? j.inviterId;
    raid.members.set(j.id, j);
    if (extendsRaid) raid.lastRaidJoin = now;
    this.blocked.set(j.id, now + s.blockMessagesMinutes * 60_000);
    await this.purge(j.id, a);
  }

  /** Punish a raider (timeout, kick or ban). Slower than deleting messages, because Discord limits member actions. */
  private async punish(j: Join, a: Account, why: string) {
    const s = this.p.settings();
    if (s.shadow) { this.p.record('shadow', j.id, `SHADOW (nothing done): would ${s.action} ${a.tag} (${why})`); return; }
    const outcome = await this.p.act(a, s.action, `Raid protection: ${why}`, s.timeoutSeconds);
    this.p.record(s.action, j.id, `${a.tag}: ${outcome} (${why})`);
  }

  /** Queue everything a raider already sent before they were recognised as one. */
  private async purge(id: string, a: Account) {
    const s = this.p.settings();
    const known = new Map((this.tracked.get(id) ?? []).map(m => [m.id, m]));
    for (const m of this.ring) if (m.authorId === id) known.set(m.id, m);
    const list = [...known.values()];
    for (const m of list) { this.see(id, m.channelId); if (m.fp) this.raidFps.add(m.fp); }
    this.tracked.delete(id);
    if (!s.purgeMessages) return;
    if (!list.length) { void this.sweepAccount(id); return; }
    if (s.shadow) { this.p.record('shadow', id, `SHADOW (nothing done): would delete ${list.length} earlier message(s) from ${a.tag}`); return; }
    for (const m of list) this.queueDelete(m, true);
    this.p.record('purge', id, `${a.tag}: deleting ${list.length} earlier message(s)`);
    void this.sweepAccount(id);
  }

  /** Called for every message. Returns true if it was deleted. */
  async onMessage(m: TrackedMessage): Promise<boolean> {
    const s = this.p.settings();
    if (!s.enabled || this.isProtected(m.authorId)) return false;
    const now = this.p.now();
    if (this.isBlocked(m.authorId)) {
      this.see(m.authorId, m.channelId);
      if (m.fp) this.raidFps.add(m.fp);
      if (s.shadow) {
        if (!this.noted.has(m.authorId)) { this.noted.add(m.authorId); this.p.record('shadow', m.authorId, 'SHADOW (nothing done): would delete every message from this raid account'); }
        return false;
      }
      this.queueDelete(m);
      if (!this.noted.has(m.authorId)) { this.noted.add(m.authorId); this.p.record('block', m.authorId, 'deleting every message from this raid account'); }
      return true;
    }
    // Someone who joined recently and posts exactly what the raiders post is one of them, however normal their profile looks.
    const joinedRecently = this.joinedAt.get(m.authorId);
    const acc = this.accounts.get(m.authorId);
    if (this.raid && m.fp && this.raidFps.has(m.fp) && joinedRecently !== undefined && acc && now - joinedRecently < Math.max(TRACK_MINUTES, s.dripWindowMinutes) * 60_000) {
      const join: Join = this.raid.members.get(m.authorId) ?? { id: m.authorId, ts: joinedRecently, bot: acc.bot, inviterId: null };
      this.ring.push(m);
      await this.markRaider(join, acc, true);
      await this.punish(join, acc, 'posted the same message as the raiders');
      if (!s.shadow) { this.queueDelete(m); return true; }
      return false;
    }
    this.ring.push(m);
    if (this.ring.length > RING_MAX) this.ring.splice(0, this.ring.length - RING_MAX);
    const joined = this.joinedAt.get(m.authorId);
    if (joined !== undefined && now - joined < Math.max(TRACK_MINUTES, s.dripWindowMinutes) * 60_000) {
      const list = this.tracked.get(m.authorId) ?? [];
      if (list.length < MAX_PER_ACCOUNT) list.push(m);
      this.tracked.set(m.authorId, list);
    }
    return false;
  }

  /** Accounts that already posted what the raiders post are raiders too, even if their profile looks normal. */
  private async catchSameText() {
    if (!this.raid || !this.raidFps.size) return;
    for (const [id, list] of [...this.tracked]) {
      if (this.raid.members.has(id) || this.isProtected(id)) continue;
      const acc = this.accounts.get(id);
      if (!acc || !list.some(m => m.fp && this.raidFps.has(m.fp))) continue;
      const join: Join = { id, ts: this.joinedAt.get(id) ?? this.p.now(), bot: acc.bot, inviterId: null };
      await this.markRaider(join, acc, true);
      await this.punish(join, acc, 'posted the same message as the raiders');
    }
  }
  private see(id: string, channelId: string) { const set = this.channelsSeen.get(id) ?? new Set<string>(); set.add(channelId); this.channelsSeen.set(id, set); }
  /** Look through recent history in the channels this account has spoken in and remove anything the live feed missed. */
  private async sweepAccount(id: string) {
    const s = this.p.settings(), channels = [...(this.channelsSeen.get(id) ?? [])];
    if (s.shadow || !this.p.sweep || !channels.length) return;
    this.purgedCount += await this.p.sweep(id, channels).catch(() => 0);
  }

  private queueDelete(m: TrackedMessage, purge = false) {
    if (this.queued.has(m.id)) return;
    this.queued.add(m.id);
    const e = this.pending.get(m.channelId) ?? { since: this.p.now(), msgs: [], purge: new Set<string>() };
    e.msgs.push(m);
    if (purge) e.purge.add(m.id);
    this.pending.set(m.channelId, e);
    if (e.msgs.length >= BATCH_MAX) void this.flushChannel(m.channelId);
  }
  private async flushChannel(channelId: string) {
    const e = this.pending.get(channelId);
    if (!e) return;
    this.pending.delete(channelId);
    this.lastBatch.set(channelId, this.p.now());
    for (const m of e.msgs) this.queued.delete(m.id);
    const early = e.msgs.filter(m => e.purge.has(m.id)), live = e.msgs.filter(m => !e.purge.has(m.id));
    if (live.length) this.blockedCount += await this.p.deleteMessages(live, 'block');
    if (early.length) this.purgedCount += await this.p.deleteMessages(early, 'purge');
  }
  /** Delete queued messages whose batch is ready (or all of them with `force`). Call a few times a second. */
  async flush(force = false): Promise<void> {
    const now = this.p.now();
    const due = [...this.pending].filter(([ch, e]) => force || (now - e.since >= BATCH_MS && now - (this.lastBatch.get(ch) ?? -Infinity) >= BATCH_GAP_MS)).map(([ch]) => ch);
    await Promise.all(due.map(ch => this.flushChannel(ch)));
  }

  private async startLockdown(s: RaidSettings) {
    if (s.shadow) { this.p.record('shadow', this.p.guildId(), `SHADOW (nothing done): would pause invites for ${s.lockdownMinutes} min`); return; }
    const outcome = await this.p.pauseInvites(s.lockdownMinutes);
    this.lockdownUntil = this.p.now() + s.lockdownMinutes * 60_000;
    this.p.record('lockdown', this.p.guildId(), outcome);
  }

  /** Call every few seconds: ends a raid after it has been quiet, resumes invites, forgets old data. */
  async tick(): Promise<void> {
    await this.flush();
    const now = this.p.now();
    const s = this.p.settings();
    if (this.lockdownUntil && now >= this.lockdownUntil) {
      this.lockdownUntil = 0;
      this.p.record('lockdown-end', this.p.guildId(), await this.p.resumeInvites());
    }
    while (this.ring.length && now - this.ring[0]!.ts > RING_SECONDS * 1000) this.ring.shift();
    for (const [id, until] of this.blocked) if (until <= now && !this.raid?.members.has(id)) this.blocked.delete(id);
    const keep = Math.max(TRACK_MINUTES, s.dripWindowMinutes) * 60_000; // slow raids are spotted minutes after the first account joined, so remember them that long
    for (const [id, t] of this.joinedAt) if (now - t > keep && !this.blocked.has(id)) { this.joinedAt.delete(id); this.tracked.delete(id); this.accounts.delete(id); this.pendingInviters.delete(id); }
    const raid = this.raid;
    if (raid) await this.catchSameText();
    if (raid && !raidOver(raid, now, s.quietSeconds) && this.p.onProgress) this.p.onProgress(this.reportOf(raid, now));
    if (!raid || !raidOver(raid, now, s.quietSeconds)) return;
    this.raid = null; this.window.clear(this.p.guildId()); this.profiles.clear();
    for (const id of raid.members.keys()) await this.sweepAccount(id); // one last look for anything that slipped through
    const report = this.reportOf(raid, now);
    this.p.record('raid-end', this.p.guildId(), `raid over: ${report.memberIds.length} accounts (${report.botIds.length} bots); ${this.blockedCount} message(s) deleted while it lasted, ${this.purgedCount} purged`);
    await this.p.announce(`**Raid over**: ${report.memberIds.length} accounts involved (${report.botIds.length} bots). ${this.blockedCount + this.purgedCount} message(s) deleted.`);
    this.p.onEnded(report);
  }

  private reportOf(raid: Raid, now: number): RaidReport {
    const members = [...raid.members.values()];
    const counts = new Map<string, number>();
    for (const m of members) if (m.inviterId) counts.set(m.inviterId, (counts.get(m.inviterId) ?? 0) + 1);
    return {
      guildId: this.p.guildId(), startedAt: raid.startedAt, endedAt: now,
      memberIds: members.map(m => m.id), botIds: members.filter(m => m.bot).map(m => m.id),
      inviterIds: [...counts.keys()], inviterCounts: Object.fromEntries(counts),
    };
  }
}
