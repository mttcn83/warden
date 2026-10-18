import { describe, expect, it } from 'vitest';
import { makeRateLimiter } from './ratelimit.js';

describe('rate limiter', () => {
  it('allows up to the limit, then refuses, then recovers in the next window', () => {
    const ok = makeRateLimiter(3, 1000);
    expect([ok('a', 0), ok('a', 1), ok('a', 2), ok('a', 3)]).toEqual([true, true, true, false]);
    expect(ok('a', 1001)).toBe(true);
  });
  it('counts each key separately', () => {
    const ok = makeRateLimiter(1, 1000);
    expect(ok('a', 0)).toBe(true); expect(ok('b', 0)).toBe(true); expect(ok('a', 1)).toBe(false);
  });
  it('stays bounded however many keys arrive', () => {
    const ok = makeRateLimiter(1, 1000, 10);
    for (let i = 0; i < 100; i++) ok('k' + i, 0);
    expect(ok('fresh', 0)).toBe(true);
  });
});
