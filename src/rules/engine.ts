import { normalize, foldLetters } from '../modules/filter/normalize.js';
import { compile, firstMatch, loadList, wordRe } from './lists.js';
import { findProfanity, swearLevelOf } from './profanity.js';
import { INSULT_PHRASES, MILD_PHRASES, MILD_WORDS, STRONG_INSULTS, WEAK_INSULTS } from './insults.js';
import { hasImagineIdiom, hasImperative, isFiller, matchesDirectedPattern, matchesSecondPersonInsult, nearSecondPerson, squashSpaced, tokenIndexAt, tokenize } from './directed.js';
import { findPii } from './pii.js';
import { findInvites, findScams } from './scams.js';
import { fuzzyInsult } from './fuzzy.js';
import { Unmasker } from './unmask.js';
import { EXTRA_WORDS } from './profanity.js';

export type Category = 'personalInfo' | 'doxxing' | 'threats' | 'scams' | 'slurs' | 'insults' | 'rudeness' | 'directedProfanity' | 'profanity' | 'sexual' | 'invites' | 'custom' | 'learned';
export const CATEGORIES: Category[] = ['personalInfo', 'doxxing', 'threats', 'scams', 'slurs', 'insults', 'rudeness', 'directedProfanity', 'profanity', 'sexual', 'invites', 'custom', 'learned'];
export interface Hit { category: Category; term: string; level?: 'mild' | 'medium' | 'strong'; soft?: boolean }
const isInsultish = (c: Category) => c === 'insults' || c === 'rudeness';
export interface Context { mentionsOthers: boolean; replyToOther: boolean }
export interface Extras { customWords: string[]; customRegex: string[]; allowWords: string[]; learnedWords?: ReadonlySet<string> }
export interface Classification { hits: Hit[]; maybes?: Maybe[] }

// Compound insults built from a swear stem ("asshat", "shitstain", "dickwad")
const COMPOUND = /^(ass|shit|dick|cum|douche|fuck|cunt|twat|bitch|piss|cock|prick|arse|bollock|wank|dirt|scum|sleaze)(hat|clown|stain|wad|nuts|lord|waffle|bag|bucket|nozzle|dumpster|head|face|wipe|monger|muffin|lips|breath|brain|weasel|goblin|canoe|rocket|pilot|burger|tard|wit|ard|ball|wagon)s?$/;
const ATTRIBUTIVE = new Set('stupid dumb idiotic useless annoying ridiculous pathetic lame crappy garbage trash dumber dumbest stupidest'.split(' '));
const DETERMINERS = new Set('this that the my his her our their these those its a an'.split(' '));
const NEGATORS = new Set(['not', 'never', 'isnt', 'arent', 'wasnt', 'werent', 'dont', 'no', 'aint', 'cant', 'wont', 'neither', 'nor']);
const SECOND = new Set(['you', 'u', 'ur', 'youre', 'your']);
const FIRST_PERSON = /\b(i|i'?ll|i'?m|im|ill|imma|ima|we|we'?ll)\b/;
const VIOLENT = /\b(kill|murder|end|ruin|expose|beat|hit|destroy|strangle|choke|stab|shoot|slap|punch|smash|crush|fight|jump|wreck|bury)\b/;
const BANTER_CUE = /\b(lol|lmao|lmfao|rofl|haha+|hehe+|xd)\b|[😂🤣😭💀😆]|\b(smash|mario|kart|valorant|fortnite|minecraft|apex|cod|warzone|chess|ranked|scrim|lobby|1v1|rematch|the\s+game|this\s+game|match|round|bring\s+it|no\s+cap|literally|i\s+swear)\b|\b(for|if\s+you)\s+(spoil\w*|tell\w*|eat\w*|steal\w*|stealing|taking|using|touch\w*|forgetting|forgot|losing|ruin\w*|drink\w*|cheat\w*|lagging|being\s+late)\b|\b(with\s+the\s+link|in\s+a\s+sec|a\s+sec|later)\b|\b(let\s+me\s+in|open\s+(up|the\s+door)|hurry\s+up|its?\s+cold|bro|dude)\b|\bif\s+this\s+\w+\s+(doesn'?t|does\s+not|keeps|won'?t)\b/u;
// real-world detail makes a threat credible, whatever the tone
const STALK_HARD = /\b(know\s+where|where\s+(you|u|your\s+\w+)\s+(live|work|go|sleep|study)|your\s+(family|kids|mom|dad|parents|address|school)|irl|real\s+life|follow\s+you|find\s+you|regret|pay\s+for|after\s+school|hospital|funeral|the\s+ground|body)\b/;
const ASS_IMPERATIVE = /\b(get|move|haul|drag|sit|shake|bring|put|kick|save|watch|cover)\s+(your|ur)\s+ass\b/;
const SERVER_ATTACK = /\b(raid|nuke|ddos|crash|mass\s+report)\s+(this|the|your|that)\s+(server|chat|channel|community|guild)\b/; // a raid on the server itself is never "game talk"
const GAME_TALK = /\b(game|match|round|ranked|1v1|queue|lobby|arena|rank|raid|boss|stream|valorant|fortnite|minecraft|apex|league|cs|csgo|dota|rocket league|fight|duel|pvp|pve|tournament|scrim|dungeon|clutch|spawn|respawn|cooldown|chess|round)\b/;
const threats = compile(loadList('threats-en.txt'));
const doxxing = compile(loadList('doxxing-en.txt'));
const belittling = compile(loadList('abuse-en.txt'));
const intlLines = loadList('intl-en.txt');
const intlInsults = compile(intlLines.filter(l => !l.startsWith('slur:')));
const intlSlurs = compile(intlLines.filter(l => l.startsWith('slur:')).map(l => l.slice(5)));
const mildBelittling = compile(loadList('abuse-mild-en.txt'));
const hateTalk = compile(loadList('hate-en.txt'));
const insultPhrases = compile(INSULT_PHRASES);
// Words that people hide behind * or # ("f*ck", "id*ot"): the swear list plus the strong insults, plus the core words the swear library handles.
const CORE = 'fuck shit bitch cunt dick cock pussy whore slut bastard nigger nigga faggot retard asshole piss twat wanker fucker motherfucker bullshit dumbass jackass'.split(' ');
const unmasker = new Unmasker([...EXTRA_WORDS, ...STRONG_INSULTS, ...WEAK_INSULTS, ...CORE, ...'kill murder stab shoot rape hang die suicide'.split(' ')], CORE);

// Words that can be cut in two by a space ("id iot") and still be read.
const JOIN_VOCAB = new Set([...CORE.filter(w => w.length >= 4), ...[...STRONG_INSULTS].filter(w => /^[a-z]{5,}$/.test(w))]);

const customCache = new Map<string, RegExp>();
const customRe = (w: string) => { let r = customCache.get(w); if (!r) { r = wordRe(w); customCache.set(w, r); if (customCache.size > 5000) customCache.clear(); } return r; };

// Talking ABOUT abuse is not abuse: reports ("he said ..."), rule reminders, quotes, definitions and fiction.
const REPORTED = /["“”']?\s*,\s*(said|says|shouted|whispered|growled|hissed|snarled|yelled|replied)\s+(the|a|an|he|she|they|his|her)\b|\b(he|she|they|someone|somebody|people|guy|girl|dude|user|teacher|boss|mom|dad|friend|brother|sister|ex|stranger|kid|pastor|priest|preacher|principal|coach|manager)\s+(\w+\s+){0,2}(said|says|called|calls|told|texted|wrote|posted|replied|typed|sent|tweeted|messaged|dms?ed)\b|\b(rules?|rule\s*\w{1,2})\s*:|\bthe\s+(word|phrase|term|insult|slur)\s+\S+|\bwhat\s+does\b|\b(in|from)\s+the\s+(book|movie|film|show|song|game|series|anime|episode|story|lyrics)\b|\bthe\s+(character|villain|hero|protagonist)\b|\b(no|don'?t|never|not\s+allowed\s+to)\s+(calling|saying|telling|using|call|say)\b|\b(mod\s+tip|reminder\s*:|reminder\s+(to|that)\s+(everyone|all|please|be|don'?t|no|we|you\s+(can'?t|cannot|must|should|need\s+to)\b))|\bas\s+a\s+(mod|moderator|admin),?\s+(i|we)\b|\b(insults?|words?|slurs?|names?|terms?)\s+like\b|\bwill\s+(get\s+you|result\s+in)\s+(a\s+)?(timed?\s*out|ban|banned|muted|kicked|mute|timeout)\b/;
const hasQuote = (t: string) => [...t.matchAll(/"([^"]{3,})"|“([^”]{3,})”|(?:^|[\s(\[:])['‘](.{3,}?)['’](?=[\s.,!?)\]:]|$)/g)].some(m => /\s/.test((m[1] ?? m[2] ?? m[3] ?? '').trim())); // a quoted phrase, not a single quoted word
// Affection next to a mild insult ("you're annoying but in a good way", "i love you") is teasing. Strong insults, slurs and threats stay flagged.
// "you magnificent idiot", "you beautiful bastard": a kind word in front of the insult turns it into a pet name
const POSITIVE_INSULT = /\b(magnificent|beautiful|glorious|lovely|wonderful|amazing|awesome|incredible|precious|sweet|dear|lovable|brilliant|talented|gorgeous|adorable)\s+(\w+\s+)?(idiot|bastard|moron|fool|dumbass|nerd|dork|menace|clown|goof|weirdo|legend|jerk)\b/;
const SOFT_WORDS = new Set('dork nerd goon annoying cringe dummy dense clueless bum jerk tool weirdo menace fool nuisance pest silly goof'.split(' '));
// laughing next to a mild word means teasing
const LAUGH = /\b(lol+|lma+o+|lmf+a+o+|rofl|ha(ha)+h?|he(he)+|xd+)\b|[😂🤣😭💀😆😹]/u;
// the writer says it is a joke
const RETRACT = /\b(jk|j\/k|just\s+kidding|just\s+joking|affectionate|affectionately|kidding)\b|(?:^|\s)\/(j|lh|hj|affectionate)\b/;
const WARM_WORDS = /\b(great|amazing|awesome|incredible|insane|love|loved|proud|thanks|thank|best|beautiful|congrats|wonderful|fantastic|brilliant|awesome|lovely)\b/g;
const HEARTS = /thank(s|\s+you)[^.!?]{0,15}[❤♥💕💖💗]|<3|[❤💕💖💗]\uFE0F?\s*$/u; // a heart next to thanks, or ending the message
const AFFECTION = /\b(i'?m\s+proud\s+of\s+you|proud\s+of\s+you|(?<!(?:ever|never|nobody|not|no\s+one|n't)\s)love\s+(you|u|ya)|i\s+love|in\s+a\s+good\s+way|^\W*thank(s|\s+you)(?!\s+for\s+your\s+(valuable|useful|great|helpful|input|opinion|feedback|contribution))|thank(s|\s+you)\s+so\s+much|congrats(?!\s*,?\s*(on\s+being|you\s+(made|managed|finally|just|really)))|(?<!(?:would|will|wont|won't|never|nobody|no\s+one|n't|even)\s)miss(ed)?\s+(you|u)|you'?re\s+the\s+best|my\s+favou?rite|jk|just\s+kidding|appreciate\s+you)\b/;
// "stfu" / "shut up" that is plainly excitement ("stfu i can't believe you got the job")
const EXCITED = /\b(you\s+(did\s+not|didn'?t|did)\s+(just|really|actually)|i\s+can'?t\s+believe|no\s+(\w+\s+)?way|that'?s\s+(so\s+)?(cool|good|funny|sick|dope|lit|great|nice)|omg|oh\s+my\s+god|for\s+real|you\s+got\s+the|that'?s\s+(so\s+)?(amazing|insane|crazy|awesome|wild)|congrats)\b/;

// Fiction and role-play: *draws sword*, (OOC: ...), IC: ...
const SCAM_WARNING = /\b(be\s+careful|beware|watch\s+out|reminder|warning|phishing\s+example|scam\s+(alert|warning|example)|report\s+scam|don'?t\s+(click|fall|trust)|never\s+(click|share|dm)|will\s+never\s+(dm|ask)|is\s+a\s+scam|trying\s+to\s+(steal|scam)|if\s+someone\s+(offers|asks)|how\s+to\s+spot)\b/;
const SCAM_LEGIT = /\b(we|our\s+server|the\s+server|mods?|staff)\s+(hold|host|run|are\s+hosting|do|have)\b.{0,50}\bgiveaway|\bno\s+links?\s+required|\brules\s+in\s+#|\breact\s+to\s+enter\b/;
const stripQuotes = (t: string) => t.replace(/"[^"]{3,}"|“[^”]{3,}”|(^|[\s(\[:])'.{3,}?'(?=[\s.,!?)\]:]|$)/g, ' ');
const ROLEPLAY = /\((?:ooc|ic)\b|\b(?:ooc|ic)\s*:/i;
const isRoleplay = (t: string) => ROLEPLAY.test(t) || [...t.matchAll(/(?:^|\s)\*([^*\n]{2,80})\*/g)].some(m => !/^(you|u|ur|your|youre|you're)\b/i.test(m[1]!.trim())); // *draws sword*, but not *you are an idiot*
// Someone describing abuse that happened to them ("I got called a ...") or talking about a word itself.
const VICTIM = /\b(got|was|been|being|get|were)\s+called\b|\bcalled\s+(me|him|her|us|them|my\s+\w+)\s+(a|an)\b|\bthey\s+call\s+me\b/;
const WORD_ITSELF = /\bthe\s+(word|term|phrase|slur)\b|\bwhat\s+does\b.{0,30}\bmean\b|\b(removed|banned|replaced)\s+(from|by)\b.{0,30}\b(word|term)\b/;
// Pets and babies are told off all day long ("you dumb dog, why did you eat the couch")
const PET_NOUNS = '(?:dog|doggo|puppy|pup|cat|kitty|kitten|hamster|bunny|parrot|pet|baby|toddler|horse|fish|bird|cow|goat|chicken|printer|computer|laptop|phone|car|router|machine)';
const PET_TARGET = new RegExp(`\\b(?:dumb|dumber|stupid|silly|naughty|bad|crazy|useless|annoying)\\s+${PET_NOUNS}\\b`);
const NOUN_SWEAR = new Set('bastard bitch asshole dumbass jackass prick dick dickhead idiot fucker motherfucker shit ass'.split(' '));
const AWW = /\b(aww+|love\s+it|i\s+love\s+(it|this|that)|so\s+sweet|that'?s\s+sweet)\b|[🥹🥺🥰😍🫶❤💕💖💗]/u;
// insults that stay insults even when the writer laughs
const HARD_INSULTS = new Set('worthless pathetic disgusting repulsive revolting scum filth vermin parasite maggot lowlife degenerate pervert retard'.split(' '));
const INVITE = /\b(with\s+me|let'?s|lets|together|join\s+me|come\s+with|we\s+should)\b/;
const TAUNTS = new Set(['touch grass', 'go outside', 'get a life']);

const sentencesOf = (text: string) => text.split(/[.!?\n]+/).map(t => t.trim()).filter(Boolean);

/** "id iot", "go f uck": join neighbouring short pieces whenever together they spell a bad word. */
function joinSplitWords(text: string): string {
  const parts = [...text.matchAll(/\p{L}+/gu)].map(m => ({ w: m[0], start: m.index!, end: m.index! + m[0].length }));
  let out = '', last = 0;
  for (let i = 0; i < parts.length; i++) {
    let done = false;
    for (let j = Math.min(parts.length - 1, i + 5); j > i && !done; j--) { // longest run first: "id i o t" before "id i"
      let ok = true, joined = '';
      for (let k = i; k <= j; k++) { joined += parts[k]!.w; if (k < j && (parts[k + 1]!.start !== parts[k]!.end + 1 || text[parts[k]!.end] !== ' ' || parts[k]!.w.length > 5)) { ok = false; break; } }
      if (ok && parts[j]!.w.length <= 5 && JOIN_VOCAB.has(normalize(joined))) { out += text.slice(last, parts[i]!.start) + joined; last = parts[j]!.end; i = j; done = true; }
    }
  }
  return out + text.slice(last);
}

/** Spellings that need a second look: lookalike alphabets, 1 for l, split words (id iot), spaced letters. */
function variantsOf(rawText: string): string[] {
  const out = new Set<string>();
  const folded = /(\p{L})\1{2,}|(\p{L})\2(\p{L})\3/u.test(rawText) ? rawText.replace(/(\p{L})\1+/gu, '$1') : rawText; // "youuuu", "ffuucckk"
  out.add(folded);
  if (/(\p{L})\1{2,}/u.test(rawText)) out.add(rawText.replace(/(\p{L})\1{2,}/gu, '$1')); // only the long runs: "urselfffff" without damaging "uninstall"
  out.add(rawText.replace(/\b(?:[a-z][.\-_*]){2,}[a-z]\b\.?/gi, m => m.replace(/[.\-_*]/g, ''))); // "f.u.c.k"
  out.add(squashSpaced(rawText));
  out.add(squashSpaced(rawText.replace(/\b([ai]) (?=(?:[a-z] ){2,}[a-z]\b)/gi, '$1\u0000')).replace(/\u0000/g, ' ')); // "such a d u m b a s s"
  out.add(foldLetters(rawText)); // boxed, struck-through and lookalike letters
  if (/1/.test(rawText)) out.add(rawText.replace(/1/g, 'l')); // "he11"
  // "id iot", "sh it head", "bi tch": a bad word cut in two by a space
  out.add(joinSplitWords(rawText));
  out.delete(rawText);
  return [...out];
}

/** Everything a message contains, by category, before any server policy is applied. */
/** Something the rules noticed but excused because of the context. A person should look at it. */
export interface Maybe extends Hit { why: string }
const REVIEW = new Set<Category>(['threats', 'slurs', 'scams', 'doxxing', 'directedProfanity']);

export function classify(original: string, ctx: Context, extras: Extras = { customWords: [], customRegex: [], allowWords: [] }): Classification {
  const rawText = original.replace(/[\u200B-\u200F\u202A-\u202E\u2060-\u2064\uFEFF\u00AD]/g, ''); // invisible characters hide words
  let hits = classifyRaw(rawText, ctx, extras).hits;
  for (const alt of variantsOf(rawText)) for (const h of classifyRaw(alt, ctx, extras).hits) if (!hits.some(o => o.category === h.category && o.term === h.term)) hits.push(h);
  const normalized = normalize(rawText);
  const sentences = sentencesOf(rawText);
  const maybes: Maybe[] = [];
  /** Keep the hits `keep` allows. A serious finding dropped because it might be a quote, a report or role-play goes on the "needs a look" list; obviously friendly or harmless ones (reason null) are simply dropped. */
  const drop = (why: string | null, keep: (h: Hit) => boolean) => {
    const kept: Hit[] = [];
    for (const h of hits) {
      if (keep(h)) kept.push(h);
      else if (why && REVIEW.has(h.category) && !maybes.some(m => m.category === h.category && m.term === h.term)) maybes.push({ ...h, why });
    }
    hits = kept;
  };
  drop('it sounds like a joke or a game, but it reads like a threat', h => !h.soft);
  const speech = (h: Hit) => !isInsultish(h.category) && h.category !== 'directedProfanity' && h.category !== 'threats';
  if (/\bretard(ed|ation)?\s+(timing|ignition|spark|advance|growth|development|reaction|cure|setting)\b|\b(timing|ignition|spark)\s+retard/.test(normalized)) drop(null, h => !(h.category === 'slurs' && /retard/.test(normalize(h.term)))); // engine talk
  if (VICTIM.test(normalized) || WORD_ITSELF.test(normalized)) drop('it reads like someone describing abuse or talking about a word', h => h.category !== 'slurs' && speech(h)); // describing abuse, not doing it
  // Warning others about a scam is not a scam, unless the message contains a real link.
  if (SCAM_WARNING.test(normalized) && !/\b[a-z0-9-]+\.[a-z]{2,}\//i.test(rawText) && !/\b[a-z0-9-]+\.(com|net|org|ru|xyz|top|gg|me|io|co|ly|shop|site|click|link|live|fun|help|info|store)\b/i.test(rawText)) drop(null, h => h.category !== 'scams');
  if (REPORTED.test(normalized)) drop('it reads like a quote or a report of what someone said', speech);
  else if (hasQuote(rawText)) {
    // Only what is said inside the quotation marks is "reported"; anything outside them still counts.
    const outside = classifyRaw(stripQuotes(rawText), ctx, extras).hits;
    drop('the words are inside quotation marks', speech);
    for (const h of outside) if ((isInsultish(h.category) || h.category === 'directedProfanity' || h.category === 'threats') && !hits.some(o => o.category === h.category && o.term === h.term)) hits.push(h);
  }
  if (/\b(sinners?|they|he|she|people|those|everyone|the\s+wicked)\s+(will\s+)?(go|goes|going)\s+to\s+hell\b|\b(sermon|pastor|preacher|scripture|bible)\b/.test(normalized)) drop(null, h => h.category !== 'directedProfanity');
  if (/\bregex\b|\/\([^)]*\|[^)]*\)\/[a-z]*|\bgrep\b|\bautomod\b.{0,30}\b(config|filter|list|rule)/.test(normalized)) drop(null, h => h.category !== 'threats' && !isInsultish(h.category) && h.category !== 'directedProfanity' && h.category !== 'slurs');
  if (/\bnot\s+all\b|\bnot\s+every\b|\bstereotypes?\b|\bmyth\s+that\b|\bit'?s\s+(wrong|false|untrue)\s+to\s+say\b/.test(normalized)) drop('it may be arguing against a stereotype', h => !(h.category === 'slurs' && h.term === 'hate speech'));
  if (SCAM_LEGIT.test(normalized) && !/\b[a-z0-9-]+\.[a-z]{2,}\//i.test(rawText)) drop(null, h => h.category !== 'scams');
  if (isRoleplay(rawText) && !/\b(kys|kill\s*(your|ur)\s*self)\b/.test(normalized)) drop('it looks like role-play', h => h.category !== 'threats' && !isInsultish(h.category) && h.category !== 'directedProfanity');
  // Affection ("i love you") cancels anything but the worst insults; a laugh or emoji only cancels the soft teasing words. Only the sentence the insult is in counts.
  const retracted = RETRACT.test(rawText.toLowerCase());
  const warmth = (normalized.match(WARM_WORDS) ?? []).length;
  // A strong insult with a laugh in the same sentence ("lmao you idiot") is teasing, so it counts as rudeness: logged on Standard, deleted on Strict.
  hits = hits.map(h => {
    if (h.category !== 'insults' || HARD_INSULTS.has(h.term) || isPhraseStrong(h.term) || /\b(waste\s+of|piece\s+of|garbage|trash|nobody\s+likes)\b/.test(h.term) || h.term === 'belittling') return h;
    const at = sentences.findIndex(x => normalize(x).includes(normalize(h.term).trim()) && normalize(h.term).trim().length >= 3);
    return LAUGH.test(at >= 0 ? sentences[at]! : rawText) ? { ...h, category: 'rudeness' as Category } : h;
  });
  // "fuck you for making me cry (i love it)" is not an attack
  if (/\bfuck\s+you\s+for\b/.test(normalized) && (AFFECTION.test(normalized) || AWW.test(rawText))) drop(null, h => !(h.category === 'directedProfanity' && /^fuck\s+you$/.test(normalize(h.term))));
  drop(null, h => {
    const noun = h.category === 'directedProfanity' && NOUN_SWEAR.has(normalize(h.term)); // "you ugly bastard, i missed you" but not "fuck you"
    if (!isInsultish(h.category) && !noun) return true;
    const at = sentences.findIndex(x => normalize(x).includes(normalize(h.term).trim()) && normalize(h.term).trim().length >= 3);
    const sentence = at >= 0 ? sentences[at]! : rawText, next = at >= 0 ? (sentences[at + 1] ?? '') : '';
    const ns = normalize(sentence), nn = normalize(next);
    if (retracted) return false; // "jk", "/j", "(affectionate)"
    if ((AFFECTION.test(ns) || HEARTS.test(sentence) || AWW.test(sentence) || POSITIVE_INSULT.test(ns) || /^\W*(love\s+(you|u|ya)|thank|<3|❤)/.test(nn)) && !isPhraseStrong(h.term)) return false; // "you magnificent idiot, proud of you"
    if (noun) return !LAUGH.test(sentence); // "you sneaky little shit haha"
    if (warmth >= 2 && LAUGH.test(sentence) && !isPhraseStrong(h.term)) return false; // a friendly message with a laughing jab in it
    if (PET_TARGET.test(ns) && !isPhraseStrong(h.term)) return false; // "you dumb dog"
    if (INVITE.test(ns) && TAUNTS.has(h.term)) return false; // "come touch grass with me"
    if (LAUGH.test(sentence) && (h.term === 'mild belittling' || SOFT_WORDS.has(h.term) || /^(you|u)\s*(are|r|re)\s+(the\s+)?worst$/.test(h.term))) return false;
    return true;
  });
  if (PRAISE.test(normalized)) drop(null, h => h.category !== 'directedProfanity');
  if (/\bno\s+(\w+\s+)?way\b|\bholy\s+(shit|fuck|crap)\b/.test(normalized)) drop(null, h => h.category !== 'directedProfanity'); // "no fucking way you did that"
  if (EXCITED.test(normalized)) drop(null, h => !(h.category === 'directedProfanity' && /^(stfu|shut\s+up|shut\s+the\s+(fuck|hell)\s+up)/.test(normalize(h.term))));
  return { hits, maybes };
}
// "damn you're good at this", "you're a fucking genius": swearing used to cheer someone on
const PRAISE = /\b(you'?re|you\s+are|ur|u\s+are|you)\s+(\w+\s+){0,3}(good|great|amazing|awesome|genius|legend|goat|insane|incredible|brilliant|smart|funny|hilarious|talented|beautiful|best|cracked)\b/;
const isPhraseStrong = (term: string) => /\b(kill|die|worthless|disgusting)\b/.test(term);

function classifyRaw(rawText: string, ctx: Context, extras: Extras): Classification {
  const text = unmasker.apply(rawText);
  const hits: Hit[] = [];
  const normalized = normalize(text);
  const tokens = tokenize(text);
  const addressed = ctx.mentionsOthers || ctx.replyToOther;
  const mentions = [...text.matchAll(/<@[!&]?\d+>|@[\w.]{2,32}/g)].map(m => ({ start: m.index!, end: m.index! + m[0].length }));
  const push = (category: Category, term: string, level?: Hit['level'], soft?: boolean) => { if (!hits.some(h => h.category === category && h.term === term)) hits.push({ category, term, ...(level ? { level } : {}), ...(soft ? { soft } : {}) }); };
  // mild put-downs ("try hard", "nobody asked") are their own rule; clearly abusive ones stay insults
  const sayInsult = (term: string) => push(MILD_WORDS.has(term) || MILD_PHRASES.has(term) ? 'rudeness' : 'insults', term);

  for (const p of findPii(text)) push('personalInfo', p.kind);
  for (const sc of findScams(text)) push('scams', sc.term);
  for (const inv of findInvites(text)) push('invites', inv);
  const dox = firstMatch(normalized, doxxing); if (dox) push('doxxing', dox);
  const thr = firstMatch(normalized, threats);
  // Threats in a game context ("i will kill you in ranked") are game talk, not threats; self-harm phrases always count.
  if (thr && !(thr === 'pattern' && GAME_TALK.test(normalized) && !SERVER_ATTACK.test(normalized))) {
    // "i'll kill you in smash lol", "i will murder you if you tell her": a violent verb from a first person with a joking or trivial frame and no real-world detail is banter. It goes to "needs a look", not to the bin.
    const banter = thr === 'pattern' && FIRST_PERSON.test(normalized) && (VIOLENT.test(normalized) || /\boutside\s+(your|ur)\b/.test(normalized)) && BANTER_CUE.test(normalized) && !STALK_HARD.test(normalized);
    push('threats', thr, undefined, banter);
  }

  const allowed = new Set(extras.allowWords.map(w => normalize(w)));
  for (const h of findProfanity(text)) {
    if (allowed.has(normalize(h.term))) continue;
    push(h.category, h.term, h.category === 'profanity' ? swearLevelOf(h.term) : undefined);
    if (h.category === 'profanity') {
      const k = tokenIndexAt(tokens, h.start);
      const before = tokens[k - 1]?.norm ?? '', before2 = tokens[k - 2]?.norm ?? '';
      const exclamation = ['holy', 'oh', 'omg', 'ah', 'aw', 'ugh', 'yo', 'god', 'goddamn'].includes(before) || (before === 'the' && ['what', 'who', 'where', 'how', 'why'].includes(before2)); // "holy fuck did you see that"
      if (!exclamation && !(ASS_IMPERATIVE.test(normalized) && /^ass/.test(normalize(h.term))) && (nearSecondPerson(tokens, k) || (addressed && tokens.length <= 6))) push('directedProfanity', h.term);
    }
  }
  const dp = matchesDirectedPattern(normalized);
  if (dp && !allowed.has(normalize(dp))) push('directedProfanity', dp);

  // Insults only count when aimed at someone: a "you" nearby, a mention/reply, a command ("uninstall"), "imagine being", stacked insults, or a bare vocative.
  const imperative = hasImperative(normalized), imagine = hasImagineIdiom(normalized);
  const strong = tokens.filter(t => (STRONG_INSULTS.has(t.norm) || fuzzyInsult(t.norm) !== null) && !allowed.has(t.norm));
  tokens.forEach((t, i) => {
    const typo = fuzzyInsult(t.norm); // a typo of a strong insult counts as that insult
    const isStrong = STRONG_INSULTS.has(t.norm) || typo !== null || COMPOUND.test(t.norm), isWeak = WEAK_INSULTS.has(t.norm);
    if ((!isStrong && !isWeak) || allowed.has(t.norm)) return;
    const predicative = tokens.slice(Math.max(0, i - 5), i).some((tk, k, arr) => SECOND.has(tk.norm) && arr.slice(k + 1).some(x => ['are', 're', 'r', 'is', 'youre'].includes(x.norm))) || hasImagineIdiom(normalized) || i === tokens.length - 1;
    if (['feel', 'feeling', 'felt', 'feels'].includes(tokens[i - 1]?.norm ?? '')) return; // "it's okay to feel pathetic"
    if (NEGATORS.has(tokens[i - 1]?.norm ?? '') || (['a', 'an', 'such'].includes(tokens[i - 1]?.norm ?? '') && NEGATORS.has(tokens[i - 2]?.norm ?? ''))) return; // "you're not an idiot"
    if (ATTRIBUTIVE.has(t.norm) && DETERMINERS.has(tokens[i - 1]?.norm ?? '') && !predicative) return; // "this stupid level" is about the level

    const near = isStrong ? nearSecondPerson(tokens, i, 6, 4) : nearSecondPerson(tokens, i, 4, 2);
    const vocative = tokens.length === 1 || (tokens.length === 2 && isStrong && tokens.some(o => o !== t && isFiller(o)));
    const stacked = isStrong && strong.length >= 2 && tokens.length <= 10; // "idiot moron" aimed at nobody in particular, but only when short; a long sentence about a third person is just a description
    const trailing = i === tokens.length - 1 && tokens.some(o => SECOND.has(o.norm)) && (isStrong || /,\s*\S+\W*$/.test(text));
    const tail = isStrong && i === tokens.length - 1 && tokens.length >= 3 && /,\s*\S+\W*$/.test(text); // "seethe and cope, loser" // "you must be lonely to harass people, loser"
    const atMention = mentions.some(m => t.start >= m.end && t.start - m.end <= 90 || m.start >= t.start && m.start - t.start <= 40); // "@max, he is too stupid to read"
    if (near || vocative || stacked || trailing || tail || (isStrong && atMention) || imperative || imagine || (addressed && tokens.length <= (isStrong ? 14 : 8))) sayInsult(typo ?? t.norm);
  });
  if (addressed && /\bwhat\s+an?\s+(\w+\s+){0,2}(cunt|bitch|asshole|dickhead|bastard|prick|douchebag|douche|slut|whore|twat|jackass|dumbass|moron|idiot|imbecile)\b(?!\s+of\b)/.test(normalized)) push('insults', 'what a ...'); // aimed at the person you are talking to
  const belittle = firstMatch(normalized, belittling); if (belittle) push('insults', belittle === 'pattern' ? 'belittling' : belittle);
  const foreign = firstMatch(normalized, intlInsults); if (foreign) push('insults', foreign);
  const foreignSlur = firstMatch(normalized, intlSlurs); if (foreignSlur) push('slurs', foreignSlur);
  if (firstMatch(normalized, mildBelittling)) push('rudeness', 'mild belittling');
  const hate = firstMatch(normalized, hateTalk); if (hate) push('slurs', 'hate speech');
  for (const run of rawText.matchAll(/(?<![\p{L}\p{N}])(?:[\p{L}] ){5,}[\p{L}](?![\p{L}\p{N}])/gu)) {
    const joined = normalize(run[0].replace(/ /g, ''));
    const word = [...STRONG_INSULTS].find(w => w.length >= 5 && joined.includes(w)); // "y o u a r e a m o r o n"
    if (word) sayInsult(word);
    if (/killyourself|killurself|hangyourself|neckyourself|neckurself|kys$/.test(joined)) push('threats', 'kill yourself');
    const swear = CORE.find(w => w.length >= 4 && joined.includes(w));
    if (swear) push('profanity', swear);
  }
  if (/\b14\s?88\b|\({3}\s*\w+\s*\){3}/.test(rawText)) push('slurs', 'hate symbol');
  if (/\b(retards?|retarded|retaded|retarted|retrd|retrded|retardd)\b/.test(normalized)) push('slurs', 'retard');
  const phrase = firstMatch(normalized, insultPhrases);
  if (phrase && (tokens.some(t => ['you', 'u', 'ur', 'youre', 'your'].includes(t.norm)) || addressed || tokens.length <= 4 || imperative)) sayInsult(phrase);
  const sp = matchesSecondPersonInsult(normalized);
  if (sp) push(/worthless|disgusting/.test(sp) ? 'insults' : 'rudeness', sp);

  // "k y s" / "f.u.c.k": look for list words in the joined-up form too.
  const squashed = squashSpaced(text);
  if (squashed !== text) {
    const sq = normalize(squashed);
    const t2 = firstMatch(sq, threats); if (t2) push('threats', t2);
    for (const h of findProfanity(squashed)) if (!allowed.has(normalize(h.term))) push(h.category, h.term, h.category === 'profanity' ? swearLevelOf(h.term) : undefined);
  }

  if (extras.learnedWords?.size) for (const t of tokens) if (extras.learnedWords.has(t.norm) && !allowed.has(t.norm)) { push('learned', t.norm); break; }
  for (const w of extras.customWords) if (w && customRe(w).test(normalized)) push('custom', w);
  for (const src of extras.customRegex) { try { if (new RegExp(src, 'i').test(text)) push('custom', 'pattern'); } catch { /* invalid user regex is ignored */ } }
  // One "swearing aimed at someone" entry is enough; keep the most informative (longest) one.
  const directed = hits.filter(h => h.category === 'directedProfanity');
  if (directed.length > 1) {
    const keep = directed.reduce((a, b) => (b.term.length > a.term.length ? b : a));
    return { hits: hits.filter(h => h.category !== 'directedProfanity' || h === keep) };
  }
  return { hits };
}
