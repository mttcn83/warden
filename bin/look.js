// The default look of the bot: the shield "W" picture and the name Warden. Used by the setup wizard and `warden --profile`.
import fs from 'node:fs';
import path from 'node:path';
import { randomInt } from 'node:crypto';
import { ROOT } from './env.js';

export const LOOK = {
  nickname: 'Warden',
  description: 'Self-hosted moderation bot. Word filter, spam and raid protection, and an admin guard that strips the roles of raiders and of whoever let them in. Open source: you run it, you own it.',
  avatarFile: path.join(ROOT, 'assets', 'warden-avatar.png'),
  bannerFile: path.join(ROOT, 'assets', 'warden-banner.jpg'),
};

/** The picture as the data URI the panel API takes. */
export const avatarDataUri = (file = LOOK.avatarFile) => `data:image/${/\.jpe?g$/i.test(file) ? 'jpeg' : 'png'};base64,${fs.readFileSync(file).toString('base64')}`;
/** The wide banner, same format. */
export const bannerDataUri = (file = LOOK.bannerFile) => avatarDataUri(file);

/** Names to try for the bot's username, best first. Discord only allows about two username changes per hour, so there are two. */
export function nameLadder(random = () => randomInt(36 ** 4)) {
  return ['Warden', `Warden-${random().toString(36).padStart(4, '0')}`];
}

/**
 * Gives the bot the Warden look through the panel API. `api` is the signed-in helper from panelSession.
 * Returns what happened, in plain words. Never throws for a normal Discord rejection.
 *   options: { guilds: [{id,name}], avatar: true|false, names }
 */
export async function applyLook(api, { guilds = [], avatar = true, banner = true, description = true, names = nameLadder() } = {}) {
  const out = { avatar: null, banner: null, description: null, username: null, nicknames: [], notes: [] };
  // 1. picture, banner and description first: they never need a unique name
  if (avatar || banner || description) {
    try {
      const r = await api('/api/profile', 'PUT', { ...(avatar ? { avatar: avatarDataUri() } : {}), ...(banner ? { banner: bannerDataUri() } : {}), ...(description ? { description: LOOK.description } : {}) });
      if (avatar) out.avatar = !r.failed?.avatar;
      if (banner) out.banner = !r.failed?.banner;
      if (description) out.description = !r.failed?.description;
      const words = { avatar: 'picture', banner: 'banner', description: 'description' };
      for (const k of Object.keys(words)) if (r.failed?.[k]) out.notes.push(`The ${words[k]} was not accepted: ${r.failed[k]}`);
    } catch (e) { out.notes.push(`The picture, banner and description were not accepted: ${e.message}`); if (avatar) out.avatar = false; if (banner) out.banner = false; if (description) out.description = false; }
  }
  // 2. username: try the nice name, then one fallback, then stop (more tries would just burn Discord's hourly limit)
  for (const name of names.slice(0, 2)) {
    let r;
    try { r = await api('/api/profile', 'PUT', { username: name }); } catch (e) { out.notes.push(`The name "${name}" was not accepted: ${e.message}`); break; }
    if (!r.failed?.username) { out.username = name; break; }
    const why = r.reasons?.username;
    if (why === 'rate') { out.notes.push('Discord only lets a username change about twice an hour, so the name stays as it is for now. Run "warden --profile" again in an hour.'); break; }
    if (why === 'taken' || why === 'blocked') { out.notes.push(`Discord did not accept the name "${name}" (${why === 'taken' ? 'already used by too many' : 'not allowed'}).`); continue; }
    out.notes.push(`The name "${name}" was not accepted: ${r.failed.username}`); break;
  }
  // the Developer Portal name is separate and only changeable by hand: say so when it differs
  try {
    const p = await api(`/api/profile/${guilds[0]?.id ?? 0}`);
    if (p?.appName && out.username && p.appName !== out.username) out.notes.push(`The app is still called "${p.appName}" in the Developer Portal. Discord does not let bots rename it: change it by hand under General Information → Name.`);
  } catch { /* the note is optional */ }
  // 3. the nickname in every server is always "Warden", whatever the username ended up being
  for (const g of guilds) {
    try {
      const r = await api(`/api/profile/${g.id}/server`, 'PUT', { nickname: LOOK.nickname });
      out.nicknames.push({ name: g.name, ok: !r.failed?.server, why: r.failed?.server });
    } catch (e) { out.nicknames.push({ name: g.name, ok: false, why: e.message }); }
  }
  return out;
}
