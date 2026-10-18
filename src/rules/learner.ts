// The adaptive part of the word filter. It never asks a human anything and never stores messages, only word counts.
//
// Idea: when the rules catch a hostile message ("you are such a gronk"), every other word in it gets a point for
// "showed up in a hostile message". Ordinary words (the, you, game) also appear everywhere else, so their share stays tiny.
// A made-up insult or new slang keeps showing up only in hostile messages, from several different people, so its share
// climbs. Once a word passes the bar it is "learned" and the filter flags it as well (log-only unless you change it).

export interface TermStat { seen: number; hostile: number; users: string[]; last: number }
export interface LearnerState { terms: Record<string, TermStat>; ignored: string[]; version: 1 }

export const LEARNER_LIMITS = {
  minHostile: 4, // hostile messages it must appear in
  minUsers: 3, // different people who used it in hostile messages
  minShare: 0.7, // at least this share of all its appearances must be hostile
  minLength: 3, maxLength: 24,
  maxTerms: 6000, // memory cap per server; rarely-seen words that were never in a hostile message are dropped first
  maxUsersKept: 5,
  expireDays: 45, // words not seen for this long are forgotten
  maxLearned: 200,
};

// Words that mean nothing on their own; they never become learned terms.
const STOPWORDS = new Set(('the and for are but not you your yours with this that have has had was were will would could should about from they them their what when where who why how all any can did does doing done get got just like more most much our out over own same she some such than then there these those too very want been being both each few him her his its let may might must nor now off once only other per see than into onto also because before after again against between during through under until while here yes yeah okay lol lmao omg bro dude man guys guy wtf').split(' '));

export class Learner {
  private terms = new Map<string, TermStat>();
  private ignored = new Set<string>();
  private learnedCache: string[] | null = null;
  dirty = false;

  /** Feed one message. `words` are its normalized words, `hostile` is whether the rules (not the learner) flagged it as aimed abuse. */
  observe(words: string[], hostile: boolean, userId: string, now = Date.now()): void {
    const seenHere = new Set<string>();
    for (const w of words) {
      if (w.length < LEARNER_LIMITS.minLength || w.length > LEARNER_LIMITS.maxLength || STOPWORDS.has(w) || this.ignored.has(w) || !/^\p{L}+$/u.test(w)) continue;
      seenHere.add(w);
    }
    for (const w of seenHere) {
      let t = this.terms.get(w);
      if (!t) { t = { seen: 0, hostile: 0, users: [], last: now }; this.terms.set(w, t); } // clean appearances count too: they are how it tells "game" from "gronk"
      t.seen++; t.last = now;
      if (hostile) {
        t.hostile++;
        if (!t.users.includes(userId) && t.users.length < LEARNER_LIMITS.maxUsersKept) t.users.push(userId);
      }
    }
    this.learnedCache = null; this.dirty = true;
    if (this.terms.size > LEARNER_LIMITS.maxTerms * 1.25) this.prune(now);
  }

  /** Words that cleared the bar. */
  learned(): string[] {
    if (this.learnedCache) return this.learnedCache;
    const out: [string, number][] = [];
    for (const [w, t] of this.terms) {
      if (this.ignored.has(w) || t.hostile < LEARNER_LIMITS.minHostile || t.users.length < LEARNER_LIMITS.minUsers) continue;
      const share = t.hostile / t.seen;
      if (share >= LEARNER_LIMITS.minShare) out.push([w, share * Math.log(1 + t.hostile)]);
    }
    return (this.learnedCache = out.sort((a, b) => b[1] - a[1]).slice(0, LEARNER_LIMITS.maxLearned).map(([w]) => w));
  }
  /** Details for the panel. */
  describe() { return this.learned().map(w => { const t = this.terms.get(w)!; return { term: w, hostile: t.hostile, seen: t.seen, people: t.users.length, last: t.last }; }); }

  /** Make it forget a word and never learn it again. */
  forget(term: string): void { this.ignored.add(term); this.terms.delete(term); this.learnedCache = null; this.dirty = true; }

  prune(now = Date.now()): void {
    const cutoff = now - LEARNER_LIMITS.expireDays * 86_400_000;
    for (const [w, t] of this.terms) if (t.last < cutoff) this.terms.delete(w);
    if (this.terms.size > LEARNER_LIMITS.maxTerms) {
      const rank = (t: TermStat) => (t.hostile > 0 ? 1e9 : 0) + t.seen;
      const keep = [...this.terms].sort((a, b) => rank(b[1]) - rank(a[1]) || b[1].last - a[1].last).slice(0, LEARNER_LIMITS.maxTerms);
      this.terms = new Map(keep);
    }
    this.learnedCache = null; this.dirty = true;
  }

  toJSON(): LearnerState { return { version: 1, terms: Object.fromEntries(this.terms), ignored: [...this.ignored] }; }
  static fromJSON(state: Partial<LearnerState> | null | undefined): Learner {
    const l = new Learner();
    if (state?.terms) for (const [w, t] of Object.entries(state.terms)) l.terms.set(w, { seen: t.seen, hostile: t.hostile, users: t.users.slice(0, LEARNER_LIMITS.maxUsersKept), last: t.last });
    for (const w of state?.ignored ?? []) l.ignored.add(w);
    return l;
  }
}
