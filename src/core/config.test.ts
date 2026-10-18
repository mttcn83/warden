import { describe, expect, it } from 'vitest';
import { GuildConfig, defaultGuildConfig, testModeActive } from './config.js';

describe('testModeActive', () => {
  it('is off by default and expires', () => {
    const c = defaultGuildConfig();
    expect(testModeActive(c, 1000)).toBe(false);
    expect(testModeActive({ ...c, testMode: true, testModeUntil: 2000 }, 1000)).toBe(true);
    expect(testModeActive({ ...c, testMode: true, testModeUntil: 2000 }, 3000)).toBe(false);
    expect(testModeActive({ ...c, testMode: true, testModeUntil: null }, 1000)).toBe(false);
  });
});

describe('fresh server defaults', () => {
  it('fills in every nested default and keeps everything opt-in', () => {
    const c = defaultGuildConfig();
    expect(c.filter).toMatchObject({ enabled: false, shadow: false, exceptions: [], allowWords: [] });
    expect(c.filter.categories).toMatchObject({ profanity: 'off', sexual: 'off', directedProfanity: 'delete', insults: 'delete', slurs: 'delete', threats: 'delete', doxxing: 'delete', personalInfo: 'delete' });
    expect(c.filter.escalation).toMatchObject({ enabled: true, windowHours: 24, timeoutAfter: 4, timeoutMinutes: 10, longTimeoutAfter: 8, longTimeoutHours: 6 });
    expect(c.filter.exempt).toEqual({ roles: [], channels: [] });
    expect(c.spam.enabled).toBe(false);
    expect(c.testMode).toBe(false);
  });
  it('accepts exceptions and fills in their defaults', () => {
    const c = GuildConfig.parse({ filter: { exceptions: [{ channels: ['1'], categories: ['profanity'] }] } });
    expect(c.filter.exceptions).toEqual([{ channels: ['1'], roles: [], categories: ['profanity'], mode: 'off' }]);
  });
  it('ignores settings from older versions instead of failing', () => {
    const old = GuildConfig.parse({ filter: { enabled: true, action: 'ban', categories: { abuse: true, cursing: true }, ml: { enabled: true, judge: true, adapt: true } } });
    expect((old.filter as Record<string, unknown>).ml).toBeUndefined(); // the AI check was removed
    expect(old.filter.enabled).toBe(true);
    expect(old.filter.categories.profanity).toBe('off');
  });
});

describe('raid and guard defaults', () => {
  it('are off and in dry-run mode by default', () => {
    const c = defaultGuildConfig();
    expect(c.raid).toMatchObject({ enabled: false, shadow: true, joinsPerWindow: 8, windowSeconds: 10, action: 'timeout' });
    expect(c.guard).toMatchObject({ enabled: false, shadow: true, stripRaidRoles: true, stripLetterIn: true, trustedAdmins: [] });
  });
});

describe('learning defaults', () => {
  it('is off by default and learned words are only logged', () => {
    const f = defaultGuildConfig().filter;
    expect(f.learning.enabled).toBe(false);
    expect(f.categories.learned).toBe('log');
  });
});

describe('custom patterns', () => {
  it('drops patterns that are broken or could freeze the bot, keeps good ones', () => {
    const c = GuildConfig.parse({ filter: { customRegex: ['bad\\s+word', '(a+)+$', '[unclosed', 'x'.repeat(300)] } });
    expect(c.filter.customRegex).toEqual(['bad\\s+word']);
  });
});
