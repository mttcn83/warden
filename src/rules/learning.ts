import type { Store } from '../core/db.js';
import { tokenize } from './directed.js';
import { Learner } from './learner.js';
import type { Classification } from './engine.js';

/** One learner per server, kept in memory and saved to the database every couple of minutes. */
const learners = new Map<string, Learner>();

export function learnerFor(store: Store, guildId: string): Learner {
  let l = learners.get(guildId);
  if (!l) { l = Learner.fromJSON(store.loadLearner(guildId) as never); learners.set(guildId, l); }
  return l;
}

/** Only aimed abuse teaches it: insults, swearing at someone, slurs. Its own findings never teach it (no feedback loop). */
export const isHostile = (c: Classification): boolean => c.hits.some(h => h.category === 'insults' || h.category === 'directedProfanity' || h.category === 'slurs');

export function learnFrom(store: Store, guildId: string, userId: string, text: string, c: Classification): void {
  learnerFor(store, guildId).observe(tokenize(text).map(t => t.norm), isHostile(c), userId);
}

export function saveLearners(store: Store): void {
  for (const [id, l] of learners) if (l.dirty) { store.saveLearner(id, l.toJSON()); l.dirty = false; }
}
