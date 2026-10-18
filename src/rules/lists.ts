import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { normalize } from '../modules/filter/normalize.js';

/** A list entry compiled to a regex. Plain lines match whole words/phrases; `re:` lines are regexes over normalized text. */
export interface Compiled { entry: string; re: RegExp }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export const wordRe = (w: string) => new RegExp(`(?<![a-z])${escape(normalize(w)).replace(/\s+/g, '\\s+')}(?![a-z])`);

export function compile(entries: string[]): Compiled[] {
  const out: Compiled[] = [];
  for (const entry of entries) {
    if (entry.startsWith('re:')) {
      try { out.push({ entry, re: new RegExp(entry.slice(3), 'i') }); } catch { console.warn(`rules: bad regex in list: ${entry}`); }
      continue;
    }
    if (normalize(entry).replace(/\s/g, '').length < 2) continue;
    out.push({ entry, re: wordRe(entry) });
  }
  return out;
}

export function loadList(file: string): string[] {
  const path = fileURLToPath(new URL(`../../lists/${file}`, import.meta.url));
  try { return readFileSync(path, 'utf8').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#')); }
  catch (e) { console.warn(`rules: could not load ${file}: ${(e as Error).message}`); return []; }
}

/** First entry that matches the normalized text, or null. */
export function firstMatch(normalized: string, list: Compiled[]): string | null {
  for (const { entry, re } of list) if (re.test(normalized)) return entry.startsWith('re:') ? 'pattern' : entry;
  return null;
}
