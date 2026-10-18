import type { Category, Classification, Hit } from './engine.js';

export type Mode = 'off' | 'log' | 'delete';
/** An exception: in these channels / for members with these roles, these kinds of message are handled differently. */
export interface Exception { channels: string[]; roles: string[]; categories: Category[]; mode: Mode }
/** Which swear words count when general swearing is not allowed: only the strongest, strong and medium, or all of them. */
export type SwearSetting = 'all' | 'medium' | 'strong';
export interface Policy { categories: Record<Category, Mode>; exceptions: Exception[]; swearLevel?: SwearSetting }
export interface Place { channelId: string; roleIds: string[] }
export interface HitOutcome { hit: Hit; mode: Mode; why: string }
export interface Decision { action: 'none' | 'log' | 'delete'; outcomes: HitOutcome[]; weight: number }

/** How many strikes a delete is worth. Serious categories escalate faster; mild put-downs, swearing and invite links never count, so chatting never gets anyone timed out. */
export const STRIKE_WEIGHT: Record<Category, number> = { personalInfo: 1, doxxing: 3, threats: 2, scams: 2, slurs: 2, insults: 1, rudeness: 0, directedProfanity: 1, profanity: 0, sexual: 1, invites: 0, custom: 1, learned: 0 };
const RANK: Record<Mode, number> = { off: 0, log: 1, delete: 2 };
const WHY: Record<Mode, string> = { off: 'allowed by your settings', log: 'logged only', delete: 'deleted' };
const WHY_EXCEPTION: Record<Mode, string> = { off: 'allowed by exception', log: 'logged only by exception', delete: 'deleted by exception' };

/** Does this exception cover a message sent in this place? Empty channel/role lists mean "any". */
export const exceptionApplies = (e: Exception, place: Place) =>
  (e.channels.length === 0 || e.channels.includes(place.channelId)) && (e.roles.length === 0 || e.roles.some(r => place.roleIds.includes(r)));

export function decide(c: Classification, p: Policy, place: Place): Decision {
  const outcomes: HitOutcome[] = c.hits.map(hit => {
    let mode = p.categories[hit.category];
    let why = WHY[mode];
    // Swearing below the chosen level is allowed: "strong" lets damn and shit through, "medium" only lets damn and hell through.
    if (hit.category === 'profanity' && hit.level && ((p.swearLevel === 'strong' && hit.level !== 'strong') || (p.swearLevel === 'medium' && hit.level === 'mild'))) { mode = 'off'; why = 'allowed: below your swearing level'; }
    // Exceptions are checked in order; the last one that covers this kind of message in this place wins.
    p.exceptions.forEach((e, i) => {
      if (e.categories.includes(hit.category) && exceptionApplies(e, place)) { mode = e.mode; why = `${WHY_EXCEPTION[e.mode]} ${i + 1}`; }
    });
    return { hit, mode, why };
  });
  const worst = outcomes.reduce<Mode>((m, o) => (RANK[o.mode] > RANK[m] ? o.mode : m), 'off');
  const weight = outcomes.filter(o => o.mode === 'delete').reduce((w, o) => Math.max(w, STRIKE_WEIGHT[o.hit.category]), 0);
  return { action: worst === 'off' ? 'none' : worst, outcomes, weight };
}

/** Timeout length (seconds) once strikes pile up, or 0 for none. */
export function escalate(total: number, e: { enabled: boolean; timeoutAfter: number; timeoutMinutes: number; longTimeoutAfter: number; longTimeoutHours: number }): number {
  if (!e.enabled) return 0;
  if (total >= e.longTimeoutAfter) return e.longTimeoutHours * 3600;
  if (total >= e.timeoutAfter) return e.timeoutMinutes * 60;
  return 0;
}
