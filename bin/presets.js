// What the setup wizard can switch on. Every module must have an explicit decision here:
// a test fails when a new module is added to the bot without one (see src/core/presets.test.ts).
export const PRESETS = [
  {
    id: 'careful', label: 'Careful',
    desc: 'Warden watches and tells you what it would have done, but does not delete or punish anyone yet. Turn things on in the panel when you trust it.',
    config: { filter: { enabled: true, shadow: true, learning: { enabled: true } }, spam: { enabled: false }, raid: { enabled: true, shadow: true }, guard: { enabled: true, shadow: true } },
  },
  {
    id: 'active', label: 'Hands-on',
    desc: 'The word filter and spam protection start working right away. Raid protection and Admin guard only watch for now.',
    config: { filter: { enabled: true, shadow: false, learning: { enabled: true } }, spam: { enabled: true }, raid: { enabled: true, shadow: true }, guard: { enabled: true, shadow: true } },
  },
  {
    id: 'manual', label: 'I will set it up myself',
    desc: 'Everything stays off until you switch it on in the control panel.',
    config: { filter: { enabled: false, learning: { enabled: false } }, spam: { enabled: false }, raid: { enabled: false }, guard: { enabled: false } },
  },
];

/** How strict the word filter is. Each level is a set of per-rule actions, so every rule can still be changed one by one afterwards. */
export const STRICTNESS = [
  {
    id: 'relaxed', label: 'Relaxed',
    desc: 'Only serious things are deleted. Insults are just recorded and rudeness and swearing are allowed. Good for communities that roast each other.',
    categories: { personalInfo: 'delete', doxxing: 'delete', threats: 'delete', scams: 'delete', slurs: 'delete', insults: 'log', rudeness: 'off', directedProfanity: 'log', profanity: 'off', sexual: 'off', invites: 'off', learned: 'log' }, swearLevel: 'all',
    deletes: ['"i will find you and hurt you"', 'a fake giveaway link', 'someone\'s address or phone number', 'slurs'],
    logs: ['"you idiot"', '"fuck you"'],
    allows: ['"nobody asked"', '"most useless admin ever"', '"this is fucking great"'],
  },
  {
    id: 'standard', label: 'Standard',
    desc: 'Serious things and real insults are deleted. Mild put-downs are only recorded for the mods. Swearing that is not aimed at anyone is allowed.',
    categories: { personalInfo: 'delete', doxxing: 'delete', threats: 'delete', scams: 'delete', slurs: 'delete', insults: 'delete', rudeness: 'log', directedProfanity: 'delete', profanity: 'off', sexual: 'off', invites: 'off', learned: 'log' }, swearLevel: 'all',
    deletes: ['everything in Relaxed', '"you idiot"', '"fuck you"', '"go kill yourself"'],
    logs: ['"nobody asked"', '"try-hard"', '"most useless admin ever"'],
    allows: ['"this is fucking great"', '"damn, that was close"'],
  },
  {
    id: 'strict', label: 'Strict',
    desc: 'Everything is deleted, including mild put-downs and all swearing, even friendly swearing. Good for family-friendly servers.',
    categories: { personalInfo: 'delete', doxxing: 'delete', threats: 'delete', scams: 'delete', slurs: 'delete', insults: 'delete', rudeness: 'delete', directedProfanity: 'delete', profanity: 'delete', sexual: 'delete', invites: 'off', learned: 'log' }, swearLevel: 'all',
    deletes: ['everything in Standard', '"nobody asked"', '"try-hard"', '"this is fucking great"', '"damn"'],
    logs: [],
    allows: ['normal chat'],
  },
];

const isObject = v => v && typeof v === 'object' && !Array.isArray(v);
/** Copy `patch` into `target`, going into nested objects so only the named fields change. */
export function deepMerge(target, patch) {
  for (const [k, v] of Object.entries(patch)) {
    if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue; // never let a patch reach into Object.prototype
    target[k] = isObject(v) && isObject(target[k]) ? deepMerge(target[k], v) : v;
  }
  return target;
}
/** Merge a preset (or a set of wizard answers) into a server's saved settings: only the fields it names change. */
export function applyPresetTo(config, preset) {
  return deepMerge(JSON.parse(JSON.stringify(config)), JSON.parse(JSON.stringify(preset.config)));
}
