import Fastify from 'fastify';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ChannelType, type Client } from 'discord.js';
import { createModLogChannel, modLogExposure } from '../core/actions.js';
import { GuildConfig, TEST_MODE_MINUTES, isSafeRegex, testModeActive } from '../core/config.js';
import type { Store } from '../core/db.js';
import { classify } from '../rules/engine.js';
import { simulateAttack, type SimOptions } from '../sim/attack.js';
import { decide } from '../rules/policy.js';
import { learnerFor, saveLearners } from '../rules/learning.js';
import { readFile, rm, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { LOGIN_PAGE } from './page.js';
import { Routes } from 'discord.js';
import { discordErrorKind, friendlyDiscordError, validateGlobal, validateMember, type GlobalProfileInput, type MemberProfileInput } from '../profile/validate.js';

// If gui/index.html exists it is served as the control panel (re-read on every request, so edits show on refresh); otherwise the built-in basic page is used.
const GUI_FILE = fileURLToPath(new URL('../../gui/index.html', import.meta.url));
const loadPage = async () => { try { return await readFile(GUI_FILE, 'utf8'); } catch { return '<!doctype html><title>Warden</title><p>The control panel file (gui/index.html) is missing. Reinstall Warden.</p>'; } };

const CSP = "default-src 'none'; connect-src 'self'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: https://cdn.discordapp.com; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";
const safeEq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/** Localhost-only control panel. The bot token is never read or returned here. */
export async function startGui(client: Client, store: Store, password: string, port = 48731, keyFile?: string, host = '127.0.0.1') {
  const app = Fastify();
  // Never let the browser reuse an old copy of the page or API responses, and lock down what the page may do.
  app.addHook('onSend', async (_req, reply) => {
    reply.header('Cache-Control', 'no-store');
    reply.header('Content-Security-Policy', CSP);
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('Referrer-Policy', 'no-referrer');
    reply.header('Cross-Origin-Opener-Policy', 'same-origin');
    reply.header('Cross-Origin-Resource-Policy', 'same-origin');
    reply.header('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  });
  // Only answer requests addressed to this computer's own name. Stops DNS-rebinding, where a website points its own name at 127.0.0.1 to talk to the panel.
  const allowedHosts = new Set([`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`, ...(process.env.GUI_ALLOWED_HOSTS ?? '').split(',').map(h => h.trim().toLowerCase()).filter(Boolean)]);
  app.addHook('onRequest', async (req, reply) => {
    if (!allowedHosts.has(String(req.headers.host ?? '').toLowerCase())) return reply.code(421).send({ error: 'This panel only answers on 127.0.0.1.' });
    // Changes must come from the panel itself, never from another website the browser happens to have open.
    const origin = req.headers.origin;
    if (req.method !== 'GET' && req.method !== 'HEAD' && origin && !allowedHosts.has(origin.replace(/^https?:\/\//, '').toLowerCase())) return reply.code(403).send({ error: 'Cross-site request blocked.' });
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers['sec-fetch-site'] && !['same-origin', 'none'].includes(String(req.headers['sec-fetch-site']))) return reply.code(403).send({ error: 'Cross-site request blocked.' });
  });

  // Cookie-session login (works in any browser, unlike HTTP basic auth prompts).
  // Sessions survive restarts (only a hash of each token is stored, in a private file next to the key file) and last 30 idle days, so restarting the bot or sleeping the computer does not log you out.
  const sessions = new Map<string, number>(); // sha256(token) -> last used
  const SESSION_IDLE_MS = 30 * 86_400_000, MAX_SESSIONS = 200, COOKIE_MAX_AGE = 30 * 86_400;
  const sessionFile = keyFile ? join(dirname(keyFile), 'sessions.json') : null;
  const hash = (tok: string) => createHash('sha256').update(tok).digest('hex');
  if (sessionFile) {
    try {
      const saved = JSON.parse(readFileSync(sessionFile, 'utf8')) as [string, number][];
      for (const [h, last] of saved) if (typeof h === 'string' && typeof last === 'number' && Date.now() - last < SESSION_IDLE_MS) sessions.set(h, last);
    } catch { /* first run, or an unreadable file: start with no sessions */ }
  }
  let saveTimer: NodeJS.Timeout | null = null;
  const persist = () => {
    if (!sessionFile || saveTimer) return;
    saveTimer = setTimeout(() => { saveTimer = null; try { writeFileSync(sessionFile, JSON.stringify([...sessions]), { mode: 0o600 }); } catch { /* not fatal */ } }, 2000);
    saveTimer.unref();
  };
  const newSession = () => {
    const tok = randomBytes(32).toString('hex');
    if (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value as string);
    sessions.set(hash(tok), Date.now()); persist();
    return tok;
  };
  const validSession = (tok?: string) => {
    if (!tok) return false;
    const h = hash(tok), last = sessions.get(h);
    if (last === undefined) return false;
    if (Date.now() - last > SESSION_IDLE_MS) { sessions.delete(h); persist(); return false; }
    if (Date.now() - last > 3600_000) { sessions.set(h, Date.now()); persist(); } // refreshing hourly is enough
    return true;
  };
  const fails = new Map<string, { n: number; until: number }>();
  const cookieOf = (h?: string) => /(?:^|;\s*)warden_session=([a-f0-9]+)/.exec(h ?? '')?.[1];

  /** One-time login link used by the `warden` command: /?key=... matches a short-lived file the CLI wrote. */
  const tryKeyLogin = async (key: string): Promise<string | null> => {
    if (!keyFile || key.length < 16) return null;
    try {
      const [st, saved] = await Promise.all([stat(keyFile), readFile(keyFile, 'utf8')]);
      if (Date.now() - st.mtimeMs > 120_000 || !safeEq(saved.trim(), key)) return null;
      await rm(keyFile, { force: true }); // single use
      return newSession();
    } catch { return null; }
  };

  app.addHook('onRequest', async (req, reply) => {
    if (req.method === 'GET' && req.url.startsWith('/?key=')) {
      const tok = await tryKeyLogin(decodeURIComponent(req.url.slice(6)));
      if (tok) return reply.header('Set-Cookie', `warden_session=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}`).redirect('/');
    }
    if (req.url === '/login') return;
    const tok = cookieOf(req.headers.cookie);
    if (validSession(tok)) return;
    if (req.url.startsWith('/api/')) return reply.code(401).send({ error: 'not logged in' });
    return reply.type('text/html').send(LOGIN_PAGE);
  });

  app.post<{ Body: { password?: string } }>('/login', async (req, reply) => {
    const ip = req.ip;
    const f = fails.get(ip);
    if (f && f.n >= 5 && Date.now() < f.until) return reply.code(429).send({ error: 'too many attempts, wait a minute' });
    if (!safeEq(String(req.body?.password ?? ''), password)) {
      fails.set(ip, { n: (f?.n ?? 0) + 1, until: Date.now() + 60_000 });
      await new Promise(r => setTimeout(r, 400)); // slows guessing
      return reply.code(401).send({ error: 'wrong password' });
    }
    fails.delete(ip);
    const tok = newSession();
    reply.header('Set-Cookie', `warden_session=${tok}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE}`);
    return { ok: true };
  });

  app.get('/', async (_req, reply) => reply.type('text/html').send(await loadPage()));
  app.get('/api/guilds', async () => client.guilds.cache.map(g => ({ id: g.id, name: g.name })));
  app.get<{ Params: { id: string } }>('/api/config/:id', async req => store.getConfig(req.params.id));
  app.put<{ Params: { id: string } }>('/api/config/:id', async (req, reply) => {
    const wanted = (req.body as { filter?: { customRegex?: unknown } } | null)?.filter?.customRegex;
    if (Array.isArray(wanted)) {
      const bad = wanted.find(r => typeof r !== 'string' || r.length > 200 || !isSafeRegex(r));
      if (bad !== undefined) return reply.code(400).send({ error: [`filter.customRegex: “${String(bad).slice(0, 60)}” is not a valid pattern, is over 200 characters, or could freeze the bot (avoid nested repeats like (a+)+)`] });
    }
    const parsed = GuildConfig.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map(i => `${i.path.join('.')}: ${i.message}`) });
    // Test mode auto-expires: a fresh enable starts a new timer, an already-active one keeps its deadline.
    const next = parsed.data;
    const prev = store.getConfig(req.params.id);
    if (!next.testMode) next.testModeUntil = null;
    else next.testModeUntil = testModeActive(prev) ? prev.testModeUntil : Date.now() + TEST_MODE_MINUTES * 60_000;
    store.setConfig(req.params.id, next);
    return next;
  });
  // Pickers in the panel: channel and role lists from the bot's cache, and member search, so nobody has to copy IDs by hand.
  app.get<{ Params: { id: string } }>('/api/directory/:id', async (req, reply) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return reply.code(404).send({ error: 'Unknown server' });
    const textual = [ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildVoice, ChannelType.GuildStageVoice, ChannelType.GuildMedia];
    return {
      channels: [...guild.channels.cache.filter(c => textual.includes(c.type)).values()].sort((a, b) => ('rawPosition' in a ? a.rawPosition : 0) - ('rawPosition' in b ? b.rawPosition : 0))
        .map(c => ({ id: c.id, name: c.name, kind: c.type === ChannelType.GuildVoice || c.type === ChannelType.GuildStageVoice ? 'voice' : c.type === ChannelType.GuildForum ? 'forum' : 'text', parent: c.parent?.name ?? null })),
      roles: [...guild.roles.cache.filter(r => r.id !== guild.id).values()].sort((a, b) => b.position - a.position).map(r => ({ id: r.id, name: r.name, color: r.hexColor === '#000000' ? null : r.hexColor, managed: r.managed, members: r.members.size })),
    };
  });
  app.get<{ Params: { id: string }; Querystring: { q?: string; ids?: string } }>('/api/members/:id', async (req, reply) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return reply.code(404).send({ error: 'Unknown server' });
    const shape = (m: { id: string; displayName: string; user: { username: string; bot: boolean } }) => ({ id: m.id, name: m.displayName, username: m.user.username, bot: m.user.bot });
    try {
      if (req.query.ids) {
        const ids = req.query.ids.split(',').filter(i => /^\d{15,22}$/.test(i)).slice(0, 25);
        const found = await Promise.all(ids.map(i => guild.members.fetch(i).then(shape).catch(() => null)));
        return found.filter(Boolean);
      }
      const q = String(req.query.q ?? '').trim().slice(0, 32);
      const list = q ? await guild.members.search({ query: q, limit: 10 }) : await guild.members.fetch({ limit: 10 });
      return [...list.values()].map(shape);
    } catch (e) { return reply.code(502).send({ error: `Discord would not list members: ${(e as Error).message}` }); }
  });
  // Numbers for the Overview: what happened in the last 24 hours.
  app.get<{ Params: { id: string } }>('/api/stats/:id', async req => {
    const rows = store.auditCounts(req.params.id, Date.now() - 86_400_000);
    const sum = (f: (r: { module: string; action: string }) => boolean) => rows.filter(f).reduce((a, r) => a + r.n, 0);
    return {
      removed: sum(r => ['filter', 'spam'].includes(r.module) && ['delete', 'timeout', 'kick', 'ban', 'warn'].includes(r.action)),
      wouldRemove: sum(r => r.action === 'shadow'),
      needsLook: sum(r => r.action === 'review'),
      loggedOnly: sum(r => r.action === 'log'),
      timeouts: sum(r => r.action === 'escalate'),
      raids: sum(r => ['raid', 'guard'].includes(r.module) && r.action !== 'shadow'),
    };
  });
  // The private mod-log channel: status (and a warning if everyone can read it), and one click to create it.
  app.get<{ Params: { id: string } }>('/api/modlog/:id', async (req, reply) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return reply.code(404).send({ error: 'Unknown server' });
    return modLogExposure(guild, store.getConfig(guild.id).modLogChannel);
  });
  app.post<{ Params: { id: string } }>('/api/modlog/:id', async (req, reply) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return reply.code(404).send({ error: 'Unknown server' });
    const made = await createModLogChannel(guild);
    if (!made.ok) return reply.code(400).send({ error: made.error });
    const cfg = store.getConfig(guild.id); cfg.modLogChannel = made.channel.id; store.setConfig(guild.id, cfg);
    store.audit(guild.id, 'panel', 'modlog', client.user?.id ?? '0', `created the private mod-log channel #${made.channel.name}`);
    return { id: made.channel.id, name: made.channel.name };
  });
  // Try the filter against sample text with the saved settings, no Discord needed.
  app.post<{ Params: { id: string }; Body: { text?: string; addressed?: boolean; channelId?: string; roleIds?: string[] } }>('/api/test-filter/:id', async req => {
    const cfg = store.getConfig(req.params.id);
    const f = cfg.filter;
    const text = String(req.body?.text ?? '').slice(0, 4000);
    const addressed = !!req.body?.addressed; // the message pings or replies to someone
    const c = classify(text, { mentionsOthers: addressed, replyToOther: false }, { customWords: f.customWords, customRegex: f.customRegex, allowWords: f.allowWords, learnedWords: f.learning.enabled ? new Set(learnerFor(store, req.params.id).learned()) : undefined });
    const roleIds = Array.isArray(req.body?.roleIds) ? req.body!.roleIds!.filter((r): r is string => typeof r === 'string').slice(0, 50) : [];
    const d = decide(c, { categories: f.categories, exceptions: f.exceptions, swearLevel: f.swearLevel }, { channelId: String(req.body?.channelId ?? ''), roleIds });
    const action = d.action;
    return {
      enabled: f.enabled, shadow: f.shadow,
      hits: d.outcomes.map(o => ({ category: o.hit.category, term: o.hit.term, mode: o.mode, why: o.why })),
      maybes: f.unsure === 'off' ? [] : (c.maybes ?? []).map(m => ({ category: m.category, term: m.term, why: m.why })),
      wouldDo: f.enabled && action !== 'none' ? action : null, strikes: d.weight,
    };
  });

  // Fire drill: a fake attack on a virtual server, run through the real raid and guard code. Nothing touches Discord.
  app.post<{ Params: { id: string }; Body: Partial<SimOptions> }>('/api/simulate-raid/:id', async (req, reply) => {
    const b = req.body ?? {};
    const num = (v: unknown, lo: number, hi: number, d: number) => { const n = Number(v); return Number.isFinite(n) ? Math.max(lo, Math.min(hi, Math.round(n))) : d; };
    const style = b.style === 'waves' || b.style === 'drip' ? b.style : 'burst';
    const cfg = store.getConfig(req.params.id);
    try {
      return await simulateAttack(cfg.raid, cfg.guard, {
        attackers: num(b.attackers, 20, 200, 40), style, adminRaiders: num(b.adminRaiders, 0, 10, 3), outrankingAdmin: !!b.outrankingAdmin,
        messagesPerBot: num(b.messagesPerBot, 1, 10, 5), innocents: num(b.innocents, 0, 10, 2),
      });
    } catch (e) { return reply.code(500).send({ error: 'simulation failed: ' + (e as Error).message }); }
  });
  // Full log: every action the bot recorded (filter, spam, raid, guard), newest first, with paging, module filter and search.
  app.get<{ Params: { id: string }; Querystring: { limit?: string; before?: string; module?: string; kind?: string; q?: string } }>('/api/audit/:id', async req => {
    const { limit, before, module, kind, q } = req.query;
    const known = ['filter', 'spam', 'raid', 'guard', 'panel'];
    const kinds: Record<string, string[]> = { removed: ['delete', 'timeout', 'kick', 'ban', 'warn'], watched: ['shadow'], review: ['review'], log: ['log'], timeout: ['escalate'] };
    return store.listAudit(req.params.id, {
      limit: Number(limit) || 100, before: Number(before) || undefined,
      module: module && known.includes(module) ? module : undefined, actions: kind ? kinds[kind] : undefined, q: q ? q.slice(0, 100) : undefined,
    });
  });

  // --- Bot profile: global username, avatar, banner and description, plus per-server nickname, avatar, banner and bio. ---
  const IMAGE_BODY = 14 * 1024 * 1024; // an 8 MB image is about 11 MB as base64
  const cdn = (url: string | null | undefined) => url ?? null;
  app.get<{ Params: { id: string } }>('/api/profile/:id', async (req, reply) => {
    if (!client.user) return reply.code(503).send({ error: 'The bot is still connecting to Discord. Try again in a moment.' });
    const guild = client.guilds.cache.get(req.params.id);
    const [user, app_] = await Promise.all([client.users.fetch(client.user.id, { force: true }).catch(() => client.user!), client.application?.fetch().catch(() => null)]);
    const me = guild?.members.me ?? null;
    return {
      id: user.id, username: user.username, avatar: cdn(user.displayAvatarURL({ size: 256, extension: 'png' })), hasAvatar: !!user.avatar,
      banner: cdn(user.bannerURL({ size: 512, extension: 'png' })), description: app_?.description ?? '', appName: app_?.name ?? null, // the name shown in the Developer Portal: Discord does not let a bot change it
      server: guild ? { name: guild.name, nickname: me?.nickname ?? null, avatar: me?.avatar ? me.displayAvatarURL({ size: 256, extension: 'png' }) : null, banner: me?.banner ? me.bannerURL({ size: 512, extension: 'png' }) ?? null : null } : null,
    };
  });
  app.put<{ Body: GlobalProfileInput }>('/api/profile', { bodyLimit: IMAGE_BODY }, async (req, reply) => {
    if (!client.user) return reply.code(503).send({ error: 'The bot is still connecting to Discord. Try again in a moment.' });
    const b = req.body ?? {};
    const errors = validateGlobal(b);
    if (Object.keys(errors).length) return reply.code(400).send({ error: Object.values(errors)[0], errors });
    const applied: string[] = [];
    const failed: Record<string, string> = {}, reasons: Record<string, string> = {};
    const attempt = async (key: string, fn: () => Promise<unknown>) => { try { await fn(); applied.push(key); } catch (e) { failed[key] = friendlyDiscordError(e); reasons[key] = discordErrorKind(e); } };
    if (b.username !== undefined && String(b.username).trim() !== client.user.username) await attempt('username', () => client.user!.setUsername(String(b.username).trim()));
    if (b.avatar !== undefined) {
      await attempt('avatar', () => client.user!.setAvatar(b.avatar as string | null));
      // The app has its own icon in the Developer Portal; keep it the same as the bot's picture.
      if (applied.includes('avatar')) await attempt('appIcon', async () => { await client.application!.edit({ icon: b.avatar as string | null }); });
    }
    if (b.banner !== undefined) await attempt('banner', () => client.user!.setBanner(b.banner as string | null));
    if (b.description !== undefined) await attempt('description', async () => { await client.application!.edit({ description: String(b.description) }); });
    store.audit('global', 'profile', 'update', 'panel', `changed ${applied.join(', ') || 'nothing'}${Object.keys(failed).length ? `; failed: ${Object.entries(failed).map(([k, v]) => `${k} (${v})`).join('; ')}` : ''}`);
    return { applied, failed, reasons };
  });
  app.put<{ Params: { id: string }; Body: MemberProfileInput }>('/api/profile/:id/server', { bodyLimit: IMAGE_BODY }, async (req, reply) => {
    const guild = client.guilds.cache.get(req.params.id);
    if (!guild) return reply.code(404).send({ error: 'The bot is not in that server.' });
    const b = req.body ?? {};
    const errors = validateMember(b);
    if (Object.keys(errors).length) return reply.code(400).send({ error: Object.values(errors)[0], errors });
    const body: Record<string, unknown> = {};
    if (b.nickname !== undefined) body.nick = b.nickname === null || b.nickname === '' ? null : b.nickname;
    for (const k of ['avatar', 'banner', 'bio'] as const) if (b[k] !== undefined) body[k] = b[k] === '' ? null : b[k];
    if (!Object.keys(body).length) return { applied: [], failed: {} };
    try {
      await client.rest.patch(Routes.guildMember(guild.id, '@me'), { body });
      store.audit(guild.id, 'profile', 'update', 'panel', `changed server profile: ${Object.keys(body).join(', ')}`);
      return { applied: Object.keys(body), failed: {} };
    } catch (e) { return { applied: [], failed: { server: friendlyDiscordError(e) }, reasons: { server: discordErrorKind(e) } }; }
  });

  // --- Send feedback (the bug button). The panel never decides where it goes; bin/feedback.js does, and it always shows what it sends. ---
  // @ts-ignore the CLI is plain JavaScript
  const fb = await import('../../bin/feedback.js') as typeof import('../../bin/feedback.js');
  const reportFrom = (b: { kind?: string; message?: string; contact?: string; diagnostics?: boolean } | undefined) => {
    const on: string[] = [];
    for (const g of client.guilds.cache.values()) { const c = store.getConfig(g.id); for (const m of ['filter', 'spam', 'raid', 'guard'] as const) if (c[m].enabled && !on.includes(m)) on.push(m); }
    return fb.buildReport({ kind: b?.kind, message: String(b?.message ?? ''), contact: String(b?.contact ?? ''), withDiagnostics: !!b?.diagnostics, extra: { servers: client.guilds.cache.size, 'modules on': on.join(', ') || 'none', discord: client.isReady() ? 'connected' : 'not connected' } });
  };
  // The strictness levels live in bin/presets.js, so the setup wizard and the panel always agree.
  // @ts-ignore the CLI is plain JavaScript
  const presets = await import('../../bin/presets.js') as { STRICTNESS: unknown[] };
  app.get('/api/strictness', async () => presets.STRICTNESS);
  app.get('/api/feedback/status', async () => ({ configured: !!fb.destination(), cooldown: fb.secondsUntilAllowed() }));
  app.post<{ Body: { kind?: string; message?: string; contact?: string; diagnostics?: boolean } }>('/api/feedback/preview', async req => ({ text: fb.previewText(reportFrom(req.body)) }));
  app.post<{ Body: { kind?: string; message?: string; contact?: string; diagnostics?: boolean } }>('/api/feedback', async (req, reply) => {
    const report = reportFrom(req.body);
    const r = await fb.sendReport(report);
    if (r.ok) return { ok: true };
    if (r.reason === 'no-destination') { const file = fb.saveUnsent(report); return reply.code(503).send({ error: `${r.message} Your note was saved in ${file} so you can send it another way.` }); }
    return reply.code(r.reason === 'cooldown' ? 429 : r.reason === 'empty' ? 400 : 502).send({ error: r.message });
  });
  // Words the filter has picked up on its own, plus a way to make it forget one.
  app.get<{ Params: { id: string } }>('/api/learned/:id', async req => learnerFor(store, req.params.id).describe());
  app.delete<{ Params: { id: string }; Querystring: { term?: string } }>('/api/learned/:id', async (req, reply) => {
    const term = String(req.query.term ?? '').toLowerCase().slice(0, 40);
    if (!term) return reply.code(400).send({ error: 'term is required' });
    const l = learnerFor(store, req.params.id); l.forget(term); saveLearners(store);
    return l.describe();
  });
  app.get<{ Params: { id: string } }>('/api/flags/:id', async req => store.listFlags(req.params.id));
  await app.listen({ host, port });
  console.log(`GUI: http://${host}:${port}${host === "127.0.0.1" ? " (localhost only)" : ""}`);
}
