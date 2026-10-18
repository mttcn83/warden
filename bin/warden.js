#!/usr/bin/env node
// warden: command line for the Warden Discord bot. No dependencies. Works as `warden start` or `warden --start`.
// Keep this, bin/wizard.js, bin/presets.js and the README in step with every new feature (see CONTRIBUTING.md).
import { VERSION, readEnvValue, tailLines, LOG } from './env.js';
import { banner, red } from './ui.js';
import { startBot, stopBot, status, logs, openCommand, install, uninstall, runForeground, running } from './core.js';
import { printHelp } from './help.js';
import { feedbackCommand } from './feedback-cli.js';
import { profileCommand, logChannelCommand, activityCommand, setupWizard, passwordCommand, tokenCommand, inviteCommand, doctorCommand, autostartCommand } from './wizard.js';

async function help() {
  const s = running();
  const online = !!s && tailLines(LOG, 200).some(l => l.includes('warden online as'));
  await printHelp({ version: VERSION, state: s ? { running: true, port: s.port, online } : { running: false }, first: !readEnvValue('DISCORD_TOKEN') });
}

const argv = process.argv.slice(2);
const flag = n => argv.includes(n);
const portArg = (() => { const i = argv.indexOf('--port'); return i >= 0 ? Number(argv[i + 1]) : 0; })();
if (portArg && !(Number.isInteger(portArg) && portArg > 0 && portArg < 65536)) { console.log(`\n  ${red('✖')} --port needs a number between 1 and 65535\n`); process.exit(1); }
const opts = { port: portArg, open: !flag('--no-open') };
const valueOf = n => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : undefined; };
const feedbackOptions = () => ({
  message: argv.filter((a, i) => !a.startsWith('-') && !['--contact'].includes(argv[i - 1] ?? '')).join(' ').trim() || undefined,
  kind: flag('--idea') ? 'idea' : flag('--other') ? 'other' : flag('--bug') ? 'bug' : undefined,
  contact: valueOf('--contact'), diagnostics: flag('--diagnostics') || flag('-d'),
});
const follow = flag('-f') || flag('--follow');

const commands = {
  setup: () => setupWizard(), s: () => setupWizard(),
  start: async () => { await banner(VERSION, undefined, { animate: true }); await startBot(opts); },
  stop: () => stopBot(), restart: async () => { await stopBot(true); await banner(VERSION, undefined, { animate: true }); await startBot(opts); },
  status: async () => status(), open: () => openCommand(), logs: async () => logs(follow), log: async () => logs(follow),
  token: () => tokenCommand(),
  password: () => passwordCommand({ random: flag('--random'), remove: flag('--remove') }), passwd: () => passwordCommand({ random: flag('--random'), remove: flag('--remove') }), 'reset-password': () => passwordCommand({ random: flag('--random'), remove: flag('--remove') }),
  invite: () => inviteCommand({ minimal: flag('--minimal'), open: opts.open }),
  doctor: () => doctorCommand(),
  profile: () => profileCommand(), look: () => profileCommand(),
  activity: () => activityCommand({ kind: valueOf('--kind') ?? '', limit: Number(valueOf('--limit')) || 20 }), recent: () => activityCommand({ kind: valueOf('--kind') ?? '', limit: Number(valueOf('--limit')) || 20 }),
  logchannel: () => logChannelCommand(), 'log-channel': () => logChannelCommand(), modlog: () => logChannelCommand(),
  feedback: () => feedbackCommand(feedbackOptions()), bug: () => feedbackCommand(feedbackOptions()),
  autostart: () => autostartCommand({ remove: flag('--remove') }), 'no-autostart': () => autostartCommand({ remove: true }),
  run: () => runForeground(),
  install: async () => install(), uninstall: async () => uninstall(),
  version: async () => console.log(VERSION), v: async () => console.log(VERSION),
  help: async () => help(), h: async () => help(),
};
// short single-dash versions: warden -c is warden --doctor
const SHORT = { c: 'doctor', u: 'start', x: 'stop', r: 'restart', t: 'status', o: 'open', l: 'logs', k: 'token', p: 'password', m: 'profile', g: 'logchannel', e: 'activity', i: 'invite', a: 'autostart', b: 'feedback' };
for (const [letter, long] of Object.entries(SHORT)) commands[letter] = commands[long];
const name = argv.map(a => a.replace(/^-+/, '')).find(a => commands[a]) ?? (argv.length ? argv[0].replace(/^-+/, '') : 'help');
await (commands[name] ?? (async () => { console.log(`\n  ${red('✖')} Unknown command "${name}".`); help(); process.exitCode = 1; }))();
