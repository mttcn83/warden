// The help menu (`warden -h`): a status strip, a "start here" card, and every command grouped, with a plain line each.
// Plain text when piped or NO_COLOR is set; animated (banner shimmer, rows sliding in) only in a real terminal.
import { stdout } from 'node:process';
import { HELP, parseUsage } from './commands.js';
import { animated, banner, bold, box, cyan, dim, gradient, green, tty, sleep, visibleLength, yellow } from './ui.js';

const GROUP_MARK = { 'Start here': '✦', 'Keep it running': '▶', 'See what it did': '◉', 'Your bot': '◈', Other: '○' };
const width = () => Math.max(60, Math.min(stdout.columns || 90, 100));

/** Word-wrap to `w` columns. */
export function wrap(text, w) {
  const lines = []; let line = '';
  for (const word of text.split(' ')) {
    if (line && visibleLength(line + ' ' + word) > w) { lines.push(line); line = word; } else line = line ? line + ' ' + word : word;
  }
  if (line) lines.push(line);
  return lines;
}

/** Draws a line one piece at a time (the glow-in), or at once when not animated. */
async function reveal(lines, ms = 14) {
  for (const l of lines) { console.log(l); if (animated) await sleep(ms); }
}

const flag = (s, t) => (s ? gradient(s.padEnd(2), t, Math.min(1, t + 0.2)) : '  ');

function row({ long, short, text, sub, t, col }) {
  const textW = width() - col - 4;
  const [first, ...rest] = wrap(text, textW);
  const lead = sub ? `      ${dim('↳')} ${dim(long.padEnd(col - 9))}` : `    ${bold(flag(short, t))} ${cyan(long.padEnd(col - 8))}`;
  return [`${lead} ${sub ? dim(first ?? '') : first ?? ''}`, ...rest.map(r => ' '.repeat(col + 2) + (sub ? dim(r) : r))];
}

/** Is Warden running, and where? Passed in so this file does not need to know how the bot is started. */
export async function printHelp({ version, state, first }) {
  await banner(version, 'self-hosted discord moderation', { animate: true });
  // status strip
  const status = state?.running
    ? `${green(bold('●'))} ${bold('Running')} ${dim('on')} ${cyan(`http://127.0.0.1:${state.port}`)}${state.online ? `  ${dim('·')}  ${green('online in Discord')}` : `  ${dim('·')}  ${yellow('connecting to Discord')}`}`
    : `${dim('○')} ${bold('Not running')} ${dim('· start it with')} ${cyan('warden -u')}`;
  console.log('  ' + status + '\n');

  const startRows = [
    ['-s', 'setup', 'walks you through everything'],
    ['-u', 'start', 'turn Warden on'],
    ['-o', 'open', 'the control panel'],
  ];
  if (first) {
    const lines = ['No bot set up yet. Run the first command below and it', 'does the rest: token, invite link, password, settings.', '', ...startRows.map(([f, n, d]) => `${bold(gradient(f))}  ${cyan(n.padEnd(7))} ${dim(d)}`)];
    await reveal(box(lines, { title: 'first time here?' }).map(l => '  ' + l), 22);
    console.log('');
  }

  const groups = [...new Set(HELP.map(h => h.group))];
  const col = Math.max(...HELP.map(h => parseUsage(h.usage).long.length)) + 10;
  for (const [gi, g] of groups.entries()) {
    const t = gi / Math.max(1, groups.length - 1) * 0.8;
    const title = `${GROUP_MARK[g] ?? '◆'} ${g.toUpperCase()}`;
    console.log('  ' + gradient(title, t, Math.min(1, t + 0.25)) + ' ' + (tty ? dim('─'.repeat(Math.max(4, width() - title.length - 6))) : '-'.repeat(8)));
    const lines = [];
    for (const h of HELP.filter(x => x.group === g)) {
      const { long, short } = parseUsage(h.usage);
      lines.push(...row({ long, short, text: h.short ?? h.desc, sub: h.sub, t, col }));
    }
    await reveal(lines, 12);
    console.log('');
  }
}
