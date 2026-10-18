export interface Join { id: string; ts: number; bot: boolean; inviterId: string | null; weight?: number }
export interface Raid { startedAt: number; lastRaidJoin: number; members: Map<string, Join>; kind: 'burst' | 'drip' }

/** Sliding window of recent joins per server (pure, clock-injectable). One entry per account: someone who leaves and rejoins counts once. */
export class JoinWindow {
  private joins = new Map<string, Join[]>();
  /** Record a join and return the joins still inside the window (including this one). */
  record(guildId: string, join: Join, windowSeconds: number): Join[] {
    const cutoff = join.ts - windowSeconds * 1000;
    const list = (this.joins.get(guildId) ?? []).filter(j => j.ts > cutoff && j.id !== join.id);
    list.push(join);
    this.joins.set(guildId, list);
    return list;
  }
  clear(guildId: string) { this.joins.delete(guildId); }
}

/** How many "full" joins a list is worth: established accounts count for a fraction, so a crowd of normal members does not look like a raid. */
export const joinWeight = (joins: Join[]) => joins.reduce((sum, j) => sum + (j.weight ?? 1), 0);

/** An account counts as a raider if it is young enough (or minAccountAgeDays is 0) or is a bot. Established accounts with a profile picture are let through. */
export function isRaider(o: { bot: boolean; accountCreatedAt: number; now: number; minAccountAgeDays: number; hasAvatar?: boolean }): boolean {
  if (o.bot) return true;
  if (o.minAccountAgeDays <= 0) return true;
  if (o.hasAvatar === false) return true; // old but blank: could be a bought or farmed account
  return o.now - o.accountCreatedAt < o.minAccountAgeDays * 86_400_000;
}

export interface Profile { id: string; username: string; createdAt: number; hasAvatar: boolean; bot: boolean }
const DAY = 86_400_000;

/** The name without the parts bots randomise: digits, separators and case. "RaidBot_0042" and "raidbot-17" share a stem. */
export const nameStem = (username: string) => username.toLowerCase().replace(/[\d_\-.\s]+/g, '').replace(/(.)\1{2,}/g, '$1$1');

/**
 * How suspicious a join looks, from what Discord tells us about the account and from the other recent joins. Pure.
 * One signal alone is never enough: a new account with no picture is just a new member. Several together are a bot farm.
 */
export function suspicion(a: Profile, recent: Profile[], now: number): { score: number; reasons: string[] } {
  const reasons: string[] = []; let score = 0;
  const age = now - a.createdAt;
  if (age < DAY) { score += 2; reasons.push('account created less than a day ago'); }
  else if (age < 7 * DAY) { score += 1; reasons.push('account created this week'); }
  if (!a.hasAvatar) { score += 1; reasons.push('no profile picture'); }
  const others = recent.filter(r => r.id !== a.id);
  const stem = nameStem(a.username);
  if (stem.length >= 3 && others.filter(r => nameStem(r.username) === stem || (stem.length >= 5 && nameStem(r.username).startsWith(stem.slice(0, 5)))).length >= 2) { score += 2; reasons.push('username looks like other recent joins'); }
  if (others.filter(r => Math.abs(r.createdAt - a.createdAt) < 30 * 60_000).length >= 3) { score += 2; reasons.push('created at the same time as other recent joins'); }
  if (a.bot) { score += 1; reasons.push('is a bot'); }
  return { score, reasons };
}
export const SUSPICIOUS_AT = 3;

export const raidOver = (raid: Raid, now: number, quietSeconds: number) => now - raid.lastRaidJoin >= (raid.kind === 'drip' ? Math.max(quietSeconds, 900) : quietSeconds) * 1000;
