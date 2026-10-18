// Scores the rules on the human-written validation sets with the default policy. Edge cases are reported separately.
// Usage: npx tsx bench/validate.ts [dev|sealed|r1|r2|...] [--show]
import { readFileSync } from 'node:fs';
import { expandTokens } from '../src/testing/tokens.js';
import { classify } from '../src/rules/engine.js';
import { decide, type Policy } from '../src/rules/policy.js';

const policy: Policy = {
  categories: { personalInfo: 'delete', doxxing: 'delete', threats: 'delete', scams: 'delete', slurs: 'delete', insults: 'delete', rudeness: 'delete', directedProfanity: 'delete', profanity: 'off', sexual: 'off', invites: 'off', custom: 'delete', learned: 'log' },
  exceptions: [],
};
// The casual set is scored with the Standard settings (mild put-downs are only logged); every other set with strict ones (everything is deleted).
const which = process.argv[2] && process.argv[2] !== '--show' ? process.argv[2] : 'dev';
const show = process.argv.includes('--show');
const policy2 = which.startsWith('casual') ? { ...policy, categories: { ...policy.categories, rudeness: 'log' as const } } : policy;
const data: { text: string; label: 0 | 1; tag: string; addr?: boolean }[] = JSON.parse(expandTokens(readFileSync(new URL(`./validation-${which}.json`, import.meta.url), 'utf8')));
const byTag = new Map<string, { n: number; wrong: number }>();
let tp = 0, fp = 0, fn = 0, tn = 0; const errs: string[] = []; const edge = { n: 0, right: 0 };
for (const d of data) {
  const flagged = decide(classify(d.text, { mentionsOthers: !!d.addr, replyToOther: false }), policy2, { channelId: 'c', roleIds: [] }).action === 'delete';
  const right = flagged === !!d.label;
  if (d.tag === 'edge') { edge.n++; if (right) edge.right++; continue; }
  const t = byTag.get(d.tag) ?? { n: 0, wrong: 0 }; t.n++; if (!right) t.wrong++; byTag.set(d.tag, t);
  if (flagged && d.label) tp++; else if (flagged) { fp++; errs.push('FALSE+ ' + d.text); } else if (d.label) { fn++; errs.push('MISSED ' + d.text); } else tn++;
}
const p = tp / (tp + fp || 1), r = tp / (tp + fn || 1);
console.log(`${which.toUpperCase()} (${data.length - edge.n} scored + ${edge.n} edge): precision=${p.toFixed(2)} recall=${r.toFixed(2)} F1=${((2 * p * r) / (p + r || 1)).toFixed(2)}  false-pos=${fp} missed=${fn}  edge right ${edge.right}/${edge.n}`);
const weak = [...byTag].filter(([, v]) => v.wrong).map(([k, v]) => `${k} ${v.n - v.wrong}/${v.n}`);
if (weak.length) console.log('  weak spots: ' + weak.join(', '));
if (show || which === 'dev') errs.forEach(e => console.log('  ' + e));
