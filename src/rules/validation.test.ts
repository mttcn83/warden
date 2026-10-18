import { readFileSync } from 'node:fs';
import { expandTokens } from '../testing/tokens.js';
import { describe, expect, it } from 'vitest';
import { classify } from './engine.js';
import { decide, type Policy } from './policy.js';

// The combined human-written validation file (bench/validation-final.json, built by bench/build-final.py).
// If a change to the rules makes this fail, run `npx tsx bench/validate-final.ts` to see exactly which messages broke.
type Row = { text: string; label: 0 | 1; tag: string; addr?: boolean; set: string };
const rows: Row[] = JSON.parse(expandTokens(readFileSync(new URL('../../bench/validation-final.json', import.meta.url), 'utf8')));
const policy: Policy = {
  categories: { personalInfo: 'delete', doxxing: 'delete', threats: 'delete', scams: 'delete', slurs: 'delete', insults: 'delete', rudeness: 'delete', directedProfanity: 'delete', profanity: 'off', sexual: 'off', invites: 'off', custom: 'delete', learned: 'log' },
  exceptions: [],
};
const standard: Policy = { ...policy, categories: { ...policy.categories, rudeness: 'log' } };
const flagged = (r: Row) => decide(classify(r.text, { mentionsOthers: !!r.addr, replyToOther: false }), r.set === 'casual' ? standard : policy, { channelId: 'c', roleIds: [] }).action === 'delete';

describe('human-written validation set', () => {
  const scored = rows.filter(r => r.tag !== 'edge');
  const results = scored.map(r => ({ r, got: flagged(r) }));
  it('is big enough to mean something', () => expect(rows.length).toBeGreaterThan(2000));
  it('never removes a harmless message (precision)', () => {
    const fp = results.filter(x => x.got && !x.r.label).map(x => `[${x.r.set}] ${x.r.text}`);
    expect(fp).toEqual([]);
  });
  it('catches what a moderator would remove (recall)', () => {
    const fn = results.filter(x => !x.got && x.r.label).map(x => `[${x.r.set}] ${x.r.text}`);
    expect(fn).toEqual([]);
  });
});
