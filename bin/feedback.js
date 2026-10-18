// "Send feedback": builds a report, removes secrets, shows exactly what will be sent, and posts it to the address in
// feedback.config.json (or WARDEN_FEEDBACK_URL). Used by both the CLI and the control panel. No dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ROOT, DATA, LOG, VERSION, tailLines } from './env.js';

export const CONFIG_FILE = path.join(ROOT, 'feedback.config.json');
export const KINDS = { bug: { label: 'Bug', icon: '🐛', color: 0xe5534b }, idea: { label: 'Idea', icon: '💡', color: 0xf2c744 }, other: { label: 'Other', icon: '💬', color: 0x5865f2 } };
export const MAX_MESSAGE = 1500;
export const COOLDOWN_SECONDS = 60;

/** Where reports go, or null when this copy has no address set. */
export function destination(env = process.env, file = CONFIG_FILE) {
  let url = (env.WARDEN_FEEDBACK_URL || '').trim();
  if (!url) { try { url = String(JSON.parse(fs.readFileSync(file, 'utf8')).webhook ?? '').trim(); } catch { url = ''; } }
  if (!/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:|\/)/i.test(url)) return null; // https only (plain http only for local testing)
  let host = ''; try { host = new URL(url).host; } catch { return null; }
  const kind = /(^|\.)(discord|discordapp)\.com$/i.test(host) && /\/api\/webhooks\//.test(url) ? 'discord' : /(^|\.)ntfy\.sh$/i.test(host) ? 'ntfy' : 'json';
  return { kind, url };
}

// ---- keeping secrets out ----
const RULES = [
  [/\b[MNO][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,38}\b/g, '<discord-token>'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g, '<jwt>'],
  [/\b(?:sk-[A-Za-z0-9_-]{16,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{30,})\b/g, '<api-key>'],
  [/\bBearer\s+[A-Za-z0-9._~+\/=-]{12,}/gi, 'Bearer <secret>'],
  [/([?&](?:key|token|secret|password|pass|auth|code)=)[^&\s"']+/gi, '$1<secret>'],
  [/\b(DISCORD_TOKEN|GUI_PASSWORD|[A-Z_]*(?:TOKEN|SECRET|PASSWORD|KEY))\s*[=:]\s*\S+/g, '$1=<secret>'],
  [/\bhttps?:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\S+/gi, '<webhook-url>'],
  [/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi, '<email>'],
  [/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.])/g, ip => (/^(127\.|10\.|192\.168\.|0\.0\.0\.0$)/.test(ip) ? ip : '<ip>')], // your own machine and home network say nothing about you
  [/\bonline as \S+/g, 'online as <bot>'],
  [/\b\d{17,20}\b/g, '<id>'], // Discord user, server and channel IDs
  [/\b[A-Za-z0-9_-]{40,}\b/g, '<secret>'],
];
/** Takes tokens, keys, passwords, emails, IP addresses, Discord IDs and your home folder out of text. */
export function redact(text) {
  let out = String(text ?? '');
  for (const [re, to] of RULES) out = out.replace(re, to);
  const home = os.homedir();
  if (home && home.length > 3) out = out.split(home).join('~');
  return out;
}
const clean = s => String(s ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').replace(/\r\n?/g, '\n');

/** Facts that help debug, with nothing personal in them. `extra` lets the panel add what only it knows. */
export function diagnostics({ extra = {}, logLines = 15 } = {}) {
  const lines = [
    `warden ${VERSION}`,
    `node ${process.versions.node} on ${process.platform}/${process.arch}`,
    ...Object.entries(extra).map(([k, v]) => `${k}: ${v}`),
  ];
  const log = [...new Set(tailLines(LOG, logLines * 3).map(l => l.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')))].slice(-logLines); // repeated lines once
  if (log.length) lines.push('', 'last log lines:', ...log);
  return redact(lines.join('\n')).slice(0, 1100);
}

/** One report, as plain fields. Everything in it has been through redact(). */
export function buildReport({ kind = 'bug', message = '', contact = '', withDiagnostics = false, extra = {} } = {}) {
  const k = KINDS[kind] ? kind : 'other';
  const text = redact(clean(message)).trim().slice(0, MAX_MESSAGE);
  return {
    kind: k,
    message: text,
    contact: clean(contact).replace(/\n/g, ' ').trim().slice(0, 120), // typed on purpose so you can answer them, so it is not removed
    version: VERSION,
    system: `${process.platform}/${process.arch}, node ${process.versions.node}`,
    diagnostics: withDiagnostics ? diagnostics({ extra }) : '',
  };
}

/** The plain-text version people see in the preview. */
export function previewText(r) {
  const k = KINDS[r.kind];
  return [`${k.icon} ${k.label}`, '', r.message || '(empty)', '', `contact: ${r.contact || '(none given)'}`, `version: ${r.version}`, `system: ${r.system}`, ...(r.diagnostics ? ['', '--- diagnostics ---', r.diagnostics] : ['diagnostics: not included'])].join('\n');
}

/** The HTTP request for a destination. Mentions are switched off so a report can never ping anybody. */
export function requestFor(dest, r) {
  const k = KINDS[r.kind];
  if (dest.kind === 'discord') {
    const fields = [{ name: 'Version', value: r.version, inline: true }, { name: 'System', value: r.system, inline: true }, { name: 'Contact', value: r.contact || '(none given)', inline: true }];
    if (r.diagnostics) fields.push({ name: 'Diagnostics', value: '```\n' + r.diagnostics.replace(/```/g, "'''").slice(0, 950) + '\n```' });
    return { url: dest.url, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'Warden feedback', allowed_mentions: { parse: [] }, embeds: [{ title: `${k.icon} ${k.label}`, description: r.message.slice(0, 1900) || '(empty)', color: k.color, fields, footer: { text: 'sent from warden --feedback or the control panel' } }] }) };
  }
  if (dest.kind === 'ntfy') return { url: dest.url, headers: { Title: `Warden ${k.label.toLowerCase()} (v${r.version})`, Tags: r.kind === 'bug' ? 'bug' : 'speech_balloon', 'Content-Type': 'text/plain; charset=utf-8' }, body: previewText(r) };
  return { url: dest.url, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...r, text: previewText(r) }) };
}

// ---- sending, with a cooldown so nobody (not even a bug) can flood the inbox ----
const stampFile = () => path.join(DATA, '.feedback-last');
export function secondsUntilAllowed(now = Date.now(), file = stampFile()) {
  try { return Math.max(0, Math.ceil((Number(fs.readFileSync(file, 'utf8')) + COOLDOWN_SECONDS * 1000 - now) / 1000)); } catch { return 0; }
}
/** Sends a report. Returns { ok: true } or { ok: false, reason, message }. Never throws. */
export async function sendReport(r, { env = process.env, fetchImpl = fetch, file = stampFile(), configFile = CONFIG_FILE, now = Date.now() } = {}) {
  if (!r.message || r.message.length < 3) return { ok: false, reason: 'empty', message: 'Write a few words first.' };
  const dest = destination(env, configFile);
  if (!dest) return { ok: false, reason: 'no-destination', message: 'This copy of Warden has no feedback address set up, so nothing was sent.' };
  const wait = secondsUntilAllowed(now, file);
  if (wait > 0) return { ok: false, reason: 'cooldown', message: `You just sent one. Please wait ${wait} more second${wait === 1 ? '' : 's'}.` };
  try {
    const req = requestFor(dest, r);
    const res = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: req.body, signal: AbortSignal.timeout(15000) });
    if (!res.ok) return { ok: false, reason: 'rejected', message: `The feedback address answered with an error (${res.status}). It may have been turned off.` };
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, String(now)); } catch { /* the cooldown is a courtesy */ }
    return { ok: true };
  } catch (e) {
    return { ok: false, reason: 'network', message: `Could not reach the feedback address (${e?.name === 'TimeoutError' ? 'timed out' : e?.message ?? 'network error'}). Check your internet connection.` };
  }
}

/** When nothing can be sent, the report is kept in a file so it is not lost. */
export function saveUnsent(r) {
  const file = path.join(DATA, 'feedback-unsent.txt');
  fs.mkdirSync(DATA, { recursive: true });
  fs.appendFileSync(file, `\n=== ${new Date().toISOString()} ===\n${previewText(r)}\n`);
  return file;
}
