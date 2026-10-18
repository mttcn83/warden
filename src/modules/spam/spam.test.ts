import { describe, expect, it } from 'vitest';
import { SpamTracker } from './tracker.js';

const limits = { maxMessages: 3, windowSeconds: 5, maxDuplicates: 3, maxMentions: 4 };

describe('SpamTracker', () => {
  it('flags rate limit and resets after the window', () => {
    const t = new SpamTracker(limits);
    expect(t.check('u', 'a', 0, 0)).toBeNull();
    expect(t.check('u', 'b', 0, 1000)).toBeNull();
    expect(t.check('u', 'c', 0, 2000)).toBeNull();
    expect(t.check('u', 'd', 0, 3000)).toMatch(/rate limit/);
    expect(t.check('u', 'e', 0, 20_000)).toBeNull();
  });
  it('flags duplicates and mention spam', () => {
    const t = new SpamTracker(limits);
    t.check('u', 'same', 0, 0);
    t.check('u', 'same', 0, 100);
    expect(t.check('u', 'same', 0, 200)).toMatch(/duplicate/);
    expect(t.check('v', 'hi', 5, 0)).toMatch(/mention/);
  });
  it('tracks users independently', () => {
    const t = new SpamTracker(limits);
    for (let i = 0; i < 3; i++) t.check('a', String(i), 0, i);
    expect(t.check('b', 'x', 0, 10)).toBeNull();
  });
});

describe('message shape', () => {
  const shape = { ...limits, maxMessages: 50, maxCapsPercent: 70, maxEmojis: 5, blockZalgo: true };
  it('flags shouting but not short caps, links or emoji names', () => {
    const t = new SpamTracker(shape);
    expect(t.check('a', 'THIS IS A VERY LOUD MESSAGE FOR EVERYONE HERE', 0, 0)).toMatch(/capital/);
    expect(t.check('b', 'OK', 0, 0)).toBeNull();
    expect(t.check('c', 'Hello there, this is a normal sentence with NASA in it.', 0, 0)).toBeNull();
    expect(t.check('d', 'check https://EXAMPLE.COM/SOME/VERY/LONG/UPPERCASE/LINK/HERE now ok', 0, 0)).toBeNull();
  });
  it('flags emoji walls', () => {
    const t = new SpamTracker(shape);
    expect(t.check('a', '😀😀😀😀😀😀', 0, 0)).toMatch(/emoji/);
    expect(t.check('b', 'nice 😀😀', 0, 0)).toBeNull();
  });
  it('flags zalgo text but not normal accents', () => {
    const t = new SpamTracker(shape);
    expect(t.check('a', 'h̷̢̛e̸̡l̶̛l̷̢ơ̶ ̷w̸̡o̶̢r̸l̷d̶', 0, 0)).toMatch(/zalgo/);
    expect(t.check('b', 'café résumé naïve señor', 0, 0)).toBeNull();
  });
  it('is off when the limits are 0', () => {
    const t = new SpamTracker({ ...limits, maxCapsPercent: 0, maxEmojis: 0, blockZalgo: false });
    expect(t.check('a', 'THIS IS A VERY LOUD MESSAGE FOR EVERYONE HERE 😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀😀', 0, 0)).toBeNull();
  });
});

describe('spam that varies a little', () => {
  it('notices near-identical messages with changing numbers and links', () => {
    const t = new SpamTracker({ ...limits, maxMessages: 50 });
    expect(t.check('u', 'FREE nitro here https://a.example/x1', 0, 0)).toBeNull();
    expect(t.check('u', 'free nitro here https://b.example/y22', 0, 100)).toBeNull();
    expect(t.check('u', 'free   nitro here!! https://c.example/z3', 0, 200)).toBeNull();
    expect(t.check('u', 'Free nitro here https://d.example/q', 0, 300)).toMatch(/near-identical/);
  });
  it('does not mistake short chatter for spam', () => {
    const t = new SpamTracker({ ...limits, maxMessages: 50 });
    for (let i = 0; i < 6; i++) expect(String(t.check('u', 'lol', 0, i * 100))).not.toMatch(/near-identical/);
  });
  it('is stricter with members who only just joined', () => {
    const t = new SpamTracker({ ...limits, maxMessages: 6 });
    const out = [0, 1, 2, 3].map(i => t.check('new', 'message number ' + 'abcd'[i], 0, i * 500, { strict: true }));
    expect(out[3]).toMatch(/rate limit/); // 4 messages: over half of 6
    const u = new SpamTracker({ ...limits, maxMessages: 6 });
    expect([0, 1, 2, 3].map(i => u.check('old', 'message number ' + 'abcd'[i], 0, i * 500))[3]).toBeNull();
  });
  it('hands back everything the person just sent so it can all be deleted', () => {
    const t = new SpamTracker(limits);
    for (let i = 0; i < 4; i++) t.check('u', 'x' + i, 0, i * 100, { ref: { id: 'm' + i, channelId: 'c' + (i % 2) } });
    expect(t.take('u', 500).map(r => r.id)).toEqual(['m0', 'm1', 'm2', 'm3']);
    expect(t.take('u', 500)).toEqual([]);
  });
});
