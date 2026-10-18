import { describe, expect, it } from 'vitest';
import { defaultGuildConfig } from '../core/config.js';
import { simulateAttack, type SimOptions } from './attack.js';
import { RaidEngine, type Account, type RaidPlatform, type TrackedMessage } from '../modules/raid/engine.js';

const cfg = defaultGuildConfig();
const base: SimOptions = { attackers: 24, style: 'burst', adminRaiders: 3, outrankingAdmin: false, messagesPerBot: 5, innocents: 2, seed: 7 };
const run = (o: Partial<SimOptions> = {}, raid = cfg.raid) => simulateAttack(raid, cfg.guard, { ...base, ...o });
const check = (r: Awaited<ReturnType<typeof run>>, label: string) => r.checks.find(c => c.label.startsWith(label))!;

describe('attack simulation', () => {
  it('deletes every raider message, even from admins and bots, and leaves the owner and trusted admin alone', async () => {
    const r = await run();
    expect(r.verdict).toBe('pass');
    expect(r.stats.leaked).toBe(0);
    expect(r.stats.messagesDeleted).toBe(r.stats.messagesSent);
    expect(r.stats.purged).toBeGreaterThan(0); // the ones sent before detection
    expect(r.stats.blocked).toBeGreaterThan(0); // the ones blocked as they arrived
    for (const label of ['Raid detected', 'Admins and bots', 'Server owner', 'Trusted admin', 'Invites paused', 'Raiders’ roles', 'Whoever let them in']) expect(check(r, label).pass, label).toBe(true);
  });
  it('runs even when the real settings have the protections off', async () => {
    const r = await run({}, { ...cfg.raid, enabled: false, shadow: true });
    expect(r.verdict).toBe('pass');
  });
  it('handles waves, which keep the raid alive between bursts', async () => {
    const r = await run({ style: 'waves', attackers: 45 });
    expect(r.stats.leaked).toBe(0);
    expect(r.verdict).toBe('pass');
  });
  it('catches a slow drip of bot accounts that never trips the burst limit', async () => {
    const r = await run({ style: 'drip', attackers: 30 });
    expect(r.verdict).toBe('pass');
    expect(check(r, 'Raid detected').pass).toBe(true);
    expect(r.stats.detectedAt!).toBeLessThan(150); // after about ten of the thirty raiders, long before the drip ends
    expect(r.stats.leaked).toBe(0);
  });
  it('is honest when slow-raid detection is off and raiders join slowly', async () => {
    const r = await run({ style: 'drip' }, { ...cfg.raid, dripJoins: 0 });
    expect(r.verdict).toBe('fail');
    expect(check(r, 'Raid detected').pass).toBe(false);
  });
  it('never touches Kevin, who rejoins five times in a few seconds', async () => {
    for (const style of ['burst', 'waves', 'drip'] as const) expect(check(await run({ style }), 'Kevin').pass, style).toBe(true);
  });
  it('still deletes messages from an admin that outranks the bot, but cannot punish it', async () => {
    const r = await run({ outrankingAdmin: true });
    expect(r.stats.accountsSkipped).toBe(1);
    expect(r.stats.leaked).toBe(0);
  });
  it('lets established accounts through when an account age is set', async () => {
    expect((await run({}, { ...cfg.raid, minAccountAgeDays: 0 })).stats.innocentsAffected).toBe(2);
    expect((await run()).stats.innocentsAffected).toBe(0); // the default lets established accounts through
  });
  it('scales to 200 attackers quickly', async () => {
    const t0 = Date.now();
    const r = await run({ attackers: 200, messagesPerBot: 8 });
    expect(r.stats.leaked).toBe(0);
    expect(Date.now() - t0).toBeLessThan(5000);
  });
});

describe('realistic speed', () => {
  it('clears a big raid quickly because deletes are batched', async () => {
    const r = await run({ attackers: 200, messagesPerBot: 5, innocents: 0 });
    expect(r.stats.leaked).toBe(0);
    expect(r.stats.visibleAvg).toBeLessThan(5);
    expect(r.stats.spamGoneAt!).toBeLessThan(30);
  });
  it('is honest that punishing hundreds of accounts is slow (Discord limits member actions)', async () => {
    const r = await run({ attackers: 200, innocents: 0 });
    expect(r.stats.punishDoneAt!).toBeGreaterThan(60);
    expect(r.stats.accountsActed).toBeGreaterThanOrEqual(200);
  });
  it('never lets a message through when its author is recognised late (join event after first message)', async () => {
    for (const seed of [1, 2, 3, 4, 5, 6]) {
      const r = await run({ attackers: 60, seed, innocents: 0 });
      expect(r.stats.leaked, `seed ${seed}`).toBe(0);
    }
  });
});

describe('raid engine in shadow mode', () => {
  it('records what it would do and deletes nothing', async () => {
    let now = 0; const log: string[] = []; let deleted = 0, acted = 0;
    const p: RaidPlatform = {
      now: () => now, guildId: () => 'g', ownerId: () => 'owner', meId: () => 'me', trusted: () => [], settings: () => ({ ...cfg.raid, enabled: true, shadow: true, joinsPerWindow: 3 }),
      record: (a, _u, t) => log.push(a + ': ' + t), announce: async () => {},
      act: async () => { acted++; return 'x'; }, deleteMessages: async m => { deleted += m.length; return m.length; },
      pauseInvites: async () => 'p', resumeInvites: async () => 'r', onEnded: () => {},
    };
    const e = new RaidEngine(p);
    for (let i = 0; i < 4; i++) { now += 500; const a: Account = { id: 'u' + i, tag: 'u' + i, bot: true, createdAt: 0 }; await e.onJoin(a); await e.onMessage({ id: 'm' + i, channelId: 'c', authorId: a.id, ts: now } as TrackedMessage); }
    expect(acted).toBe(0); expect(deleted).toBe(0);
    expect(log.some(l => l.startsWith('raid-start'))).toBe(true);
    expect(log.some(l => l.includes('SHADOW'))).toBe(true);
  });
});
