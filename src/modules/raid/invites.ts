import type { Guild } from 'discord.js';

/** Hands out inviters to joins by comparing how many times each invite has been used. */
export function assignInviters(deltas: { inviter: string | null; uses: number }[], joinIds: string[]): Map<string, string | null> {
  const pool: (string | null)[] = deltas.flatMap(d => Array<string | null>(Math.max(0, d.uses)).fill(d.inviter));
  return new Map(joinIds.map((id, i) => [id, pool[i] ?? null]));
}

/**
 * Works out which invite new members used (and who created it) by diffing invite use counts. Needs Manage Server; fails quietly without it.
 * Joins that arrive close together share one lookup (a burst of 200 joins is one API call, not 200), and the uses are shared out among them.
 */
export class InviteTracker {
  private uses = new Map<string, Map<string, { uses: number; inviter: string | null }>>();
  private waiting = new Map<string, { ids: string[]; cb: Map<string, (inviter: string | null) => void>; timer: NodeJS.Timeout }>();

  async snapshot(guild: Guild): Promise<void> {
    try {
      const invites = await guild.invites.fetch();
      this.uses.set(guild.id, new Map(invites.map(i => [i.code, { uses: i.uses ?? 0, inviter: i.inviterId ?? null }])));
    } catch { /* no permission or invites disabled */ }
  }

  /** Ask who invited `memberId`; the answer arrives shortly after, once the batch has been looked up. */
  request(guild: Guild, memberId: string, done: (inviter: string | null) => void, delayMs = 600): void {
    let w = this.waiting.get(guild.id);
    if (!w) {
      w = { ids: [], cb: new Map(), timer: setTimeout(() => void this.flush(guild), delayMs) };
      w.timer.unref();
      this.waiting.set(guild.id, w);
    }
    w.ids.push(memberId); w.cb.set(memberId, done);
  }

  private async flush(guild: Guild): Promise<void> {
    const w = this.waiting.get(guild.id); if (!w) return;
    this.waiting.delete(guild.id);
    const before = this.uses.get(guild.id);
    await this.snapshot(guild);
    const after = this.uses.get(guild.id);
    const deltas: { inviter: string | null; uses: number }[] = [];
    if (before && after) for (const [code, now] of after) { const d = now.uses - (before.get(code)?.uses ?? 0); if (d > 0) deltas.push({ inviter: now.inviter, uses: d }); }
    const out = assignInviters(deltas, w.ids);
    for (const [id, cb] of w.cb) cb(out.get(id) ?? null);
  }
}
