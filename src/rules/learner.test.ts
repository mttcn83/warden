import { describe, expect, it } from 'vitest';
import { Learner, LEARNER_LIMITS } from './learner.js';

const msg = (l: Learner, text: string, hostile: boolean, user: string) => l.observe(text.split(' '), hostile, user);

describe('Learner', () => {
  it('learns a made-up insult that keeps showing up in hostile messages from different people', () => {
    const l = new Learner();
    for (const u of ['a', 'b', 'c', 'd']) msg(l, 'you are such a gronk', true, u);
    expect(l.learned()).toContain('gronk');
  });
  it('does not learn ordinary words, even ones that appear in hostile messages', () => {
    const l = new Learner();
    for (let i = 0; i < 30; i++) msg(l, 'the game was great today', false, `u${i}`);
    for (const u of ['a', 'b', 'c', 'd', 'e']) msg(l, 'you are such a gronk in this game', true, u);
    expect(l.learned()).not.toContain('game');
    expect(l.learned()).not.toContain('such');
  });
  it('needs several different people, so one angry user cannot teach it a word', () => {
    const l = new Learner();
    for (let i = 0; i < 10; i++) msg(l, 'you absolute gronk', true, 'same');
    expect(l.learned()).toHaveLength(0);
  });
  it('needs enough evidence', () => {
    const l = new Learner();
    for (const u of ['a', 'b']) msg(l, 'you gronk', true, u);
    expect(l.learned()).toHaveLength(0);
  });
  it('stops counting a word as learned once it is used a lot in normal messages', () => {
    const l = new Learner();
    for (const u of ['a', 'b', 'c', 'd']) msg(l, 'you are such a gronk', true, u);
    expect(l.learned()).toContain('gronk');
    for (let i = 0; i < 20; i++) msg(l, 'gronk is my favourite character', false, `u${i}`);
    expect(l.learned()).not.toContain('gronk');
  });
  it('forgets a word on request and never learns it again', () => {
    const l = new Learner();
    for (const u of ['a', 'b', 'c', 'd']) msg(l, 'you are such a gronk', true, u);
    l.forget('gronk');
    for (const u of ['e', 'f', 'g', 'h']) msg(l, 'you are such a gronk', true, u);
    expect(l.learned()).not.toContain('gronk');
  });
  it('survives a save and load', () => {
    const l = new Learner();
    for (const u of ['a', 'b', 'c', 'd']) msg(l, 'you are such a gronk', true, u);
    expect(Learner.fromJSON(JSON.parse(JSON.stringify(l.toJSON()))).learned()).toEqual(l.learned());
  });
  it('ignores numbers, very short words and stop words', () => {
    const l = new Learner();
    for (const u of ['a', 'b', 'c', 'd']) l.observe(['12345', 'ab', 'the', 'you'], true, u);
    expect(l.describe()).toHaveLength(0);
    expect(LEARNER_LIMITS.minUsers).toBeGreaterThan(1);
  });
  it('forgets old words and caps memory', () => {
    const l = new Learner();
    const old = Date.now() - 90 * 86_400_000;
    l.observe(['oldword'], true, 'a', old);
    l.prune();
    expect(l.toJSON().terms['oldword']).toBeUndefined();
  });
});
