import { describe, expect, it } from 'vitest';
import { JoinWindow, isRaider, raidOver } from './detector.js';
import { PermissionsBitField } from 'discord.js';
import { isDangerous } from '../guard/logic.js';

const j = (id: string, ts: number, bot = false) => ({ id, ts, bot, inviterId: null });

describe('JoinWindow', () => {
  it('counts joins inside the window only', () => {
    const w = new JoinWindow();
    for (let i = 0; i < 5; i++) w.record('g', j('u' + i, i * 1000), 10);
    expect(w.record('g', j('u5', 5000), 10)).toHaveLength(6);
    expect(w.record('g', j('late', 30_000), 10)).toHaveLength(1); // old joins fell out
  });
  it('keeps servers separate', () => {
    const w = new JoinWindow();
    w.record('a', j('x', 0), 10);
    expect(w.record('b', j('y', 1), 10)).toHaveLength(1);
  });
});

describe('isRaider', () => {
  const now = Date.now(), day = 86_400_000;
  it('bots are always raiders', () => expect(isRaider({ bot: true, accountCreatedAt: now - 900 * day, now, minAccountAgeDays: 7 })).toBe(true));
  it('age 0 means nobody is let through', () => expect(isRaider({ bot: false, accountCreatedAt: now - 900 * day, now, minAccountAgeDays: 0 })).toBe(true));
  it('old accounts are let through when an age is set', () => {
    expect(isRaider({ bot: false, accountCreatedAt: now - 30 * day, now, minAccountAgeDays: 7 })).toBe(false);
    expect(isRaider({ bot: false, accountCreatedAt: now - 2 * day, now, minAccountAgeDays: 7 })).toBe(true);
  });
});

describe('raidOver', () => {
  it('ends after the quiet period', () => {
    const raid = { startedAt: 0, lastRaidJoin: 1000, members: new Map(), kind: 'burst' as const };
    expect(raidOver(raid, 30_000, 60)).toBe(false);
    expect(raidOver(raid, 61_000, 60)).toBe(true);
  });
});

describe('isDangerous', () => {
  it('flags powerful permissions and ignores harmless ones', () => {
    expect(isDangerous(new PermissionsBitField(['BanMembers']))).toBe(true);
    expect(isDangerous(new PermissionsBitField(['Administrator']))).toBe(true);
    expect(isDangerous(new PermissionsBitField(['SendMessages', 'ViewChannel']))).toBe(false);
  });
});
