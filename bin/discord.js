// Talking to Discord's API (only to check the token and build the invite link). No dependencies.
const API = 'https://discord.com/api/v10';

export async function discord(pathname, token) {
  try {
    const res = await fetch(API + pathname, { headers: { Authorization: `Bot ${token}` }, signal: AbortSignal.timeout(10_000) });
    const json = await res.json().catch(() => null);
    return { ok: res.ok, status: res.status, json };
  } catch (e) { return { ok: false, status: 0, json: null, error: e.message }; }
}

/** A bot token starts with the base64 of the bot's ID. */
/** People paste tokens with quotes, spaces, a "Bot " prefix or a whole DISCORD_TOKEN=... line. Take all of that off. */
export const cleanToken = t => String(t ?? '').trim().replace(/^DISCORD_TOKEN\s*=\s*/i, '').replace(/^Bot\s+/i, '').replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
export const looksLikeToken = t => /^[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{4,10}\.[A-Za-z0-9_-]{20,}$/.test(t);
export const clientIdFromToken = t => { try { return Buffer.from(t.split('.')[0], 'base64').toString('utf8'); } catch { return ''; } };

// Permission bits
const P = { kick: 1n << 1n, ban: 1n << 2n, administrator: 1n << 3n, manageGuild: 1n << 5n, viewAuditLog: 1n << 7n, viewChannel: 1n << 10n, sendMessages: 1n << 11n, manageMessages: 1n << 13n, readHistory: 1n << 16n, manageRoles: 1n << 28n, moderateMembers: 1n << 40n };
export const RECOMMENDED = [P.kick, P.ban, P.manageGuild, P.viewAuditLog, P.viewChannel, P.sendMessages, P.manageMessages, P.readHistory, P.manageRoles, P.moderateMembers];
export const RECOMMENDED_NAMES = ['View Channels', 'Send Messages', 'Read Message History', 'Manage Messages', 'Moderate Members (timeouts)', 'Kick Members', 'Ban Members', 'Manage Roles', 'Manage Server (pauses invites in a raid)', 'View Audit Log'];

export function inviteUrl(clientId, admin = false) {
  const perms = admin ? P.administrator : RECOMMENDED.reduce((a, b) => a | b, 0n);
  return `https://discord.com/oauth2/authorize?client_id=${clientId}&scope=bot%20applications.commands&permissions=${perms}`;
}

/** The two privileged intents the bot needs, read from the application's flags. */
export function intentsFromFlags(flags) {
  const f = Number(flags ?? 0);
  return { members: !!(f & ((1 << 14) | (1 << 15))), messageContent: !!(f & ((1 << 18) | (1 << 19))) };
}
