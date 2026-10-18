// Checks for profile changes, kept separate from Discord so they are easy to test.

export const MAX_IMAGE_BYTES = 8 * 1024 * 1024; // Discord's own limit for avatars and banners
export const LIMITS = { username: [2, 32], description: 400, nickname: 32, bio: 190 } as const;

/** A `data:image/...;base64,...` string from the browser's file picker. Returns an error message, or null when it is fine. */
export function checkImage(value: unknown, label: string): string | null {
  if (typeof value !== 'string') return `${label} must be an image file.`;
  const m = /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/=]+)$/.exec(value);
  if (!m) return `${label} must be a PNG, JPG, GIF or WebP image.`;
  const bytes = Math.floor((m[2]!.length * 3) / 4);
  if (bytes > MAX_IMAGE_BYTES) return `${label} is too big (${(bytes / 1048576).toFixed(1)} MB). The limit is 8 MB.`;
  return null;
}

export interface GlobalProfileInput { username?: unknown; description?: unknown; avatar?: unknown; banner?: unknown }
export interface MemberProfileInput { nickname?: unknown; avatar?: unknown; banner?: unknown; bio?: unknown }

/** Returns an error message per bad field. Fields left out are simply not changed; `null` for an image means "remove it". */
export function validateGlobal(b: GlobalProfileInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (b.username !== undefined) {
    const u = typeof b.username === 'string' ? b.username.trim() : '';
    if (u.length < LIMITS.username[0] || u.length > LIMITS.username[1]) errors.username = `The username must be ${LIMITS.username[0]} to ${LIMITS.username[1]} characters.`;
  }
  if (b.description !== undefined && (typeof b.description !== 'string' || b.description.length > LIMITS.description)) errors.description = `The description can be up to ${LIMITS.description} characters.`;
  for (const k of ['avatar', 'banner'] as const) if (b[k] !== undefined && b[k] !== null) { const e = checkImage(b[k], k === 'avatar' ? 'The avatar' : 'The banner'); if (e) errors[k] = e; }
  return errors;
}
export function validateMember(b: MemberProfileInput): Record<string, string> {
  const errors: Record<string, string> = {};
  if (b.nickname !== undefined && b.nickname !== null && (typeof b.nickname !== 'string' || b.nickname.length > LIMITS.nickname)) errors.nickname = `A nickname can be up to ${LIMITS.nickname} characters.`;
  if (b.bio !== undefined && b.bio !== null && (typeof b.bio !== 'string' || b.bio.length > LIMITS.bio)) errors.bio = `The server bio can be up to ${LIMITS.bio} characters.`;
  for (const k of ['avatar', 'banner'] as const) if (b[k] !== undefined && b[k] !== null) { const e = checkImage(b[k], k === 'avatar' ? 'The server avatar' : 'The server banner'); if (e) errors[k] = e; }
  return errors;
}

export type ErrorKind = 'taken' | 'blocked' | 'rate' | 'permission' | 'other';
/** What went wrong, as a short code that code (not people) can act on. */
export function discordErrorKind(e: unknown): ErrorKind {
  const err = e as { message?: string; code?: number; status?: number };
  const msg = err?.message ?? String(e);
  if (/too many users have this username|USERNAME_TOO_MANY_USERS|already taken/i.test(msg)) return 'taken';
  if (/username.*(not allowed|banned|invalid|reserved)|USERNAME_(INVALID|NOT_ALLOWED)|contain.*(discord|everyone|here)/i.test(msg)) return 'blocked';
  if (err?.status === 429 || /rate.?limit|too fast|USERNAME_RATE_LIMIT/i.test(msg)) return 'rate';
  if (err?.code === 50013 || err?.status === 403) return 'permission';
  return 'other';
}

/** Turn a Discord error into something a person can act on. */
export function friendlyDiscordError(e: unknown): string {
  const err = e as { message?: string; code?: number; status?: number; retryAfter?: number };
  const msg = err?.message ?? String(e);
  if (err?.status === 429 || /rate.?limit|too fast|You are changing your username too fast/i.test(msg)) return 'Discord only allows this a couple of times per hour. Wait a bit and try again.';
  if (/too many users have this username|USERNAME_TOO_MANY_USERS/i.test(msg)) return 'Discord says too many bots or people already use that name. Try something more unusual, for example add a word or a number to it.';
  if (/username.*(not allowed|banned|invalid|reserved)|USERNAME_(INVALID|NOT_ALLOWED)|contain.*(discord|everyone|here)/i.test(msg)) return 'Discord does not allow that name (names containing words like "discord", "everyone" or "here" are blocked). Try a different one.';
  if (/USERNAME_RATE_LIMIT|changing your username too fast/i.test(msg)) return 'Discord only lets a username change about twice an hour. Wait a bit and try again.';
  if (err?.code === 50013 || err?.status === 403) return 'The bot is missing permission for this in that server.';
  if (err?.code === 50035) return `Discord did not accept that value: ${msg.replace(/^Invalid Form Body\s*/i, '')}`;
  return msg;
}
