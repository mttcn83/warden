// Innocent words and names that contain a swear word (the "Scunthorpe problem"). They are blanked out before profanity is looked for.
// Whole words only, so a real insult next to one is still caught.
const SAFE_WORDS = [
  'scunthorpe', 'shiitake', 'penistone', 'cockpit', 'cockburn', 'cockatoo', 'cockatiel', 'cocktail', 'peacock', 'hancock', 'woodcock', 'hitchcock', 'dickens', 'dickinson',
  'cumberland', 'cumbria', 'cumulus', 'cucumber', 'document', 'circumstance', 'cummings', 'cumin',
  'assassin', 'assess', 'assist', 'assume', 'assert', 'asset', 'assign', 'associate', 'class', 'glass', 'grass', 'brass', 'bass', 'mass', 'pass', 'passage', 'passenger', 'passion', 'compass', 'embassy', 'harass',
  'analysis', 'analyst', 'canal', 'penal', 'titmouse', 'bassist', 'therapist', 'grape', 'scrap', 'button', 'butter', 'buttress', 'shitake', 'sussex', 'essex', 'middlesex', 'wessex',
  'arsenal', 'bastion', 'hello', 'shell', 'shelly', 'matsushita',
];
const PHRASES = [/\bcum\s+laude\b/gi, /\bdick\s+(van\s+dyke|cheney|clark|grayson|tracy)\b/gi, /\bdick'?s\s+sporting\b/gi, /\bsuper\s+bowl\s+xx\b/gi];
const WORDS_RE = new RegExp(`(?<![\\p{L}])(?:${SAFE_WORDS.join('|')})(?![\\p{L}])`, 'giu');

/** Replace safe words with spaces of the same length, so positions inside the text stay the same. */
export function blankSafeWords(text: string): string {
  let out = text.replace(WORDS_RE, m => ' '.repeat(m.length));
  for (const p of PHRASES) out = out.replace(p, m => ' '.repeat(m.length));
  return out;
}
