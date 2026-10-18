// Every command, in one place. `warden --help` is built from this, and a test checks that the README documents each one.
// Every command has a long form (--doctor) and, for the common ones, a short one (-c). Both work, and `warden doctor` works too.
// `short` is the plain-language line shown in the help menu; `desc` is the full explanation.
export const HELP = [
  { group: 'Start here', usage: 'warden --setup  (-s)', short: 'guided setup, from bot token to first settings', desc: 'guided setup: bot, invite, password, first settings' },
  { group: 'Start here', usage: 'warden --start  (-u)', short: 'start Warden in the background and open the panel', desc: 'start in the background on a free port, open the panel' },
  { group: 'Start here', usage: '  --port <n>', short: 'use a specific port', desc: 'use a specific port', sub: true },
  { group: 'Start here', usage: '  --no-open', short: "don't open the browser", desc: "don't open the browser", sub: true },
  { group: 'Start here', usage: 'warden --open  (-o)', short: 'open the control panel (it signs you in)', desc: 'open the panel again (signs you in)' },
  { group: 'Start here', usage: 'warden --doctor  (-c)', short: 'check everything and say what to fix', desc: 'check everything and tell you what to fix' },

  { group: 'Keep it running', usage: 'warden --status  (-t)', short: 'is it running, and is Discord connected?', desc: 'is it running, where, and is Discord connected' },
  { group: 'Keep it running', usage: 'warden --stop  (-x)', short: 'stop it', desc: 'stop it' },
  { group: 'Keep it running', usage: 'warden --restart  (-r)', short: 'stop and start again', desc: 'stop and start again' },
  { group: 'Keep it running', usage: 'warden --autostart  (-a)', short: 'start by itself when the computer starts', desc: 'start Warden by itself when the computer starts' },
  { group: 'Keep it running', usage: '  --remove', short: 'stop it starting by itself', desc: 'stop it starting by itself', sub: true },
  { group: 'Keep it running', usage: 'warden --run', short: 'run in this terminal (what autostart uses)', desc: 'run in this terminal instead of the background (used by autostart)' },

  { group: 'See what it did', usage: 'warden --activity  (-e)', short: 'today in numbers, plus the newest log entries', desc: 'what Warden did lately: counts for the last 24 hours and the newest entries. --kind removed|watched|review|log|timeout, --limit 50' },
  { group: 'See what it did', usage: '  --kind <x>', short: 'removed, watched, review, log or timeout', desc: 'only one kind of entry', sub: true },
  { group: 'See what it did', usage: '  --limit <n>', short: 'show more entries', desc: 'show more entries', sub: true },
  { group: 'See what it did', usage: 'warden --logs  (-l)', short: 'read the bot log (add -f to follow it live)', desc: 'show the log (add -f to follow it live)' },
  { group: 'See what it did', usage: 'warden --logchannel  (-g)', short: 'make the private mod-log channel for moderators', desc: 'create the private mod-log channel (only moderators can see it) where Warden posts what it did and what needs a look' },

  { group: 'Your bot', usage: 'warden --invite  (-i)', short: 'get the link that adds the bot to a server', desc: 'get the link that adds the bot to a server' },
  { group: 'Your bot', usage: '  --minimal', short: 'ask for fewer permissions than Administrator', desc: 'ask only for the permissions Warden uses, instead of Administrator', sub: true },
  { group: 'Your bot', usage: 'warden --profile  (-m)', short: 'give the bot its look: picture, banner, name', desc: 'give the bot the Warden look: shield "W" picture, banner, description, name Warden, nickname Warden in every server' },
  { group: 'Your bot', usage: 'warden --token  (-k)', short: 'save a new Discord bot token (hidden)', desc: 'save a new Discord bot token (hidden input)' },
  { group: 'Your bot', usage: 'warden --password  (-p)', short: 'set a new panel password (hidden)', desc: 'set a new panel password (hidden input)' },
  { group: 'Your bot', usage: '  --random', short: 'make one up for you', desc: 'generate one for you', sub: true },
  { group: 'Your bot', usage: '  --remove', short: 'no password: sign in with warden --open', desc: 'no password: sign in with warden --open', sub: true },

  { group: 'Other', usage: 'warden --feedback  (-b)', short: 'send a bug or idea to the developer', desc: 'send a bug report or idea to the developer (you see it first)' },
  { group: 'Other', usage: '  "message" --bug|--idea', short: 'send at once; -d adds diagnostics', desc: 'send straight away without questions (add -d for diagnostics, --contact <how to reach you>)', sub: true },
  { group: 'Other', usage: 'warden --install', short: 'add "warden" to your PATH', desc: 'add "warden" to your PATH (~/.local/bin)' },
  { group: 'Other', usage: 'warden --uninstall', short: 'remove it from your PATH', desc: 'remove it from your PATH' },
  { group: 'Other', usage: 'warden --version  (-v)', short: 'print the version', desc: 'print the version' },
];

/** Splits a usage string into its parts: "warden --setup  (-s)" -> { long: '--setup', short: '-s' }. */
export function parseUsage(usage) {
  const short = /\((-[a-z])\)/.exec(usage)?.[1] ?? '';
  const long = usage.replace(/\s*\(-[a-z]\)\s*$/, '').replace(/^warden\s+/, '').trim();
  return { long, short };
}
