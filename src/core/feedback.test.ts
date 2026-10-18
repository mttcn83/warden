import { fakeToken } from '../testing/tokens.js';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
// The CLI is plain JavaScript (no build step), so it has no type declarations.
// @ts-ignore
import { redact, destination, buildReport, previewText, requestFor, sendReport, MAX_MESSAGE } from '../../bin/feedback.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'warden-fb-'));
const okFetch = (calls: unknown[]) => (async (url: string, init: unknown) => { calls.push({ url, init }); return { ok: true, status: 204 }; }) as never;

describe('redact', () => {
  it('removes tokens, keys, ids, emails, ips and webhooks', () => {
    const out = redact(`token ${fakeToken('a')} key sk-abcdefghijklmnopqrstuvwx guild 1000000000000000001 mail me@example.com ip 98.45.221.7 hook https://discord.com/api/webhooks/123456789012345678/abcDEF_ghi`);
    for (const bad of ['MTIzNDU2', 'sk-abcdef', '1000000000000000001', 'me@example.com', '98.45.221.7', 'webhooks/123']) expect(out).not.toContain(bad);
    expect(out).toContain('<discord-token>');
  });
  it('removes passwords from env lines and urls', () => {
    expect(redact('GUI_PASSWORD=hunter2hunter2')).not.toContain('hunter2');
    expect(redact('https://x.test/cb?token=abcdef123456&a=1')).toContain('token=<secret>');
  });
  it('replaces your home folder', () => expect(redact(`error at ${homedir()}/warden/src/index.ts`)).toContain('~/warden'));
  it('leaves ordinary text alone', () => expect(redact('the panel froze when I clicked Save on the Raid page')).toBe('the panel froze when I clicked Save on the Raid page'));
});

describe('destination', () => {
  it('prefers the environment, then the config file, and needs https', () => {
    const dir = tmp(), file = join(dir, 'c.json');
    writeFileSync(file, JSON.stringify({ webhook: 'https://discord.com/api/webhooks/1/abc' }));
    expect(destination({}, file)).toEqual({ kind: 'discord', url: 'https://discord.com/api/webhooks/1/abc' });
    expect(destination({ WARDEN_FEEDBACK_URL: 'https://ntfy.sh/mytopic' }, file)).toEqual({ kind: 'ntfy', url: 'https://ntfy.sh/mytopic' });
    expect(destination({ WARDEN_FEEDBACK_URL: 'https://example.com/hook' }, file)?.kind).toBe('json');
    expect(destination({ WARDEN_FEEDBACK_URL: 'http://evil.example/hook' }, join(dir, 'none.json'))).toBeNull();
    expect(destination({ WARDEN_FEEDBACK_URL: 'http://127.0.0.1:9/hook' }, join(dir, 'none.json'))?.kind).toBe('json');
  });
  it('is null when nothing is set up', () => {
    const file = join(tmp(), 'c.json'); writeFileSync(file, JSON.stringify({ webhook: '' }));
    expect(destination({}, file)).toBeNull();
  });
});

describe('report', () => {
  it('is cleaned, limited and cannot ping anyone', () => {
    const r = buildReport({ kind: 'bug', message: 'hi @everyone ' + 'x'.repeat(3000), contact: 'me@example.com' });
    expect(r.message.length).toBeLessThanOrEqual(MAX_MESSAGE);
    expect(r.contact).toBe('me@example.com'); // typed on purpose, so it stays
    const req = requestFor({ kind: 'discord', url: 'https://discord.com/api/webhooks/1/a' }, r);
    expect(JSON.parse(req.body).allowed_mentions).toEqual({ parse: [] });
    expect(JSON.parse(req.body).embeds[0].title).toContain('Bug');
  });
  it('shows the same thing it sends', () => {
    const r = buildReport({ kind: 'idea', message: 'dark mode please' });
    expect(previewText(r)).toContain('dark mode please');
    expect(previewText(r)).toContain('diagnostics: not included');
    expect(requestFor({ kind: 'ntfy', url: 'https://ntfy.sh/t' }, r).body).toBe(previewText(r));
  });
  it('includes diagnostics only when asked', () => {
    expect(buildReport({ message: 'bug here', withDiagnostics: false }).diagnostics).toBe('');
    expect(buildReport({ message: 'bug here', withDiagnostics: true }).diagnostics).toContain('warden ');
  });
  it('treats an unknown kind as other', () => expect(buildReport({ kind: 'weird', message: 'hello' }).kind).toBe('other'));
});

describe('sendReport', () => {
  const env = { WARDEN_FEEDBACK_URL: 'https://discord.com/api/webhooks/1/abc' };
  it('sends once, then asks you to wait', async () => {
    const calls: unknown[] = [], file = join(tmp(), 'last');
    const r = buildReport({ message: 'it crashed when i saved' });
    expect(await sendReport(r, { env, fetchImpl: okFetch(calls), file, now: 1_000_000 })).toEqual({ ok: true });
    expect(calls).toHaveLength(1);
    const again = await sendReport(r, { env, fetchImpl: okFetch(calls), file, now: 1_010_000 });
    expect(again).toMatchObject({ ok: false, reason: 'cooldown' });
    expect(calls).toHaveLength(1);
    expect(await sendReport(r, { env, fetchImpl: okFetch(calls), file, now: 1_070_000 })).toEqual({ ok: true });
  });
  it('explains failures instead of throwing', async () => {
    const file = join(tmp(), 'last'), r = buildReport({ message: 'something broke' });
    expect(await sendReport(r, { env, fetchImpl: (async () => ({ ok: false, status: 404 })) as never, file })).toMatchObject({ ok: false, reason: 'rejected' });
    expect(await sendReport(r, { env, fetchImpl: (async () => { throw new Error('offline'); }) as never, file })).toMatchObject({ ok: false, reason: 'network' });
    expect(await sendReport(r, { env: {}, configFile: join(tmp(), 'none.json'), fetchImpl: okFetch([]), file })).toMatchObject({ ok: false, reason: 'no-destination' });
    expect(await sendReport(buildReport({ message: '' }), { env, fetchImpl: okFetch([]), file })).toMatchObject({ ok: false, reason: 'empty' });
  });
});
