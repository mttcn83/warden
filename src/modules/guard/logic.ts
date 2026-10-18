import { PermissionFlagsBits } from 'discord.js';

/** Permissions that make a role dangerous in the wrong hands. */
export const DANGEROUS = [
  PermissionFlagsBits.Administrator, PermissionFlagsBits.ManageGuild, PermissionFlagsBits.ManageRoles, PermissionFlagsBits.ManageChannels,
  PermissionFlagsBits.KickMembers, PermissionFlagsBits.BanMembers, PermissionFlagsBits.ManageWebhooks,
];
export const isDangerous = (perms: { has(p: bigint): boolean }) => DANGEROUS.some(p => perms.has(p));

export interface Suspect { id: string; reasons: string[]; confident: boolean }

/**
 * Who let the raiders in, with the evidence against each person and how sure we are. Most evidence first.
 * "Confident" means more than a lucky guess: they added a raid bot, gave a raider a role, or created an invite several raiders used.
 */
export function rankSuspects(o: {
  inviterCounts: Record<string, number>; botAddExecutors: { id: string; target?: string | null }[]; roleGrantExecutors: { id: string; target?: string | null }[];
  roleEditors?: string[]; raidIds: string[]; ownerId: string; meId: string; trusted: string[]; botIds: Set<string>;
}): Suspect[] {
  const never = new Set([o.ownerId, o.meId, ...o.trusted, ...o.raidIds]);
  const found = new Map<string, Suspect>();
  const add = (id: string | null | undefined, reason: string, confident: boolean) => {
    if (!id || never.has(id) || o.botIds.has(id)) return;
    const s = found.get(id) ?? { id, reasons: [], confident: false };
    if (!s.reasons.includes(reason)) s.reasons.push(reason);
    s.confident ||= confident;
    found.set(id, s);
  };
  for (const [id, n] of Object.entries(o.inviterCounts)) add(id, `created the invite ${n} raider${n === 1 ? '' : 's'} used`, n >= 2);
  for (const e of o.botAddExecutors) add(e.id, 'added a bot that raided', true);
  for (const e of o.roleGrantExecutors) add(e.id, 'gave a raider a role', true);
  for (const id of o.roleEditors ?? []) add(id, 'gave a role dangerous permissions that raiders held', true);
  return [...found.values()].sort((a, b) => Number(b.confident) - Number(a.confident) || b.reasons.length - a.reasons.length);
}
