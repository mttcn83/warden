import { describe, expect, it } from 'vitest';
import { classify } from './engine.js';

// When the context excuses something serious, it is not deleted, but it is remembered so a person can look.
const ctx = { mentionsOthers: false, replyToOther: false };
const maybes = (t: string, c = ctx) => classify(t, c).maybes ?? [];
describe('needs a look', () => {
  it('keeps what a quote or a report excused', () => {
    const m = maybes('he said "i will find you and hurt you" in dms, mods please look');
    expect(m.map(x => x.category)).toContain('threats'); expect(m[0]!.why).toMatch(/quote|report/);
  });
  it('keeps role-play threats', () => expect(maybes('*draws sword* I will end you, vile necromancer!').map(x => x.category)).toContain('threats'));
  it('is empty for normal chat and for things that are simply deleted', () => {
    expect(maybes('good morning everyone, coffee time')).toEqual([]);
    expect(classify('go kill yourself', ctx).hits.length).toBeGreaterThan(0);
    expect(maybes('go kill yourself')).toEqual([]);
  });
  it('never lists mild stuff, so the mods are not flooded', () => expect(maybes('nobody asked lol you clown, jk love you')).toEqual([]));
});
