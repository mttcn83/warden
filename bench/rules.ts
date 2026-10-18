// Accuracy of the rules engine alone (no AI) on bench/dataset.json, with the default server policy.
import { readFileSync } from 'node:fs';
import { classify } from '../src/rules/engine.js';
import { decide, type Policy } from '../src/rules/policy.js';

const policy: Policy = {
  categories: { personalInfo: 'delete', doxxing: 'delete', threats: 'delete', scams: 'delete', slurs: 'delete', insults: 'delete', rudeness: 'delete', directedProfanity: 'delete', profanity: 'off', sexual: 'off', invites: 'off', custom: 'delete', learned: 'log' },
  exceptions: [],
};
const data: { text: string; label: 0 | 1 }[] = JSON.parse(readFileSync(new URL('./dataset.json', import.meta.url), 'utf8'));
let tp = 0, fp = 0, fn = 0, tn = 0; const errs: string[] = [];
const t0 = performance.now();
for (const d of data) {
  const action = decide(classify(d.text, { mentionsOthers: false, replyToOther: false }), policy, { channelId: 'c', roleIds: [] }).action;
  const flagged = action === 'delete';
  if (flagged && d.label) tp++; else if (flagged) { fp++; errs.push('FALSE+ ' + d.text); } else if (d.label) { fn++; errs.push('MISSED ' + d.text); } else tn++;
}
const ms = (performance.now() - t0) / data.length;
const p = tp / (tp + fp || 1), r = tp / (tp + fn || 1);
console.log(`rules only (default policy): precision=${p.toFixed(2)} recall=${r.toFixed(2)} F1=${((2 * p * r) / (p + r || 1)).toFixed(2)} false-pos=${fp} missed=${fn}  (${ms.toFixed(2)} ms/message, no model, no download)`);
errs.forEach(e => console.log('  ' + e));
