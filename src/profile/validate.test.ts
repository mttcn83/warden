import { describe, expect, it } from 'vitest';
import { checkImage, friendlyDiscordError, validateGlobal, validateMember } from './validate.js';

const png = 'data:image/png;base64,iVBORw0KGgo=';
describe('profile validation', () => {
  it('accepts normal images and rejects other things', () => {
    expect(checkImage(png, 'x')).toBeNull();
    expect(checkImage('data:image/svg+xml;base64,AAAA', 'x')).toMatch(/PNG, JPG, GIF or WebP/);
    expect(checkImage('https://example.com/a.png', 'x')).toMatch(/PNG, JPG/);
    expect(checkImage('data:image/png;base64,' + 'A'.repeat(12 * 1024 * 1024), 'x')).toMatch(/too big/);
    expect(checkImage(5, 'x')).toMatch(/image/);
  });
  it('checks global fields and ignores the ones left out', () => {
    expect(validateGlobal({})).toEqual({});
    expect(validateGlobal({ username: 'W', description: 'ok', avatar: png, banner: null })).toHaveProperty('username');
    expect(validateGlobal({ username: 'Warden', description: 'x'.repeat(401) })).toHaveProperty('description');
    expect(validateGlobal({ username: '  Warden  ', avatar: null })).toEqual({});
  });
  it('checks per-server fields', () => {
    expect(validateMember({ nickname: null, bio: 'hi' })).toEqual({});
    expect(validateMember({ nickname: 'x'.repeat(33) })).toHaveProperty('nickname');
    expect(validateMember({ bio: 'x'.repeat(200) })).toHaveProperty('bio');
    expect(validateMember({ avatar: 'nope' })).toHaveProperty('avatar');
  });
  it('explains Discord errors in plain words', () => {
    expect(friendlyDiscordError({ status: 429 })).toMatch(/couple of times per hour/);
    expect(friendlyDiscordError({ code: 50013 })).toMatch(/missing permission/);
    expect(friendlyDiscordError(new Error('boom'))).toBe('boom');
    expect(friendlyDiscordError(new Error('Invalid Form Body\nusername[USERNAME_TOO_MANY_USERS]: Too many users have this username, please try another'))).toMatch(/more unusual/);
    expect(friendlyDiscordError(new Error('username[USERNAME_INVALID]: not allowed'))).toMatch(/does not allow that name/);
  });
});
