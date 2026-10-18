// The guided setup, plus the smaller account commands: token, password, invite and doctor. No dependencies.
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { ROOT, VERSION, readEnvValue, setEnv, removeEnv, tailLines, LOG } from './env.js';
import { banner, ok, fail, warn, info, step, ask, confirm, choose, pause, askHidden, spinner, interactive, dim, bold, green, red, cyan, yellow, printBox, showBox, celebrate } from './ui.js';
import { discord, cleanToken, looksLikeToken, clientIdFromToken, inviteUrl, intentsFromFlags, RECOMMENDED_NAMES } from './discord.js';
import { PRESETS, applyPresetTo } from './presets.js';
import { askFeatures } from './features.js';
import { applyLook } from './look.js';
import { offerModLog, pickModLog } from './modlog.js';
import { autostartKind, autostartEnabled, enableAutostart, disableAutostart, looksLikeLaptop } from './autostart.js';
import { running, startBot, stopBot, openBrowser, openPanel, dependenciesInstalled, install, installedOnPath, panelSession } from './core.js';

const NODE_MAJOR = Number(process.versions.node.split('.')[0]);
const link = url => cyan(url);

function needTerminal() {
  if (interactive) return false;
  console.log('\n  This needs an interactive terminal. Run it directly in your terminal window.\n');
  process.exitCode = 1; return true;
}
const plain = '23456789abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ';
export const generatePassword = (n = 16) => Array.from({ length: n }, () => plain[randomInt(plain.length)]).join('');

/** Ask for a password twice (hidden). Returns '' if the user gives up. */
async function askNewPassword() {
  for (let tries = 0; tries < 4; tries++) {
    const a = await askHidden('New password (at least 6 characters):');
    if (a.length < 6) { fail('That is too short. Use at least 6 characters.'); continue; }
    const b = await askHidden('Type it again:');
    if (a !== b) { fail('Those do not match. Try again.'); continue; }
    return a;
  }
  return '';
}
function showPassword(pw) {
  console.log('');
  printBox([`${yellow('Your new panel password')}`, '', bold(pw), '', dim('Save it somewhere safe. It is stored only in .env')], { title: 'password', tone: 'warn' });
}

// ---------- warden --token ----------
export async function tokenCommand() {
  if (needTerminal()) return;
  await banner(VERSION);
  console.log(`  Paste your bot token. You get it at ${link('discord.com/developers/applications')} → your app → Bot → Reset Token.`);
  console.log(dim('  Nothing shows while you paste, that is normal. It is saved on this computer only, in the .env file.\n'));
  const t = await readValidToken();
  if (!t) { process.exitCode = 1; return; }
  console.log(`\n  ${running() ? 'Run warden --restart to use it.' : 'Now run warden --start'}\n`);
}

/** Ask for a token until Discord accepts it. Saves it and returns { token, bot }. */
async function readValidToken() {
  for (let tries = 0; tries < 5; tries++) {
    const token = cleanToken(await askHidden('Paste the token here:'));
    if (!token) { fail('Nothing was pasted. Copy the token in the portal, then paste it here (it will not show).'); continue; }
    if (!looksLikeToken(token)) { fail('That does not look like a bot token. It is one long line with two dots in it. Make sure you copied the whole thing.'); continue; }
    const me = await discord('/users/@me', token);
    if (me.status === 0) { warn('Could not reach Discord to check it. Is your internet working?'); if (!(await confirm('Save it anyway and check later?', false))) continue; setEnv('DISCORD_TOKEN', token); return { token, bot: null }; }
    if (!me.ok) { fail('Discord says that token is not valid. In the portal, click Reset Token, copy the new one and paste it here.'); continue; }
    setEnv('DISCORD_TOKEN', token);
    ok(`Connected to your bot ${bold(me.json.username)}. The token is saved on this computer only.`);
    return { token, bot: me.json };
  }
  fail('No working token yet, so nothing was saved. Run this again whenever you are ready.');
  return null;
}

// ---------- warden --password ----------
export async function passwordCommand({ random = false, remove = false } = {}) {
  await banner(VERSION, 'reset the control panel password');
  if (remove) {
    const had = removeEnv('GUI_PASSWORD');
    ok(had ? 'Password removed.' : 'There was no password set.');
    info('The panel now signs you in only through "warden --open" (a one-time link).');
  } else if (random) {
    const pw = generatePassword(); setEnv('GUI_PASSWORD', pw); ok('New password set.'); showPassword(pw);
  } else {
    if (needTerminal()) return;
    console.log(dim('  Pick a new password for the control panel. Use --random to generate one, or --remove to use no password.\n'));
    const pw = await askNewPassword();
    if (!pw) { fail('Password not changed.'); process.exitCode = 1; return; }
    setEnv('GUI_PASSWORD', pw); ok('New password saved.');
  }
  if (running()) {
    if (interactive && await confirm('Warden is running. Restart now so the change takes effect?', true)) { await stopBot(true); await startBot({ open: false, quiet: true }); ok('Restarted. Everyone is signed out.'); }
    else console.log(`\n  ${dim('Run warden --restart when you are ready. The old password keeps working until then.')}`);
  }
  console.log('');
}

// ---------- warden --invite ----------
export async function inviteCommand({ minimal = false, open = true } = {}) {
  const admin = !minimal;
  const token = readEnvValue('DISCORD_TOKEN');
  if (!token) { fail('No bot token yet. Run warden --setup first.'); process.exitCode = 1; return; }
  const id = clientIdFromToken(token);
  if (!id) { fail('Could not read the bot ID from the token.'); process.exitCode = 1; return; }
  const url = inviteUrl(id, admin);
  await banner(VERSION, 'invite link');
  console.log(`  ${bold(admin ? 'Invite link (Administrator, recommended: Warden does many things, so nothing fails on a missing permission):' : 'Invite link (only the permissions Warden uses):')}\n\n  ${link(url)}\n`);
  if (!admin) info('It asks for: ' + RECOMMENDED_NAMES.join(', ') + '.');
  info('Put the bot’s role near the top of Server Settings → Roles so it can act on members below it.');
  console.log('');
  if (open) openBrowser(url);
}

// ---------- warden --doctor ----------
export async function doctorCommand() {
  await banner(VERSION, 'checking your setup', { animate: true });
  let problems = 0;
  const good = t => ok(t), bad = (t, hint) => { problems++; fail(t); if (hint) info(hint); }, meh = (t, hint) => { warn(t); if (hint) info(hint); };
  NODE_MAJOR >= 22 ? good(`Node ${process.versions.node}`) : bad(`Node ${process.versions.node} is too old`, 'Install Node 22 or newer from https://nodejs.org');
  dependenciesInstalled() ? good('Packages installed') : bad('Packages are not installed', 'Run: warden --setup (or npm install)');
  const token = readEnvValue('DISCORD_TOKEN');
  if (!token) bad('No bot token', 'Run: warden --setup');
  else if (!looksLikeToken(token)) bad('The saved token does not look right', 'Run: warden --token');
  else {
    const me = await discord('/users/@me', token);
    if (me.status === 0) meh('Could not reach Discord to check the token', 'Check your internet connection.');
    else if (!me.ok) bad('Discord rejected the saved token', 'Reset it in the Developer Portal, then run: warden --token');
    else {
      good(`Bot token works (${me.json.username})`);
      const app = await discord('/applications/@me', token);
      if (app.ok) {
        const i = intentsFromFlags(app.json.flags);
        i.messageContent ? good('Message Content intent is on') : bad('Message Content intent is OFF', 'Developer Portal → your app → Bot → turn on Message Content Intent.');
        i.members ? good('Server Members intent is on') : bad('Server Members intent is OFF', 'Developer Portal → your app → Bot → turn on Server Members Intent.');
      }
      const guilds = await discord('/users/@me/guilds', token);
      if (guilds.ok) guilds.json.length ? good(`In ${guilds.json.length} server${guilds.json.length === 1 ? '' : 's'}: ${guilds.json.slice(0, 4).map(g => g.name).join(', ')}${guilds.json.length > 4 ? '…' : ''}`) : bad('The bot is not in any server yet', 'Run: warden --invite');
    }
  }
  readEnvValue('GUI_PASSWORD') ? good('Panel password is set') : meh('No panel password', 'Fine: sign in with "warden --open". Set one with: warden --password');
  const s = running();
  s ? good(`Running on port ${s.port}`) : meh('Warden is not running', 'Start it with: warden --start');
  autostartEnabled() ? good('Starts automatically with the computer') : meh('Does not start by itself', 'If this computer restarts, Warden stops. Fix: warden --autostart');
  if (looksLikeLaptop()) meh('This looks like a laptop', 'Sleeping or closing the lid stops Warden. For 24/7 protection use an always-on machine.');
  installedOnPath() ? good('"warden" command is on your PATH') : meh('"warden" is not on your PATH', 'Run: npm run install-cli  (or: node bin/warden.js --install)');
  console.log('');
  await showBox([problems ? red(bold(`${problems} thing${problems === 1 ? '' : 's'} to fix`)) : green(bold('Everything looks good'))], { tone: problems ? 'fail' : 'ok' });
  console.log('');
  if (problems) process.exitCode = 1;
}

// ---------- warden --setup ----------
const MODES = [
  { id: 'quick', label: 'Quick', tag: '(about 2 minutes)', desc: 'Almost no explanations. You paste your bot token and choose how to sign in, I handle the rest. For people who have done this before.' },
  { id: 'guided', label: 'Guided', tag: '(for beginners, about 10 minutes)', desc: 'Never made a Discord bot? I explain every word, split the Discord steps into small parts, and wait for you after each one.' },
  { id: 'full', label: 'Full walkthrough', desc: 'Every feature explained and you choose each one: filter strictness, spam, raid protection, mod-log. For people who want control.' },
  { id: 'skip', label: 'Skip to start', desc: 'Already set up? Just start Warden.' },
];
const STEP_IDS = {
  quick: ['ready', 'connect', 'invite', 'signin', 'always', 'start'],
  guided: ['ready', 'make', 'connect', 'invite', 'signin', 'features', 'always', 'start'],
  full: ['ready', 'make', 'connect', 'invite', 'signin', 'features', 'always', 'start'],
  skip: ['start'],
};
const STEP_TITLES = { ready: 'Get ready', make: 'Make your bot on Discord', connect: 'Connect the bot', invite: 'Add the bot to your server', signin: 'Choose how to sign in', features: 'Choose what Warden does', always: 'Keep it running', start: 'Turn it on' };

function makeBotHelp() {
  console.log(`
  Your bot is its own little Discord account that you control. You make it on Discord's website:

   ${cyan('1')}  Open ${link('https://discord.com/developers/applications')} and click ${bold('New Application')} (top right).
   ${cyan('2')}  Type a name (Warden works), tick the box that says you agree to Discord's Developer Terms, then click ${bold('Create')}.
        ${dim('You land on "General Information". Skip the icon, description and tags: Warden fills those in for you later.')}
   ${cyan('3')}  Click ${bold('Bot')} in the left menu.
   ${cyan('4')}  Near the top, click ${bold('Reset Token')}, then ${bold('Yes, do it')}, then ${bold('Copy')}.
        ${dim('Discord shows the token only once, and may ask for your password or 2FA code first. Keep it copied for the next step.')}
   ${cyan('5')}  Scroll down to ${bold('Privileged Gateway Intents')}. Switch ${bold('ON')} the two switches called
        ${bold('Server Members Intent')} and ${bold('Message Content Intent')}, then press ${bold('Save Changes')}.
        ${dim('(Without these, the bot cannot read messages or see who joins.)')}
   ${cyan('6')}  ${bold('Make it a private bot')} ${dim('(only you can add it to servers)')}
        Discord will not let you save a private bot while it has a default install link, so do this in order:
        ${dim('a)')} Click ${bold('Installation')} in the left menu, and set ${bold('Install Link')} to ${bold('None')}.
        ${dim('b)')} Go back to ${bold('Bot')} and turn ${bold('Public Bot')} ${bold('OFF')} (a little above the intents switches), then save.
        ${dim('The invite link Warden makes for you keeps working. Anyone else who tries to add the bot is told it is private.')}
        ${dim('Skip this step if you want other people to be able to add your bot.')}
`);
}

/** Warnings everyone should read once. */
function alwaysOnWarnings() {
  const lines = [
    `${yellow(bold('Warden only protects your server while it is running.'))}`,
    '',
    `${bold('•')} If you turn off, sleep or restart this computer, protection stops.`,
    `${bold('•')} For real protection, run it on something that is always on:`,
    `    a spare PC, a Raspberry Pi, a home server, or a cheap VPS (about $5/month).`,
    ...(looksLikeLaptop() ? [`${bold('•')} This looks like a ${bold('laptop')}. Closing the lid usually puts it to sleep and stops the bot.`] : []),
    `${bold('•')} Your bot token is like a password. Never paste it in Discord or share a screenshot of it.`,
    `    If it ever leaks, click Reset Token in the Developer Portal and run: warden --token`,
    `${bold('•')} The control panel only opens on this computer. Do not expose it to the internet.`,
    `${bold('•')} In Server Settings → Roles, drag the bot’s role near the top. It can only act on people below it.`,
  ];
  printBox(lines, { title: 'please read', tone: 'warn' });
}


// ---------- beginner mode ("Guided") ----------
async function beginnerIntro() {
  console.log('');
  printBox([
    `${bold('Before we start, you will need:')}`,
    '',
    `${green('✔')} a ${bold('Discord account')} (you have one if you use Discord)`,
    `${green('✔')} a ${bold('server')} where you can add bots. No server yet? In Discord click the ${bold('+')} on the left,`,
    `    choose ${bold('Create My Own')}, then ${bold('For me and my friends')}. It is free and takes 30 seconds.`,
    `${green('✔')} about ${bold('10 minutes')}, a web browser, and this window open next to it`,
    '',
    `${bold('Three words you will see:')}`,
    `${cyan('bot')}     a Discord account that is run by a program instead of a person. Warden is the program.`,
    `${cyan('token')}   a very long secret password that lets the program log in as your bot. Keep it private.`,
    `${cyan('server')}  what Discord calls a community (the thing with channels).`,
  ], { title: 'for beginners', tone: 'brand' });
  console.log(dim('\n  I will go slowly and wait for you after every part. Nothing is changed on Discord unless you do it yourself.'));
  await pause('Press Enter when you are ready');
}

/** The Discord steps for beginners: small parts, each one waits for you. */
async function makeBotPages() {
  console.log(`\n  Your bot is its own little Discord account that you control. You make it on Discord's website, in four short parts.\n`);
  console.log(`  ${bold('Part 1 of 4: create the app')}\n`);
  console.log(`   ${cyan('1')}  Open ${link('https://discord.com/developers/applications')} and log in if it asks.`);
  console.log(`   ${cyan('2')}  Click the blue ${bold('New Application')} button (top right).`);
  console.log(`   ${cyan('3')}  Type a name (${bold('Warden')} works), tick the box that says you agree to Discord's Developer Terms, then click ${bold('Create')}.`);
  console.log(dim('        You land on a page called "General Information". Ignore the icon, description and tags there: Warden fills those in for you later.\n'));
  if (await confirm('Open that page in your browser for you?', true)) openBrowser('https://discord.com/developers/applications');
  await pause('Press Enter when you see the page called "General Information"');

  console.log(`\n  ${bold('Part 2 of 4: copy the token')}\n`);
  console.log(`   ${cyan('1')}  In the menu on the left, click ${bold('Bot')}.`);
  console.log(`   ${cyan('2')}  Near the top, click ${bold('Reset Token')}, then ${bold('Yes, do it')}. Discord may ask for your password or a 2FA code.`);
  console.log(`   ${cyan('3')}  Click ${bold('Copy')}. ${dim('Discord shows the token only once, so do not click away before you copy it. Keep it in your clipboard for the next step.')}\n`);
  await pause('Press Enter when you have copied the token');

  console.log(`\n  ${bold('Part 3 of 4: switch on two permissions')}\n`);
  console.log(`   ${cyan('1')}  Still on the ${bold('Bot')} page, scroll down to ${bold('Privileged Gateway Intents')}.`);
  console.log(`   ${cyan('2')}  Switch ${bold('ON')} ${bold('Server Members Intent')} and ${bold('Message Content Intent')}. ${dim('(Without these the bot cannot read messages or see who joins.)')}`);
  console.log(`   ${cyan('3')}  Press the green ${bold('Save Changes')} bar that appears at the bottom.\n`);
  await pause('Press Enter when you have saved');

  console.log(`\n  ${bold('Part 4 of 4: make it private')} ${dim('(optional)')}\n`);
  console.log('  A private bot can only be added to servers by you. Anyone else who tries is told it is private.');
  if (await confirm('Do you want a private bot?', true)) {
    console.log(`\n   ${cyan('1')}  Click ${bold('Installation')} in the left menu and set ${bold('Install Link')} to ${bold('None')}. ${dim('(Discord will not let you save a private bot without this.)')}`);
    console.log(`   ${cyan('2')}  Go back to ${bold('Bot')}, turn ${bold('Public Bot')} ${bold('OFF')} (a little above the intents switches), then save.`);
    console.log(dim('        The invite link Warden makes for you keeps working.\n'));
    await pause('Press Enter when you are done');
  }
}

/** What to do after the setup, for beginners. */
function beginnerTour(port) {
  console.log('');
  printBox([
    `${bold('What to do now')}`,
    '',
    `${cyan('1')}  Open the control panel ${dim('(warden --open, or say yes to the question below)')}. The ${bold('Overview')} page shows each protection as ON or OFF.`,
    `${cyan('2')}  Open ${bold('Test it')}, type a message like "you are an idiot" and press the button.`,
    `    It shows what Warden would do. Nothing happens in Discord, so it is safe to play with.`,
    `${cyan('3')}  Type something rude in your server (use a test channel). Open ${bold('Detections')} in the panel to see what Warden noticed.`,
    `${cyan('4')}  If you started in watch-only mode, nothing is deleted yet. When you like what you see,`,
    `    open ${bold('Word filter')} and turn ${bold('Shadow mode')} off. Now it really deletes.`,
    `${cyan('5')}  Your private mod-log channel (made for you, if you said yes) is where Warden tells moderators what it did and what ${bold('needs a look')}. Keep it moderators-only. Open ${bold('Logs')} in the panel (or run ${bold('warden --activity')}) to see everything Warden did. Something odd? Run ${bold('warden --doctor')}.`,
  ], { title: 'your first 10 minutes', tone: 'ok' });
}

export async function setupWizard() {
  if (needTerminal()) return;
  await banner(VERSION, 'setup', { animate: true });
  console.log(`  Hi! Let’s get Warden running. You will need a Discord account, a server you manage (or a new test server),\n  and a web browser. ${dim('Nothing happens on Discord until you say so, and you can press Ctrl+C any time.')}`);
  let mode = MODES[await choose('How do you want to set up?', MODES, 1)].id;
  let n = 0;
  const beginner = () => mode === 'guided';
  if (beginner()) await beginnerIntro();
  const go = id => { if (STEP_IDS[mode].includes(id)) step(++n, STEP_IDS[mode].length, STEP_TITLES[id]); };
  const has = id => STEP_IDS[mode].includes(id);

  // ready ---------------------------------------------------------------
  go('ready');
  if (beginner()) console.log(dim('  I am checking that your computer can run Warden, and downloading anything it is missing.'));
  if (NODE_MAJOR < 22) { fail(`Your Node.js (${process.versions.node}) is too old. Install the latest one from https://nodejs.org and run this again.`); process.exitCode = 1; return; }
  ok(`Node ${process.versions.node}`);
  if (dependenciesInstalled()) ok('Everything Warden needs is installed');
  else {
    warn('Warden still needs to download a few things it is built from.');
    if (!(await confirm('Download them now? (takes about a minute)', true))) { fail('Warden cannot run without them. Run "npm install" when you are ready.'); process.exitCode = 1; return; }
    const code = await new Promise(res => spawn('npm', ['install'], { cwd: ROOT, stdio: 'inherit' }).on('exit', res).on('error', () => res(1)));
    if (code !== 0) { fail('The download failed. Read the error above, fix it (often a network issue) and run the setup again.'); process.exitCode = 1; return; }
    ok('Downloaded');
  }

  // a saved token that still works, if there is one
  let token = readEnvValue('DISCORD_TOKEN'), bot = null;
  if (token && looksLikeToken(token)) {
    const me = await discord('/users/@me', token);
    if (me.ok) { bot = me.json; ok(`You already have a bot set up: ${bold(bot.username)}.`); if (mode !== 'skip' && !(await confirm('Keep using it?', true))) { token = ''; bot = null; } }
    else if (me.status !== 0) { warn('The saved token stopped working (it was probably reset). Let’s paste a new one.'); token = ''; }
  } else token = '';
  if (mode === 'skip' && !token) { warn('There is no bot connected yet, so I will do the quick setup instead.'); mode = 'quick'; n = 0; }

  // make + connect --------------------------------------------------------
  go('make');
  if (token && has('make')) ok('Nothing to do here: your bot already exists.');
  if (!token) {
    if (beginner()) await makeBotPages();
    else {
      makeBotHelp();
      if (await confirm('Open that page in your browser for you?', true)) openBrowser('https://discord.com/developers/applications');
      if (has('make')) await pause('Press Enter when you have copied the token');
    }
    go('connect');
    if (beginner()) console.log(dim('  The token is the long secret password you just copied. Warden uses it to log in as your bot.'));
    console.log(dim('  Paste the token below. Nothing will show while you paste, that is normal. Anyone with this token controls your bot, so it stays on this computer.\n'));
    const got = await readValidToken();
    if (!got) { process.exitCode = 1; return; }
    token = got.token; bot = got.bot;
  } else { go('connect'); ok('Your bot is already connected.'); }

  // the two switches: poll instead of asking
  if (mode !== 'skip') {
    let tries = 0;
    for (;;) {
      const app = await discord('/applications/@me', token);
      if (!app.ok) { warn('Could not check the two switches right now. You can check later with "warden --doctor".'); break; }
      const i = intentsFromFlags(app.json.flags);
      if (i.members && i.messageContent) { ok('Both switches (Server Members and Message Content) are on'); break; }
      i.members ? ok('Server Members switch is on') : fail('Server Members switch is still OFF');
      i.messageContent ? ok('Message Content switch is on') : fail('Message Content switch is still OFF');
      console.log(`\n  Turn them on at ${link('https://discord.com/developers/applications')} → your app → Bot → Privileged Gateway Intents → Save Changes.`);
      const done = await spinner('waiting for you to switch them on (I check by myself)…', async () => { const a = await discord('/applications/@me', token); const f = a.ok ? intentsFromFlags(a.json.flags) : null; return f && f.members && f.messageContent ? true : null; }, 120_000);
      if (done) { ok('Both switches are on'); break; }
      if (++tries >= 1 && (await confirm('Still not on. Continue anyway? (The filter cannot read messages until they are on.)', false))) break;
    }
  }

  // invite ----------------------------------------------------------------
  go('invite');
  const clientId = (bot && bot.id) || clientIdFromToken(token);
  let guildList = (await discord('/users/@me/guilds', token)).json ?? [];
  if (mode !== 'skip') {
    if (guildList.length) ok(`The bot is already in ${guildList.length} server${guildList.length === 1 ? '' : 's'}: ${guildList.slice(0, 4).map(g => g.name).join(', ')}`);
    if (!guildList.length) console.log(dim('  The bot has to be invited, like a person. I will make the invite link for you.'));
    if (!guildList.length || (mode !== 'quick' && (await confirm('Add it to another server as well?', false)))) {
      let admin = true; // Warden does many things (delete, time out, roles, audit log, pause invites), so Administrator is the recommended invite
      if (mode !== 'quick') admin = (await choose('What should the bot be allowed to do?', [
        { label: 'Administrator', tag: '(recommended)', desc: 'Warden does a lot (delete messages, time out and kick, manage roles, read the audit log, pause invites). This way nothing fails because of a missing permission.' },
        { label: 'Only what it needs', desc: 'A smaller list of permissions. Safer on paper, but features can silently stop working if one is missing.' },
      ])) === 0;
      const url = inviteUrl(clientId, admin);
      if (beginner()) console.log(dim('\n  Discord will show a page. Pick your server in the dropdown, click Continue, then Authorize. It may ask you to prove you are human.'));
      console.log(`\n  Open this link, pick your server in the list, and click ${bold('Authorize')}:\n\n  ${link(url)}\n`);
      if (mode === 'quick' || (await confirm('Open it in your browser?', true))) openBrowser(url);
      console.log(dim('  Tip: once it joins, go to Server Settings → Roles and drag the bot’s role near the top. A bot can only act on people below its role.'));
      const before = guildList.length;
      for (;;) {
        const got = await spinner('waiting for you to authorize it in your browser…', async () => { const g = (await discord('/users/@me/guilds', token)).json ?? []; return g.length > before ? g : null; }, 180_000);
        if (got) { guildList = got; ok(`It is in! Joined: ${bold(got.map(g => g.name).slice(0, 4).join(', '))}`); break; }
        const next = await choose('The bot has not joined a server yet.', [{ label: 'Keep waiting' }, { label: 'Skip for now', desc: 'Run "warden --invite" any time to get the link again.' }]);
        if (next === 1) { warn('Skipped. The panel stays empty until the bot joins a server.'); break; }
      }
    }
  }

  // sign in -----------------------------------------------------------------
  go('signin');
  if (has('signin')) {
    console.log(dim('  The control panel is a web page that only opens on this computer, nobody else can reach it.'));
    if (beginner()) console.log(dim('  A password stops anyone else who uses this computer from opening it. With no password, you sign in by typing "warden --open".'));
    const hasPw = !!readEnvValue('GUI_PASSWORD');
    const pwOptions = [
      ...(hasPw ? [{ label: 'Keep my current password', id: 'keep' }] : []),
      { label: 'Use a password', desc: 'You type one now (nothing shows while you type). Change it any time with "warden --password".', id: 'choose' },
      { label: 'Make a password for me', desc: 'A strong random one, shown once. You will need to save it.', id: 'random' },
      { label: 'No password', desc: 'Type "warden --open" and it signs you in. Nothing to remember.', id: 'none' },
    ];
    const pick = pwOptions[await choose('How do you want to sign in to the panel?', pwOptions)].id;
    if (pick === 'none') { removeEnv('GUI_PASSWORD'); ok('No password. Type "warden --open" whenever you want to open the panel.'); }
    else if (pick === 'choose') { const pw = await askNewPassword(); if (pw) { setEnv('GUI_PASSWORD', pw); ok('Password saved.'); } else warn('No password set. You can add one later with "warden --password".'); }
    else if (pick === 'random') { const pw = generatePassword(); setEnv('GUI_PASSWORD', pw); ok('Password set.'); showPassword(pw); await pause('Press Enter once you have saved it'); }
    else ok('Keeping your current password.');
  }

  // features --------------------------------------------------------------
  go('features');
  let settings = PRESETS[0].config, modLogChannel = '', createModLog = false, wantPick = false, settingsName = PRESETS[0].label;
  if (mode === 'skip') settings = null;
  else if (mode === 'quick') { /* Careful mode, announced in the last step */ }
  else if (mode === 'guided') {
    console.log(`\n  Warden has four protections, and each can be on or off:\n   ${cyan('Word filter')}      removes insults, threats, slurs, scams and personal info\n   ${cyan('Spam protection')}  stops floods, caps, emoji walls and repeated messages\n   ${cyan('Raid protection')}  notices lots of accounts joining at once and acts on them\n   ${cyan('Admin guard')}      finds whoever let the raiders in and removes their powerful roles, then cleans up the raiders'`);
    console.log(dim('\n  "Watching" means Warden only records what it would do, and deletes or punishes nothing. You can change every one of these later in the control panel.'));
    const preset = PRESETS[await choose('How should Warden start out?', PRESETS.map(p => ({ label: p.label, tag: p.tag, desc: p.desc })), 0)];
    settings = preset.config; settingsName = preset.label; ok(`Using: ${bold(preset.label)}`);
  } else {
    const answers = await askFeatures({ full: true });
    settings = answers.config; modLogChannel = answers.modLogChannel; createModLog = answers.createModLog; wantPick = answers.pickModLog; settingsName = 'your choices'; ok('Got it. Those choices are saved when Warden starts.');
  }

  // keep it running -------------------------------------------------------
  go('always');
  let viaService = false;
  if (has('always')) {
    alwaysOnWarnings();
    const kind = autostartKind();
    if (kind !== 'none') {
      const q = kind === 'systemd' ? 'Start Warden automatically whenever this computer starts, and restart it if it crashes?' : 'Start Warden automatically when you log in?';
      if (await confirm(q, true)) {
        if (running()) await stopBot(true);
        const r = enableAutostart({ now: true });
        r.ok ? ok(r.message) : warn(`Could not set that up: ${r.message}`);
        viaService = r.ok;
      } else info('Okay. Start it yourself with "warden --start", and change your mind any time with "warden --autostart".');
    } else info('Automatic start is not available here. See the README for how to keep Warden running.');
    if (mode !== 'quick') await pause('Press Enter to continue');
  }

  // start -----------------------------------------------------------------
  go('start');
  let started = null;
  if (viaService) {
    started = await spinner('waiting for Warden to start…', async () => running(), 90_000);
    if (!started) { fail('The automatic start did not come up. Run "warden --logs" or "journalctl --user -u warden" to see why.'); return; }
  } else {
    if (running()) { info('Warden was already running. Restarting it so your choices take effect.'); await stopBot(true); }
    started = await startBot({ open: false, quiet: true });
    if (!started) { fail('Warden did not start. Run "warden --doctor" to see what is wrong, or "warden --logs" to read what it said.'); return; }
  }
  ok('Warden is running');
  if (mode === 'quick') info('Starting in Careful mode: Warden watches and records, and deletes nothing yet. Change anything in the panel.');
  if (guildList.length) {
    const online = await spinner('connecting to Discord…', async () => tailLines(LOG, 200).some(l => l.includes('warden online as')) ? true : null, 40_000);
    online ? ok('Warden is online in Discord') : warn('Not online yet. If the panel stays empty, run "warden --logs".');
    if (settings) {
      try {
        const api = await panelSession(started.port);
        const servers = await api('/api/guilds');
        for (const g of servers) {
          const cfg = await api(`/api/config/${g.id}`);
          const next = applyPresetTo(cfg, { config: settings });
          if (modLogChannel) next.modLogChannel = modLogChannel;
          await api(`/api/config/${g.id}`, 'PUT', next);
          ok(`Set up ${bold(g.name)} with “${settingsName}”`);
        }
        if (!servers.length) warn('The bot has not loaded a server yet. You can set things up in the panel instead.');
        else if (mode !== 'skip') {
          if (wantPick) await pickModLog(api, servers);
          if (!wantPick && (mode === 'full' ? createModLog : true)) await offerModLog(api, servers, { auto: mode === 'quick' || (mode === 'full' && createModLog), guide: beginner() ? 'full' : 'compact' });
          await offerLook(api, servers, { auto: mode === 'quick' });
        }
      } catch (e) { warn(`I could not apply that for you (${e.message}). You can set it in the panel.`); }
    }
  }
  if (!installedOnPath()) {
    if (mode === 'quick' || (console.log(''), await confirm('Make the "warden" command work from any folder?', true))) { install(true); ok('The "warden" command now works from any folder. If it is not found, open a new terminal window.'); }
  }

  console.log('');
  await celebrate('All set. Warden is running!');
  console.log(`  ${bold('Make it yours:')} in the panel, open ${bold('Bot profile')} to give the bot its own name, picture and banner.\n`);
  await showBox([
    `${cyan('warden --open')}       open the control panel (it also signs you in)`,
    `${cyan('warden --status')}     see what it is doing`,
    `${cyan('warden --doctor')}     check for problems`,
    `${cyan('warden --autostart')}  start by itself when the computer starts`,
    `${cyan('warden --activity')}   see what Warden did lately`,
    `${cyan('warden --help')}       everything else`,
  ], { title: 'next steps', tone: 'brand' });
  if (beginner()) beginnerTour(started.port);
  console.log('');
  if (await confirm('Open the control panel now?', true)) openPanel(started.port);
  console.log('');
}

// ---------- the bot's look ----------
/** Offers the Warden look (shield picture, name Warden). Asks first, and never replaces a picture without saying so. */
async function offerLook(api, servers, { auto = false } = {}) {
  let now = null;
  try { now = await api(`/api/profile/${servers[0].id}`); } catch { /* still offer it */ }
  console.log(`\n  ${bold('How the bot looks')}  ${dim(now ? `right now it is called "${now.username}"${now.hasAvatar ? ' with its own picture' : ' with the default Discord picture'}` : '')}`);
  const own = !!now?.hasAvatar;
  const yes = (auto && !own) || await confirm(own ? 'Replace its picture, banner and description with the Warden look, and name it Warden?' : 'Give it the Warden look? (the shield "W" picture, a banner, a description and the name Warden)', !own);
  if (!yes) { info('Okay, left as it is. Change it any time in the panel under Bot profile, or run "warden --profile".'); return null; }
  const r = await applyLook(api, { guilds: servers, avatar: true });
  if (r.avatar) ok('Picture set to the Warden shield');
  if (r.banner) ok('Banner set');
  if (r.description) ok('Description set');
  if (r.username) ok(`Name set to ${bold(r.username)}`);
  for (const n of r.nicknames) n.ok ? ok(`Nickname in ${bold(n.name)} is Warden`) : warn(`Could not set the nickname in ${n.name}: ${n.why}`);
  r.notes.forEach(n => warn(n));
  if (!r.username && r.notes.length) info(`The bot is still shown as "Warden" inside your servers (nickname). Pick any username in the panel under Bot profile.`);
  return r;
}
export async function activityCommand({ kind = '', limit = 20 } = {}) {
  await banner(VERSION, 'recent activity');
  const s = running();
  if (!s) { fail('Warden is not running. Start it with: warden --start'); process.exitCode = 1; return; }
  const kinds = ['removed', 'watched', 'review', 'log', 'timeout'];
  if (kind && !kinds.includes(kind)) { fail(`--kind must be one of: ${kinds.join(', ')}`); process.exitCode = 1; return; }
  try {
    const api = await panelSession(s.port);
    const servers = await api('/api/guilds');
    if (!servers.length) { fail('The bot is not in any server yet. Run: warden --invite'); process.exitCode = 1; return; }
    for (const g of servers) {
      const stats = await api(`/api/stats/${g.id}`);
      console.log(`\n  ${bold(g.name)}  ${dim(`last 24h: ${stats.removed} removed, ${stats.wouldRemove} would remove, ${stats.needsLook} need a look, ${stats.timeouts} timeouts, ${stats.raids} raid events`)}\n`);
      const { items } = await api(`/api/audit/${g.id}?limit=${Math.min(200, Math.max(1, limit))}${kind ? `&kind=${kind}` : ''}`);
      if (!items.length) { info('Nothing recorded yet.'); continue; }
      for (const e of items) {
        const t = new Date(e.ts); const when = `${t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} ${t.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
        console.log(`  ${dim(when)}  ${cyan(`${e.module}/${e.action}`.padEnd(16))} ${e.reason.slice(0, 110)}`);
      }
    }
  } catch (e) { fail(e.message); process.exitCode = 1; }
  console.log('');
}
export async function logChannelCommand() {
  await banner(VERSION, 'private mod-log channel');
  const s = running();
  if (!s) { fail('Warden is not running. Start it with: warden --start'); process.exitCode = 1; return; }
  try {
    const api = await panelSession(s.port);
    const servers = await api('/api/guilds');
    if (!servers.length) { fail('The bot is not in any server yet. Run: warden --invite'); process.exitCode = 1; return; }
    await offerModLog(api, servers, { auto: !interactive });
  } catch (e) { fail(e.message); process.exitCode = 1; }
  console.log('');
}
export async function profileCommand() {
  await banner(VERSION, 'give the bot the Warden look');
  const s = running();
  if (!s) { fail('Warden is not running. Start it with: warden --start'); process.exitCode = 1; return; }
  if (needTerminal()) return;
  try {
    const api = await panelSession(s.port);
    const servers = await api('/api/guilds');
    if (!servers.length) { fail('The bot is not in any server yet. Run: warden --invite'); process.exitCode = 1; return; }
    await offerLook(api, servers);
  } catch (e) { fail(e.message); process.exitCode = 1; }
  console.log('');
}

// ---------- warden --autostart ----------
export async function autostartCommand({ remove = false } = {}) {
  await banner(VERSION, 'start automatically');
  const kind = autostartKind();
  if (kind === 'none') { warn('Automatic start is not available on this system.'); console.log(dim('  On Windows, create a Task Scheduler task that runs "node bin\\warden.js --run" when you log in.\n')); process.exitCode = 1; return; }
  if (remove) { const r = disableAutostart(); ok(r.message); console.log(''); return; }
  printBox(['Warden only protects your server while it is running.', 'This makes it start by itself, and restart if it crashes.', '', 'Your computer still has to be on. For 24/7 protection, use an always-on', 'machine such as a Raspberry Pi, a home server or a small VPS.'], { title: 'good to know', tone: 'warn' });
  if (!(await confirm('Turn on automatic start?', true))) { console.log(''); return; }
  if (running()) await stopBot(true);
  const r = enableAutostart({ now: true });
  r.ok ? ok(r.message) : (fail(r.message), (process.exitCode = 1));
  console.log('');
}
