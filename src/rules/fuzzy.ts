import { STRONG_INSULTS } from './insults.js';

/** True when a and b differ by at most one edit: a substitution, an insertion, a deletion or two swapped letters. */
export function withinOneEdit(a: string, b: string): boolean {
  if (a === b) return true;
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 1) return false;
  let i = 0;
  while (i < la && i < lb && a[i] === b[i]) i++;
  if (la === lb) {
    if (a.slice(i + 1) === b.slice(i + 1)) return true; // one substitution
    return a[i] === b[i + 1] && a[i + 1] === b[i] && a.slice(i + 2) === b.slice(i + 2); // two swapped letters
  }
  return la > lb ? a.slice(i + 1) === b.slice(i) : b.slice(i + 1) === a.slice(i); // one insertion / deletion
}

// Only longer insults are matched loosely: short words one edit apart are usually different words ("losers" / "lovers").
const CANDIDATES = [...STRONG_INSULTS].filter(w => w.length >= 7);

/** A typo of a strong insult ("idiiot", "dumbas", "pathtic"), or null. The first letter must match, which real typos almost always keep. */
const zs = (w: string) => w.replace(/z/g, 's'); // "dumbazz" is "dumbass"
export function fuzzyInsult(raw: string): string | null {
  const token = zs(raw);
  if (STRONG_INSULTS.has(raw)) return null;
  if (STRONG_INSULTS.has(token)) return token;
  if (token.length < 6) return null;
  for (const word of CANDIDATES) if (word[0] === token[0] && withinOneEdit(token, word)) return word;
  return null;
}
