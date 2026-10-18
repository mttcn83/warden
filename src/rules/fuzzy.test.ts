import { describe, expect, it } from 'vitest';
import { fuzzyInsult, withinOneEdit } from './fuzzy.js';

describe('withinOneEdit', () => {
  it('allows exactly one substitution, insertion, deletion or swap', () => {
    for (const [a, b] of [['dumbass', 'dumbas'], ['dumbass', 'dumbasss'], ['dumbass', 'dumbazs'], ['dumbass', 'dumbsas'], ['abc', 'abc']] as const) expect(withinOneEdit(a, b), `${a}/${b}`).toBe(true);
    for (const [a, b] of [['dumbass', 'dumbs'], ['dumbass', 'dumpass2'], ['abc', 'xyz'], ['abcd', 'badc']] as const) expect(withinOneEdit(a, b), `${a}/${b}`).toBe(false);
  });
});
describe('fuzzyInsult', () => {
  it('finds typos but only of longer words and with the same first letter', () => {
    expect(fuzzyInsult('dumbas')).toBe('dumbass');
    expect(fuzzyInsult('bufoon')).toBe('buffoon');
    expect(fuzzyInsult('dumb')).toBe(null); // too short to match loosely
    expect(fuzzyInsult('xumbass')).toBe(null); // first letter differs
    expect(fuzzyInsult('lovers')).toBe(null);
    expect(fuzzyInsult('dumbass')).toBe(null); // exact words are handled elsewhere
  });
});
