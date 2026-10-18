import { describe, expect, it } from 'vitest';
import { defaultGuildConfig, type RaidSettings } from '../../core/config.js';
import { RaidEngine, type Account, type RaidPlatform, type TrackedMessage } from './engine.js';
import { nameStem, suspicion } from './detector.js';
import { rankSuspects } from '../guard/logic.js';

const DAY = 86_400_000;
const cfg = defaultGuildConfig();

function harness(over: Partial<RaidSettings> = {}) {
  let now = 1_800_000_000_000;
  const log: string[] = [], deleted: string[] = [], acted: string[] = [];
  const settings: RaidSettings = { ...cfg.raid, enabled: true, shadow: false, ...over };
  const p: RaidPlatform = {
    now: () => now, guildId: () => 'g', ownerId: () => 'owner', meId: () => 'me', trusted: () => [], settings: () => settings,
    record: (a, _u, t) => { log.push(`${a}: ${t}`); }, announce: async () => {},
    act: async (a, action) => { acted.push(a.id); return action; },
    deleteMessages: async list => { deleted.push(...list.map(m => m.id)); return list.length; },
    pauseInvites: async () => 'paused', resumeInvites: async () => 'resumed', onEnded: () => {},
  };
  const e = new RaidEngine(p);
  let seq = 0; // real accounts are created at different times; farms are created together
  const acc = (id: string, o: Partial<Account> = {}): Account => ({ id, tag: id + '#0001', username: id, bot: false, createdAt: now - 400 * DAY - (seq++ % 40) * 9 * DAY, hasAvatar: true, ...o });
  return { e, log, deleted, acted, acc, advance: (ms: number) => { now += ms; }, now: () => now };
}

describe('Kevin leaving and joining too fast', () => {
  it('one long-standing account rejoining 30 times in a few seconds never starts a raid', async () => {
    const h = harness();
    for (let i = 0; i < 30; i++) { await h.e.onJoin(h.acc('kevin')); h.advance(200); }
    expect(h.e.active).toBe(false);
    expect(h.acted).toEqual([]);
  });
  it('even a brand-new account rejoining over and over counts as one join', async () => {
    const h = harness();
    for (let i = 0; i < 30; i++) { await h.e.onJoin(h.acc('newbie', { createdAt: h.now() - 3600_000, hasAvatar: false })); h.advance(100); }
    expect(h.e.active).toBe(false);
  });
  it('a crowd of established members (a streamer shout-out) is not a raid', async () => {
    const h = harness();
    for (let i = 0; i < 25; i++) { await h.e.onJoin(h.acc('fan' + i, { username: ['alder', 'birch', 'cedar', 'dune', 'elm', 'fern', 'gale', 'hazel', 'iris', 'juno', 'kelp', 'lark', 'moss', 'nova', 'opal', 'pine', 'quartz', 'reed', 'sage', 'tide', 'umber', 'vale', 'wren', 'yarrow', 'zephyr'][i]! })); h.advance(300); }
    expect(h.e.active).toBe(false);
  });
  it('is left alone while a raid goes on around them', async () => {
    const h = harness();
    for (let i = 0; i < 10; i++) { await h.e.onJoin(h.acc('RaidBot_' + i, { bot: true, createdAt: h.now() - 3600_000, hasAvatar: false })); h.advance(200); }
    expect(h.e.active).toBe(true);
    await h.e.onJoin(h.acc('kevin'));
    expect(h.acted).not.toContain('kevin');
  });
});

describe('slow raids', () => {
  const newBot = (h: ReturnType<typeof harness>, i: number) => h.acc(`Spam_${i}x`.replace('x', String(1000 + i * 7)), { createdAt: h.now() - 6 * 3600_000, hasAvatar: false, bot: i % 2 === 0 });
  it('catches a trickle of look-alike new accounts that is far too slow for the burst limit', async () => {
    const h = harness();
    for (let i = 0; i < 8; i++) { await h.e.onJoin(newBot(h, i)); h.advance(3 * 60_000); }
    expect(h.e.active).toBe(true);
    expect(h.log.some(l => l.startsWith('raid-start: slow raid'))).toBe(true);
  });
  it('does not mistake ordinary new members for one', async () => {
    const h = harness();
    const names = ['astra', 'borealis', 'cinder', 'drift', 'ember', 'flint', 'glacier', 'harbor', 'ivory', 'jasper'];
    for (let i = 0; i < 10; i++) { await h.e.onJoin(h.acc(names[i]!, { createdAt: h.now() - 3 * DAY - i * 7 * 3600_000 * 5, hasAvatar: true })); h.advance(2 * 60_000); }
    expect(h.e.active).toBe(false);
  });
  it('can be switched off', async () => {
    const h = harness({ dripJoins: 0 });
    for (let i = 0; i < 12; i++) { await h.e.onJoin(newBot(h, i)); h.advance(3 * 60_000); }
    expect(h.e.active).toBe(false);
  });
});

describe('spam bots that look normal', () => {
  it('catches an account posting what the raiders post, and deletes everything it sent', async () => {
    const h = harness();
    const say = (id: string, n: number, text: string): TrackedMessage => ({ id: `${id}-${n}`, channelId: 'c1', authorId: id, ts: h.now(), fp: text.toLowerCase().replace(/[^a-z]+/g, '') });
    for (let i = 0; i < 9; i++) { await h.e.onJoin(h.acc('RaidBot_' + i, { bot: true, createdAt: h.now() - 3600_000, hasAvatar: false })); h.advance(150); }
    await h.e.onJoin(h.acc('sleeper')); // an old account with a picture: looks fine
    await h.e.onMessage(say('sleeper', 1, 'this server is now ours, join us'));
    await h.e.onMessage(say('RaidBot_0', 1, 'this server is now ours, join us'));
    await h.e.tick();
    h.advance(1000); await h.e.flush(true);
    expect(h.acted).toContain('sleeper');
    expect(h.deleted).toContain('sleeper-1');
  });
  it('deletes every message of a raider however many it sent', async () => {
    const h = harness();
    for (let i = 0; i < 300; i++) await h.e.onMessage({ id: `b-${i}`, channelId: 'c' + (i % 3), authorId: 'RaidBot_0', ts: h.now() });
    for (let i = 0; i < 9; i++) { await h.e.onJoin(h.acc('RaidBot_' + i, { bot: true, createdAt: h.now() - 600_000, hasAvatar: false })); h.advance(100); }
    // messages sent before the account was recognised are tracked only for accounts that joined, so send 300 more after joining
    const h2 = harness();
    await h2.e.onJoin(h2.acc('Spambot', { bot: true, createdAt: h2.now() - 600_000, hasAvatar: false }));
    for (let i = 0; i < 300; i++) await h2.e.onMessage({ id: `s-${i}`, channelId: 'c' + (i % 3), authorId: 'Spambot', ts: h2.now() });
    for (let i = 0; i < 9; i++) { await h2.e.onJoin(h2.acc('RaidBot_' + i, { bot: true, createdAt: h2.now() - 600_000, hasAvatar: false })); h2.advance(100); }
    await h2.e.flush(true);
    expect(h2.deleted.filter(id => id.startsWith('s-'))).toHaveLength(300);
  });
});

describe('suspicion', () => {
  const profile = (username: string, ageDays: number, hasAvatar = true) => ({ id: username, username, createdAt: 1_800_000_000_000 - ageDays * DAY, hasAvatar, bot: false });
  it('ignores digits and separators when comparing names', () => expect(nameStem('Raid_Bot-0042')).toBe(nameStem('raidbot17')));
  it('one odd trait is not enough', () => {
    expect(suspicion(profile('someone', 0.2), [], 1_800_000_000_000).score).toBeLessThan(3);
    expect(suspicion(profile('someone', 400, false), [], 1_800_000_000_000).score).toBeLessThan(3);
  });
  it('a new, picture-less account with look-alike names around it is suspicious', () => {
    const others = [profile('RaidBot_1', 0.1, false), profile('RaidBot_2', 0.1, false), profile('RaidBot_3', 0.1, false)];
    expect(suspicion(profile('RaidBot_4', 0.1, false), others, 1_800_000_000_000).score).toBeGreaterThanOrEqual(3);
  });
});

describe('who let them in', () => {
  const base = { inviterCounts: {}, botAddExecutors: [], roleGrantExecutors: [], raidIds: ['r1'], ownerId: 'owner', meId: 'me', trusted: ['trusted'], botIds: new Set<string>() };
  it('names the evidence and puts the confident culprits first', () => {
    const out = rankSuspects({ ...base, inviterCounts: { solo: 1, inviter: 6 }, botAddExecutors: [{ id: 'adder' }] });
    expect(out.map(s => s.id)).toEqual(['inviter', 'adder', 'solo']);
    expect(out[0]!.reasons[0]).toMatch(/6 raiders/);
    expect(out[2]!.confident).toBe(false);
  });
  it('never names the owner, this bot, trusted admins, bots or the raiders', () => {
    const out = rankSuspects({ ...base, inviterCounts: { owner: 5, me: 5, trusted: 5, r1: 5, botty: 5, ok: 5 }, botIds: new Set(['botty']) });
    expect(out.map(s => s.id)).toEqual(['ok']);
  });
});
