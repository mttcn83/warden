import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { GuildConfig, defaultGuildConfig } from './config.js';
// The CLI is plain JavaScript (no build step), so it has no type declarations.
// @ts-ignore
import { PRESETS, applyPresetTo } from '../../bin/presets.js';
// @ts-ignore
import { HELP } from '../../bin/commands.js';
// @ts-ignore
import { looksLikeToken, clientIdFromToken, inviteUrl, intentsFromFlags } from '../../bin/discord.js';

/** Modules are the settings groups with an `enabled` switch. A new one must be decided on in the setup wizard. */
const modules = (): string[] => Object.entries(defaultGuildConfig() as unknown as Record<string, unknown>).filter(([, v]) => v && typeof v === 'object' && 'enabled' in (v as object)).map(([k]) => k);

describe('setup wizard presets stay in sync with the bot', () => {
  it('every preset names every module, so a new feature cannot be forgotten', () => {
    for (const preset of PRESETS) {
      const missing = modules().filter(m => !(m in preset.config));
      expect(missing, `preset "${preset.id}" has no decision for: ${missing.join(', ')}. Add it to bin/presets.js and the setup wizard (see CONTRIBUTING.md).`).toEqual([]);
    }
  });
  it('every preset is valid settings', () => {
    for (const preset of PRESETS) expect(() => GuildConfig.parse(applyPresetTo(defaultGuildConfig(), preset)), preset.id).not.toThrow();
  });
  it('a preset only changes what it names', () => {
    const merged = applyPresetTo(defaultGuildConfig(), PRESETS.find((p: { id: string }) => p.id === 'careful'));
    expect(merged.filter.categories).toEqual(defaultGuildConfig().filter.categories);
    expect(merged.filter.shadow).toBe(true);
  });
  it('the recommended preset cannot delete, punish or kick anyone on its own', () => {
    const careful = PRESETS[0];
    expect(careful.id).toBe('careful');
    expect(careful.config.filter.shadow).toBe(true);
    expect(careful.config.raid.shadow).toBe(true);
    expect(careful.config.guard.shadow).toBe(true);
    expect(careful.config.spam.enabled).toBe(false);
  });
  it('the manual preset switches everything off', () => {
    const manual = PRESETS.find((p: { id: string }) => p.id === 'manual');
    for (const m of modules()) expect(manual.config[m].enabled, m).toBe(false);
  });
});

describe('the README documents every command', () => {
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  it('mentions each top-level command from the help', () => {
    for (const h of HELP.filter((x: { sub?: boolean }) => !x.sub)) {
      const cmd = h.usage.split('  ')[0].replace(/ \[.*\]$/, '');
      expect(readme, `README is missing "${cmd}". Document it (see CONTRIBUTING.md).`).toContain(cmd);
    }
  });
});

describe('discord helpers', () => {
  const fake = Buffer.from('1234567890123456789').toString('base64').replace(/=+$/, '') + '.' + 'abcdef' + '.' + 'x'.repeat(27);
  it('reads a token and its bot id', () => {
    expect(looksLikeToken(fake)).toBe(true);
    expect(clientIdFromToken(fake)).toBe('1234567890123456789');
    for (const bad of ['', 'abc', 'no dots here at all', 'a.b.c']) expect(looksLikeToken(bad)).toBe(false);
  });
  it('builds invite links with the right permissions', () => {
    expect(inviteUrl('42', true)).toContain('permissions=8');
    const rec = inviteUrl('42', false);
    expect(rec).toContain('client_id=42');
    expect(rec).toContain('scope=bot%20applications.commands');
    const perms = BigInt(/permissions=(\d+)/.exec(rec)![1]!);
    for (const bit of [1n << 13n, 1n << 40n, 1n << 1n, 1n << 2n, 1n << 28n, 1n << 7n]) expect(perms & bit).toBe(bit); // manage messages, timeout, kick, ban, manage roles, audit log
    expect(perms & 8n).toBe(0n); // never Administrator
  });
  it('reads the privileged intents from application flags', () => {
    expect(intentsFromFlags(0)).toEqual({ members: false, messageContent: false });
    expect(intentsFromFlags(1 << 14)).toEqual({ members: true, messageContent: false });
    expect(intentsFromFlags((1 << 15) | (1 << 18))).toEqual({ members: true, messageContent: true });
  });
});

describe('strictness levels', () => {
  it('are valid settings and each differs in how rudeness and swearing are handled', async () => {
    // @ts-ignore
    const { STRICTNESS: levels, applyPresetTo: apply } = await import('../../bin/presets.js');
    expect(levels.map((l: { id: string }) => l.id)).toEqual(['relaxed', 'standard', 'strict']);
    for (const l of levels) {
      const cfg = GuildConfig.parse(apply(defaultGuildConfig(), { config: { filter: { categories: l.categories, swearLevel: l.swearLevel } } }));
      expect(cfg.filter.categories.rudeness).toBe(l.categories.rudeness);
      for (const k of ['personalInfo', 'doxxing', 'threats', 'scams', 'slurs']) expect(cfg.filter.categories[k as 'threats'], `${l.id} must always delete ${k}`).toBe('delete');
    }
    expect(levels[0].categories.rudeness).toBe('off'); expect(levels[1].categories.rudeness).toBe('log'); expect(levels[2].categories.rudeness).toBe('delete');
  });
});

describe('wizard features and autostart', () => {
  it('the wizard answers merge deeply, changing only what they name', async () => {
    // @ts-ignore
    const { applyPresetTo: apply } = await import('../../bin/presets.js');
    const base = defaultGuildConfig();
    const out = apply(base, { config: { filter: { enabled: true, categories: { profanity: 'delete' } } } });
    expect(out.filter.categories.profanity).toBe('delete');
    expect(out.filter.categories.insults).toBe(base.filter.categories.insults);
    expect(GuildConfig.parse(out).filter.enabled).toBe(true);
  });
  it('every setting the feature questions touch is valid', () => {
    const patch = { filter: { enabled: true, shadow: true, learning: { enabled: true }, categories: { profanity: 'log', sexual: 'delete', invites: 'delete' } }, spam: { enabled: true }, raid: { enabled: true, shadow: true }, guard: { enabled: false, shadow: true } };
    expect(() => GuildConfig.parse(applyPresetTo(defaultGuildConfig(), { config: patch } as never))).not.toThrow();
  });
  it('builds a service file that runs warden --run', async () => {
    // @ts-ignore
    const { systemdUnit, launchdPlist } = await import('../../bin/autostart.js');
    expect(systemdUnit({ node: '/usr/bin/node', root: '/opt/warden' })).toContain('ExecStart=/usr/bin/node /opt/warden/bin/warden.js --run');
    expect(launchdPlist({ node: '/usr/bin/node', root: '/opt/warden' })).toContain('--run');
  });
  it('cleans pasted tokens', async () => {
    // @ts-ignore
    const { cleanToken } = await import('../../bin/discord.js');
    expect(cleanToken('  "abc.def.ghi"  ')).toBe('abc.def.ghi');
    expect(cleanToken('DISCORD_TOKEN=abc.def.ghi')).toBe('abc.def.ghi');
    expect(cleanToken('Bot abc.def.ghi')).toBe('abc.def.ghi');
    expect(cleanToken('abc.def.\nghi')).toBe('abc.def.ghi');
  });
});

describe('default look', () => {
  it('has a valid avatar, a sensible name ladder and an applyLook that stops when Discord says to', async () => {
    // @ts-ignore
    const { avatarDataUri, nameLadder, applyLook } = await import('../../bin/look.js');
    const { checkImage } = await import('../profile/validate.js');
    expect(checkImage(avatarDataUri(), 'x')).toBeNull();
    expect(avatarDataUri()).toContain('data:image/png;base64,');
    // @ts-ignore
    const { bannerDataUri } = await import('../../bin/look.js');
    expect(checkImage(bannerDataUri(), 'x')).toBeNull();
    expect(bannerDataUri()).toContain('data:image/jpeg;base64,');
    const [first, second] = nameLadder(() => 1234);
    expect(first).toBe('Warden');
    expect(second).toMatch(/^Warden-[a-z0-9]{4}$/);

    const calls: string[] = [];
    const api = (reply: (body: { username?: string }) => unknown) => async (path: string, _m: string, body?: { username?: string; nickname?: string }) => { calls.push(`${path} ${JSON.stringify(body).slice(0, 40)}`); return path.endsWith('/server') ? { applied: ['nick'], failed: {} } : reply(body ?? {}); };
    // taken twice: tries two names, then stops
    let r = await applyLook(api(b => (b.username ? { applied: [], failed: { username: 'x' }, reasons: { username: 'taken' } } : { applied: ['avatar'], failed: {} })), { guilds: [{ id: '1', name: 'S' }], names: ['Warden', 'Warden-abcd', 'Third'] });
    expect(r.username).toBeNull(); expect(r.avatar).toBe(true); expect(r.nicknames[0]).toMatchObject({ ok: true });
    expect(calls.filter(c => c.includes('"username"'))).toHaveLength(2);
    // first rejected, second accepted
    r = await applyLook(api(b => (b.username === 'Warden' ? { applied: [], failed: { username: 'x' }, reasons: { username: 'taken' } } : { applied: ['x'], failed: {} })), { guilds: [], avatar: false, banner: false, description: false, names: ['Warden', 'Warden-abcd'] });
    expect(r.username).toBe('Warden-abcd');
    // rate limited: stops at once
    calls.length = 0;
    r = await applyLook(api(b => (b.username ? { applied: [], failed: { username: 'x' }, reasons: { username: 'rate' } } : { applied: [], failed: {} })), { guilds: [], avatar: false, banner: false, description: false, names: ['Warden', 'Warden-abcd'] });
    expect(calls).toHaveLength(1); expect(r.notes.join(' ')).toMatch(/twice an hour/);
  });
});
