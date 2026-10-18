import { RegExpMatcher, englishDataset, englishRecommendedTransformers } from 'obscenity';
import { Filter } from 'bad-words';
import { normalize } from '../modules/filter/normalize.js';
import { compile, firstMatch } from './lists.js';
import { blankSafeWords } from './safe.js';

/**
 * Swearing, split the way Discord's own presets are: slurs, sexual content and general profanity.
 * Engine: `obscenity` (MIT): curated terms, handles evasion ("fuuuck", "fvck", "sh1t") and avoids false hits inside normal words.
 * Its terms are grouped by their position in the library's list (pinned to 0.4.6, checked by a test) so no word is typed here.
 * `bad-words` (MIT) adds ~900 more terms, counted as general profanity.
 */
const SLURS = new Set([0, 1, 2, 5, 14, 16, 17, 27, 29, 42, 45, 46, 55, 61, 63]);
const SEXUAL = new Set([3, 4, 9, 11, 13, 15, 20, 22, 24, 25, 26, 28, 30, 31, 32, 33, 35, 36, 37, 39, 40, 41, 43, 44, 47, 48, 49, 51, 53, 54, 56, 57, 58, 62, 66, 67]);

export type ProfanityCategory = 'slurs' | 'sexual' | 'profanity';
export interface ProfanityHit { category: ProfanityCategory; term: string; start: number; end: number }

// termId -> position of the phrase in the library's list (verified by a test against known words).
const dataset = englishDataset as unknown as { containers: unknown[]; patternIdToPhraseContainer: Map<number, number> };
const matcher = new RegExpMatcher({ ...englishDataset.build(), ...englishRecommendedTransformers });
const extras = compile(((new Filter() as unknown as { list: string[] }).list ?? []).filter(w => /^[a-z0-9 ]+$/i.test(w)));

/** Single words from the extra list, used to read masked words like "b*tch". */
export const EXTRA_WORDS: string[] = ((new Filter() as unknown as { list: string[] }).list ?? []).map(w => w.toLowerCase()).filter(w => /^[a-z]{3,14}$/.test(w));
export const categoryOfPhrase = (index: number): ProfanityCategory => (SLURS.has(index) ? 'slurs' : SEXUAL.has(index) ? 'sexual' : 'profanity');
export const OBSCENITY_PHRASES = dataset.containers.length;

export function findProfanity(input: string): ProfanityHit[] {
  const text = blankSafeWords(input);
  const out: ProfanityHit[] = [];
  for (const m of matcher.getAllMatches(text, true)) {
    const index = dataset.patternIdToPhraseContainer.get(m.termId) ?? -1;
    if (index < 0) continue;
    out.push({ category: categoryOfPhrase(index), term: text.slice(m.startIndex, m.endIndex + 1), start: m.startIndex, end: m.endIndex });
  }
  if (!out.some(h => h.category === 'profanity')) {
    const extra = firstMatch(normalize(text), extras);
    if (extra) out.push({ category: 'profanity', term: extra, start: 0, end: 0 });
  }
  return out;
}

export type SwearLevel = 'mild' | 'medium' | 'strong';
const STRONG_SWEAR = /(f+u+c+k|f+u+k|fck|cunt|twat|wank|cocksuck|bollock|motherf|arsehole)/;
const MILD_SWEAR = /^(damn+|goddamn+|dang|darn|hell|crap|crappy|bloody|bugger|piss|pissed|pissing|screw|screwed|heck|freaking|freakin|bs|wtf|omfg)$/;
/** How strong a swear word is: mild (damn, hell, crap), medium (shit, bitch, dick) or strong (the f-word, the c-word). */
export function swearLevelOf(term: string): SwearLevel {
  const t = normalize(term).replace(/[^a-z]/g, '');
  if (STRONG_SWEAR.test(t)) return 'strong';
  if (MILD_SWEAR.test(t)) return 'mild';
  return 'medium';
}
