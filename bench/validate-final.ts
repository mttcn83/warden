// THE final test: every human-written validation message in one file (bench/validation-final.json), scored with the default policy.
// Usage: npx tsx bench/validate-final.ts [--show] [--set h3] [--tag threat]
// "edge" rows are cases where reasonable people disagree; they are reported but never counted.
import { readFileSync } from 'node:fs';
import { expandTokens } from '../src/testing/tokens.js';
import { classify } from '../src/rules/engine.js';
import { decide, type Policy } from '../src/rules/policy.js';

const policy: Policy = {
  categories: { personalInfo: 'delete', doxxing: 'delete', threats: 'delete', scams: 'delete', slurs: 'delete', insults: 'delete', rudeness: 'delete', directedProfanity: 'delete', profanity: 'off', sexual: 'off', invites: 'off', custom: 'delete', learned: 'log' },
  exceptions: [],
};
const standard: Policy = { ...policy, categories: { ...policy.categories, rudeness: 'log' } }; // the casual set is scored with the Standard settings
type Row = { text: string; label: 0 | 1; tag: string; addr?: boolean; set: string };
const arg = (name: string) => { const i = process.argv.indexOf(name); return i >= 0 ? process.argv[i + 1] : undefined; };
const onlySet = arg('--set'), onlyTag = arg('--tag'), show = process.argv.includes('--show');
const all: Row[] = JSON.parse(expandTokens(readFileSync(new URL('./validation-final.json', import.meta.url), 'utf8')));
const rows = all.filter(r => (!onlySet || r.set === onlySet) && (!onlyTag || r.tag === onlyTag));

type Tally = { tp: number; fp: number; fn: number; tn: number };
const blank = (): Tally => ({ tp: 0, fp: 0, fn: 0, tn: 0 });
const total = blank(), bySet = new Map<string, Tally>(), byTag = new Map<string, Tally>();
const errors: string[] = []; const edge = { n: 0, right: 0 };
const t0 = performance.now();
for (const r of rows) {
  const flagged = decide(classify(r.text, { mentionsOthers: !!r.addr, replyToOther: false }), r.set === 'casual' ? standard : policy, { channelId: 'c', roleIds: [] }).action === 'delete';
  if (r.tag === 'edge') { edge.n++; if (flagged === !!r.label) edge.right++; continue; }
  const k = flagged ? (r.label ? 'tp' : 'fp') : (r.label ? 'fn' : 'tn');
  for (const [m, key] of [[bySet, r.set], [byTag, r.tag]] as const) { const t = m.get(key) ?? blank(); t[k]++; m.set(key, t); }
  total[k]++;
  if (k === 'fp') errors.push(`FALSE+ [${r.set}] ${r.text.replace(/\n/g, ' ')}`);
  if (k === 'fn') errors.push(`MISSED [${r.set}] ${r.text.replace(/\n/g, ' ')}`);
}
const ms = (performance.now() - t0) / rows.length;
const score = (t: Tally) => { const p = t.tp / (t.tp + t.fp || 1), r = t.tp / (t.tp + t.fn || 1); return { p, r, f1: (2 * p * r) / (p + r || 1) }; };
const line = (name: string, t: Tally) => { const s = score(t);
  if (t.tp + t.fn === 0) return `  ${name.padEnd(13)} ${String(t.fp + t.tn).padStart(4)} msgs   (all harmless)                               false+ ${t.fp}`; return `  ${name.padEnd(13)} ${String(t.tp + t.fp + t.fn + t.tn).padStart(4)} msgs   precision ${s.p.toFixed(3)}  recall ${s.r.toFixed(3)}  F1 ${s.f1.toFixed(3)}   false+ ${t.fp}  missed ${t.fn}`; };

console.log(`\nFINAL VALIDATION: ${rows.length} messages (${edge.n} edge cases reported separately), ${ms.toFixed(2)} ms per message\n`);
console.log(line('ALL', total));
console.log('\n  by set');
for (const [k, v] of [...bySet].sort()) console.log(line(k, v));
console.log('\n  by kind of message');
for (const [k, v] of [...byTag].sort((a, b) => (b[1].fp + b[1].fn) - (a[1].fp + a[1].fn) || a[0].localeCompare(b[0]))) console.log(line(k, v));
console.log(`\n  edge cases (people could disagree): the rules agree with the label on ${edge.right} of ${edge.n}`);
if (errors.length) { console.log(`\n  ${errors.length} mistake${errors.length === 1 ? '' : 's'}:`); (show ? errors : errors.slice(0, 25)).forEach(e => console.log('   ' + e)); if (!show && errors.length > 25) console.log(`   ... ${errors.length - 25} more (use --show)`); }
else console.log('\n  PERFECT: no false alarms and nothing missed.');

// Speed under attack: long and nasty inputs must not slow the bot down.
const stress: Record<string, string> = {
  'you x500': 'you '.repeat(500), 'letters+spaces': 'y o u a r e '.repeat(300), 'repeat letters': 'f'.repeat(1900) + ' you', 'stars': '*'.repeat(2000) + 'x',
  'discord max (4000)': 'hello you are great and i like this server a lot '.repeat(100).slice(0, 4000), 'combining marks': '\u0301'.repeat(1500) + 'abc', 'nobody x400': 'nobody '.repeat(400),
  "i'll x400": "i'll ".repeat(400) + 'x', 'mixed junk': ('f.u.c.k ' + 'id iot ' + 'k y s ').repeat(150),
};
let worst = 0, worstName = '';
for (const [k, v] of Object.entries(stress)) { const t = performance.now(); classify(v, { mentionsOthers: false, replyToOther: false }); const d = performance.now() - t; if (d > worst) { worst = d; worstName = k; } }
console.log(`\n  slowest stress input: ${worstName} took ${worst.toFixed(1)} ms ${worst > 250 ? '(TOO SLOW)' : '(fine)'}`);
const s = score(total);
process.exitCode = s.p >= 0.995 && s.r >= 0.995 && worst <= 250 ? 0 : 1;
