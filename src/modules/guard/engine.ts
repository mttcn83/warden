import type { GuardSettings } from '../../core/config.js';
import type { RaidReport } from '../../core/bus.js';
import { rankSuspects } from './logic.js';

export interface GuardPlatform {
  ownerId(): string;
  meId(): string;
  /** null when the account is no longer in the server (already kicked or banned). */
  fetchAccount(id: string): Promise<{ id: string; tag: string; bot: boolean } | null>;
  /** Remove roles and describe what happened (or would happen in shadow mode). */
  stripRoles(id: string, which: 'all' | 'dangerous', shadow: boolean, reason: string): Promise<string>;
  /** Who added raid bots / gave raiders roles / edited roles the raiders hold, found in the audit log; plus which of those ids are bots. */
  findLetIn(report: RaidReport, lookbackMs: number): Promise<{ botAdd: { id: string; target?: string | null }[]; grants: { id: string; target?: string | null }[]; roleEditors?: string[]; botIds: string[] }>;
  record(action: string, userId: string, text: string): void;
  announce(text: string): Promise<void>;
}

export interface GuardRun { lines: string[]; stripped: string[] }

/**
 * Admin guard. The main job is the person who let the raiders in: whoever created the invite, added the raid bots or handed out roles.
 * They lose their dangerous roles first. Then the raiders' own roles are stripped.
 * `early` runs while the raid is still going and only acts on people the evidence is clear about; `handled` remembers who was already dealt with.
 */
export async function runGuard(report: RaidReport, g: GuardSettings, p: GuardPlatform, o: { early?: boolean; handled?: Set<string> } = {}): Promise<string[]> {
  const handled = o.handled ?? new Set<string>();
  const lines: string[] = [];
  const note = (userId: string, action: string, text: string) => {
    p.record(g.shadow ? 'shadow' : action, userId, g.shadow ? `SHADOW (nothing done): ${text}` : text);
    lines.push(`<@${userId}> ${text}`);
  };
  const why = o.early ? 'Admin guard: they let a raid in' : 'Admin guard: cleanup after raid';

  if (g.stripLetterIn) {
    const found = await p.findLetIn(report, g.lookbackMinutes * 60_000);
    const suspects = rankSuspects({
      inviterCounts: report.inviterCounts ?? Object.fromEntries(report.inviterIds.map(id => [id, 1])), botAddExecutors: found.botAdd, roleGrantExecutors: found.grants, roleEditors: found.roleEditors,
      raidIds: report.memberIds, ownerId: p.ownerId(), meId: p.meId(), trusted: g.trustedAdmins, botIds: new Set([...report.botIds, ...found.botIds]),
    });
    const targets = suspects.filter(s => !handled.has(s.id) && (!o.early || s.confident));
    if (!targets.length && !o.early) lines.push(suspects.length ? 'Everyone who let the raiders in was already dealt with.' : 'Nobody was found who let the raiders in.');
    for (const s of targets) {
      const acc = await p.fetchAccount(s.id);
      if (!acc) continue;
      handled.add(s.id);
      note(s.id, 'strip-letter-in', `let the raid in (${s.reasons.join('; ')}): ${await p.stripRoles(s.id, 'dangerous', g.shadow, why)}`);
    }
  }
  if (!o.early && g.stripRaidRoles) {
    for (const id of report.memberIds) {
      const acc = await p.fetchAccount(id);
      if (!acc) continue;
      note(id, 'strip-raider', `raid ${acc.bot ? 'bot' : 'account'}: ${await p.stripRoles(id, 'all', g.shadow, why)}`);
    }
  }
  if (lines.length) await p.announce(`**Admin guard${g.shadow ? ' (shadow mode, nothing changed)' : ''}${o.early ? ', during the raid' : ''}**\n${lines.slice(0, 25).join('\n')}${lines.length > 25 ? `\n…and ${lines.length - 25} more (see the Logs tab)` : ''}`);
  else if (!o.early) await p.announce(`**Admin guard${g.shadow ? ' (shadow mode, nothing changed)' : ''}**\nNothing to do.`);
  return lines;
}
