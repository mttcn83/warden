import { normalize } from '../modules/filter/normalize.js';

const SECOND_PERSON = new Set(['you', 'u', 'ur', 'your', 'youre', 'youd', 'youll', 'youve', 'ya', 'yourself', 'urself', 'yourselves', 'yall', 'thou', 'thee']);

/** Swearing that is aimed at someone on its own, whatever the rest of the sentence says. */
export const DIRECTED_PROFANITY: RegExp[] = [
  /\b(fuck|screw|damn|bugger)\s+(you|u|ya|off|yourself|urself|him|her|them|yall)\b/,
  /\bgo\s+(and\s+)?(fuck|screw)\s+(yourself|urself|off)\b/,
  /\b(piss|fuck|sod|bugger)\s+off\b/,
  /\bshut\s+(the\s+)?(fuck|hell|fuk)\s*up\b/,
  /\b(stfu|gtfo)\b/,
  /\b(fuck|fuk|fck)\s+of\b(?!\s+(the|a|an|my|your|our))/,
  /\b(fucc|fuc|fck|fcuk|fukk|phuck|fvck|fuk)\s+(you|u|off|ya|yourself|urself)\b/,
  /\b(eat|suck)\s+(shit|a\s+dick|my\s+(dick|ass|balls))\b/,
  /\bfuck(ing)?\s+(idiot|moron|loser|clown|dumbass|asshole)\b/,
  /\bget\s+fucked\b/,
  /\b(go\s+to|rot\s+in)\s+hell\b/,
  /\b(suck|lick)\s+(my|a)\s+(dick|cock|balls|ass)\b/,
  /\bfuck\s+(off|outta\s+here|your\s+(mom|mother|family|self))\b/,
  /\b(you|u)\s+(piece|sack|bag)\s+of\s+(shit|crap|garbage)\b/,
  /\b(motherfucker|mother\s*fucker)\b.*\b(you|u)\b|\b(you|u)\b.*\b(motherfucker|mother\s*fucker)\b/,
];

export interface Token { raw: string; norm: string; start: number }
export function tokenize(text: string): Token[] {
  return [...text.matchAll(/[\p{L}\p{N}'’]+/gu)].map(m => ({ raw: m[0], norm: normalize(m[0].replace(/['’]/g, '')), start: m.index ?? 0 }));
}

/** Is the token at `index` close to a "you"? (up to 4 tokens before it, 2 after) */
export function nearSecondPerson(tokens: Token[], index: number, before = 4, after = 2): boolean {
  for (let i = Math.max(0, index - before); i <= Math.min(tokens.length - 1, index + after); i++) if (i !== index && SECOND_PERSON.has(tokens[i]!.norm)) return true;
  return false;
}
export const tokenIndexAt = (tokens: Token[], charIndex: number): number => {
  let found = 0;
  for (let i = 0; i < tokens.length; i++) if (tokens[i]!.start <= charIndex) found = i;
  return found;
};
export function matchesDirectedPattern(normalized: string): string | null {
  for (const re of DIRECTED_PROFANITY) { const m = re.exec(normalized); if (m) return m[0]; }
  return null;
}

/** A command to the reader ("uninstall", "shut up", "get lost") means the insult in the same message is aimed at them. */
const IMPERATIVE = /(?:^|[.!?,;]\s*)(?:and\s+|just\s+|please\s+|pls\s+)?(shut\s*up|get\s+(?:out|lost|a\s+life)|go\s+(?:away|back|touch|die|outside)|man\s+up|get\s+a\s+(?:girlfriend|boyfriend|job|hobby|brain|clue)|uninstall|delete\s+(?:the\s+)?game|quit|leave|log\s*off|touch\s+grass|cry\s+about\s+it|stay\s+mad|learn\s+to|go\s+cry)\b/;
/** Commands that only make sense aimed at the reader, so they count anywhere in the message. */
const ANYWHERE_IMPERATIVE = /\b(uninstall|shut\s*up|touch\s+grass|get\s+a\s+life|log\s*off|cry\s+about\s+it|stay\s+mad)\b/;
export const hasImperative = (normalized: string) => IMPERATIVE.test(normalized) || ANYWHERE_IMPERATIVE.test(normalized);
export const hasImagineIdiom = (normalized: string) => /\bimagine\s+(being|having|thinking|losing)\b/.test(normalized);
const FILLER = new Set(['lol', 'lmao', 'haha', 'bro', 'dude', 'man', 'mate', 'ok', 'wow', 'smh', 'bruh', 'omg', 'xd', 'fr']);
export const isFiller = (t: Token) => FILLER.has(t.norm);

/** Statements about the reader that are insults without any single insult word ("you suck", "you are trash"). */
export const SECOND_PERSON_INSULTS: RegExp[] = [
  /\b(you|u)\s+(suck|stink|smell)\b/,
  /\b(you|u)\s*(are|r|re)\s+(so|such|a|an|the|just|really|literally|actually|totally)?\s*(bad|terrible|awful|horrible|useless|worthless|trash|garbage)\b/,
  /\b(you|u)\s*(are|r|re)\s+(the\s+)?worst\b/,
  /\bwhat\s+a\s+(waste|joke|disgrace|embarrassment)\b.*\b(you|u)\b/,
];
export const matchesSecondPersonInsult = (normalized: string): string | null => { for (const re of SECOND_PERSON_INSULTS) { const m = re.exec(normalized); if (m) return m[0]; } return null; };

/** "k y s", "f.u.c.k": letters separated by single spaces or dots, joined back together. Only used to look for words, never for "who is it aimed at". */
export const squashSpaced = (text: string): string => text.replace(/\b(?:[a-z0-9][ .\-_*]){2,}[a-z0-9]\b/gi, run => run.replace(/[ .\-_*]/g, ''));
