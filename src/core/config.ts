import { z } from 'zod';

/** A custom pattern must compile, and must not be the kind (nested repeats like "(a+)+") that can make matching take forever. */
export function isSafeRegex(source: string): boolean {
  try { new RegExp(source, 'i'); } catch { return false; }
  return !/\((?:[^()\\]|\\.)*[+*](?:[^()\\]|\\.)*\)[+*{]/.test(source);
}

export const ActionSchema = z.enum(['delete', 'warn', 'timeout', 'kick', 'ban']);
export type Action = z.infer<typeof ActionSchema>;

const Exempt = z.object({ roles: z.array(z.string()).default([]), channels: z.array(z.string()).default([]) }).prefault({});

// Every module is opt-in: `enabled` defaults to false.
/** What to do with a category of message: allow it, only record it, or delete it. */
export const ModeSchema = z.enum(['off', 'log', 'delete']);
export const FilterConfig = z.object({
  enabled: z.boolean().default(false),
  shadow: z.boolean().default(false), // log what would happen, delete/punish nothing; also samples some normal messages for review
  // What the filter does per kind of message. Defaults: swearing in general is allowed, anything aimed at a person or dangerous is not.
  categories: z.object({
    personalInfo: ModeSchema.default('delete'), // phone numbers, emails, IP addresses, street addresses, card and social security numbers
    doxxing: ModeSchema.default('delete'), // "I know where you live", "dox him"
    threats: ModeSchema.default('delete'), // threats and telling people to hurt themselves
    scams: ModeSchema.default('delete'), // fake nitro/gift/crypto giveaways and lookalike login links
    slurs: ModeSchema.default('delete'),
    insults: ModeSchema.default('delete'), // insults aimed at a person (idiot, moron, worthless)
    rudeness: ModeSchema.default('log'), // mild put-downs aimed at a person (try-hard, nobody asked, useless, cringe)
    directedProfanity: ModeSchema.default('delete'), // swearing aimed at a person ("fuck you")
    profanity: ModeSchema.default('off'), // swearing in general ("this is fucking great")
    sexual: ModeSchema.default('off'),
    invites: ModeSchema.default('off'), // links to other Discord servers
    custom: ModeSchema.default('delete'), // your own words and patterns
    learned: ModeSchema.default('log'), // words the filter picked up on its own (see learning below)
  }).prefault({}),
  // Exceptions: in these channels / for members with these roles, these kinds of message are handled differently (the last matching one wins).
  // Findings the rules excused because of the context (a quote, role-play, "just kidding", banter that reads like a threat): off, record them for review, or also tell the mods.
  unsure: z.enum(['off', 'log', 'notify']).default('notify'),
  swearLevel: z.enum(['all', 'medium', 'strong']).default('all'), // which swear words count when general swearing is Log or Delete
  exceptions: z.array(z.object({
    channels: z.array(z.string()).default([]), // empty = every channel
    roles: z.array(z.string()).default([]), // empty = everyone
    categories: z.array(z.enum(['personalInfo', 'doxxing', 'threats', 'scams', 'slurs', 'insults', 'rudeness', 'directedProfanity', 'profanity', 'sexual', 'invites', 'custom', 'learned'])).default([]),
    mode: ModeSchema.default('off'),
  })).max(50).default([]),
  // Adaptive learning: the filter notices words that keep showing up in abusive messages and flags them too. Stores word counts only, never messages.
  learning: z.object({ enabled: z.boolean().default(false) }).prefault({}),
  customWords: z.array(z.string()).default([]),
  customRegex: z.array(z.string()).default([]).transform(list => list.filter(r => r.length <= 200 && isSafeRegex(r)).slice(0, 200)), // unsafe patterns saved by an older version are dropped, never fatal
  allowWords: z.array(z.string()).default([]), // words that are never flagged
  // Repeat offenders: every deletion is a strike (serious ones count more); enough strikes in the window means a timeout.
  escalation: z.object({
    enabled: z.boolean().default(true),
    windowHours: z.number().int().min(1).max(168).default(24),
    timeoutAfter: z.number().int().min(1).max(100).default(4),
    timeoutMinutes: z.number().int().min(1).max(40320).default(10),
    longTimeoutAfter: z.number().int().min(1).max(200).default(8),
    longTimeoutHours: z.number().int().min(1).max(672).default(6),
  }).prefault({}),
  exempt: Exempt,
}).prefault({});

export const SpamConfig = z.object({
  enabled: z.boolean().default(false),
  maxMessages: z.number().int().min(2).default(6),
  windowSeconds: z.number().int().min(1).default(5),
  maxDuplicates: z.number().int().min(2).default(3),
  maxMentions: z.number().int().min(1).default(5),
  maxCapsPercent: z.number().int().min(0).max(100).default(70), // shouting: this share of capital letters in a message of 15+ letters; 0 = off
  maxEmojis: z.number().int().min(0).max(200).default(15), // emoji walls; 0 = off
  blockZalgo: z.boolean().default(true), // glitchy stacked-accent text
  newMemberMinutes: z.number().int().min(0).max(1440).default(10), // members who joined this recently get half the message and duplicate limits; 0 = off
  deleteAll: z.boolean().default(true), // when someone is caught, also delete everything else they just sent
  action: ActionSchema.default('timeout'),
  timeoutSeconds: z.number().int().min(1).max(2_419_200).default(600),
  exempt: Exempt,
}).prefault({});

// Raid protection: detects a burst of joins, acts on the joiners, pauses invites. Dry run (shadow) by default.
export const RaidConfig = z.object({
  enabled: z.boolean().default(false),
  shadow: z.boolean().default(true), // only record what it would do
  joinsPerWindow: z.number().int().min(2).default(8),
  windowSeconds: z.number().int().min(1).default(10),
  minAccountAgeDays: z.number().int().min(0).default(30), // during a raid, accounts at least this old (and with a profile picture) are let through; 0 = nobody is let through
  dripJoins: z.number().int().min(0).max(100).default(8), // slow raids: this many suspicious accounts within dripWindowMinutes starts a raid; 0 = off
  dripWindowMinutes: z.number().int().min(5).max(720).default(30),
  action: z.enum(['timeout', 'kick', 'ban']).default('timeout'),
  timeoutSeconds: z.number().int().min(1).max(2_419_200).default(3600),
  lockdown: z.boolean().default(true), // pause server invites while the raid lasts
  lockdownMinutes: z.number().int().min(1).max(1440).default(10),
  quietSeconds: z.number().int().min(10).max(3600).default(60), // the raid counts as over after this long with no new raid joins
  purgeMessages: z.boolean().default(true), // delete what raiders already sent before the raid was detected
  blockMessagesMinutes: z.number().int().min(1).max(1440).default(30), // keep deleting every message from raid accounts for this long
}).prefault({});

// Admin guard: runs after Raid protection has stopped a raid. Dry run (shadow) by default.
export const GuardConfig = z.object({
  enabled: z.boolean().default(false),
  shadow: z.boolean().default(true),
  stripRaidRoles: z.boolean().default(true), // remove every role from the raid accounts and bots
  stripLetterIn: z.boolean().default(true), // remove dangerous-permission roles from whoever let the raiders in
  trustedAdmins: z.array(z.string()).default([]), // user IDs the guard never touches
  lookbackMinutes: z.number().int().min(5).max(1440).default(60), // how far back to search the audit log
  early: z.boolean().default(true), // strip the person who let them in as soon as it is clear, without waiting for the raid to end
}).prefault({});

export const GuildConfig = z.object({
  modLogChannel: z.string().nullable().default(null),
  // Testing aid: also apply rules to owner/admins (their messages are deleted, never punished further).
  testMode: z.boolean().default(false),
  testModeUntil: z.number().nullable().default(null), // epoch ms; test mode auto-expires

  filter: FilterConfig,
  spam: SpamConfig,
  raid: RaidConfig,
  guard: GuardConfig,
});
export type GuildConfig = z.infer<typeof GuildConfig>;
export const defaultGuildConfig = (): GuildConfig => GuildConfig.parse({});

export const TEST_MODE_MINUTES = 30;
/** Test mode only counts while its auto-off timer has not expired. */
export const testModeActive = (cfg: GuildConfig, now = Date.now()): boolean =>
  cfg.testMode && cfg.testModeUntil !== null && cfg.testModeUntil > now;

export type RaidSettings = z.infer<typeof RaidConfig>;
export type GuardSettings = z.infer<typeof GuardConfig>;
