// Terminal look and feel: colors, gradients, the banner, boxes, prompts, spinner. No dependencies.
// Plain text when output is piped, NO_COLOR is set, or the terminal has no color. Animations are skipped in CI or with WARDEN_NO_ANIMATION=1.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

export const tty = !!(stdout.isTTY && !process.env.NO_COLOR);
export const interactive = !!(stdin.isTTY && stdout.isTTY);
export const animated = tty && !process.env.CI && !process.env.WARDEN_NO_ANIMATION;
const truecolor = tty && /truecolor|24bit/i.test(process.env.COLORTERM || '');
const RESET = '\x1b[0m';
const c = (code, s) => (tty ? `\x1b[${code}m${s}${RESET}` : s);
export const dim = s => c('2', s), bold = s => c('1', s), green = s => c('32', s), red = s => c('31', s), cyan = s => c('36', s), yellow = s => c('33', s);
export const stripAnsi = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
/** How many terminal columns a string takes: emoji and CJK letters are two wide, joiners take none. */
export const visibleLength = s => [...stripAnsi(s)].reduce((n, ch) => { const c = ch.codePointAt(0); return n + (c === 0xFE0F || c === 0x200D ? 0 : (c >= 0x1F300 && c <= 0x1FAFF) || (c >= 0x3000 && c <= 0x9FFF) || (c >= 0xAC00 && c <= 0xD7AF) ? 2 : 1); }, 0);
export const sleep = ms => new Promise(r => setTimeout(r, ms));

// ---------- color ----------
const fg = (r, g, b) => (!tty ? '' : truecolor ? `\x1b[38;2;${r};${g};${b}m` : `\x1b[38;5;${16 + 36 * Math.round(r / 51) + 6 * Math.round(g / 51) + Math.round(b / 51)}m`);
const STOPS = [[0, 214, 255], [88, 116, 255], [176, 92, 255]]; // cyan → blue → violet, like the panel
/** Color at position t (0..1) along the brand gradient. */
export function brand(t) {
  const x = Math.max(0, Math.min(1, t)) * (STOPS.length - 1), i = Math.min(STOPS.length - 2, Math.floor(x)), f = x - i;
  return STOPS[i].map((v, k) => Math.round(v + (STOPS[i + 1][k] - v) * f));
}
/** Text with the brand gradient running left to right. */
export function gradient(text, from = 0, to = 1) {
  if (!tty) return text;
  const chars = [...text];
  return chars.map((ch, i) => (ch === ' ' ? ch : fg(...brand(from + (to - from) * (chars.length > 1 ? i / (chars.length - 1) : 0))) + ch)).join('') + RESET;
}

// ---------- banner ----------
const LETTERS = {
  W: ['██╗    ██╗', '██║    ██║', '██║ █╗ ██║', '██║███╗██║', '╚███╔███╔╝', ' ╚══╝╚══╝ '],
  A: [' █████╗ ', '██╔══██╗', '███████║', '██╔══██║', '██║  ██║', '╚═╝  ╚═╝'],
  R: ['██████╗ ', '██╔══██╗', '██████╔╝', '██╔══██╗', '██║  ██║', '╚═╝  ╚═╝'],
  D: ['██████╗ ', '██╔══██╗', '██║  ██║', '██║  ██║', '██████╔╝', '╚═════╝ '],
  E: ['███████╗', '██╔════╝', '█████╗  ', '██╔══╝  ', '███████╗', '╚══════╝'],
  N: ['███╗   ██╗', '████╗  ██║', '██╔██╗ ██║', '██║╚██╗██║', '██║ ╚████║', '╚═╝  ╚═══╝'],
};
export const ART = Array.from({ length: 6 }, (_, row) => [...'WARDEN'].map(ch => LETTERS[ch][row]).join(''));
const ART_WIDTH = Math.max(...ART.map(l => [...l].length));

/** One row of the wordmark. `glow` is where a bright band currently sits (0..1), or -1 for none. */
function artRow(line, r, glow = -1) {
  return '  ' + [...line].map((ch, i) => {
    if (ch === ' ') return ' ';
    const base = brand(i / ART_WIDTH * 0.75 + r / ART.length * 0.25);
    const d = glow < 0 ? 1 : Math.abs(i / ART_WIDTH - glow);
    const k = Math.max(0, 1 - d / 0.14) * 0.85; // how close to white this letter is right now
    return fg(...base.map(v => Math.round(v + (255 - v) * k))) + ch;
  }).join('') + (tty ? RESET : '');
}

/** The big gradient wordmark. Reveals line by line, then a bright band sweeps across it, when `animate` is on and the terminal can take it. */
export async function banner(version, subtitle = 'self-hosted discord moderation', { animate = true } = {}) {
  console.log('');
  const go = animate && animated;
  for (let r = 0; r < ART.length; r++) { console.log(artRow(ART[r], r)); if (go) await sleep(38); }
  if (go) {
    for (let f = 0; f <= 22; f++) { // the shimmer: redraw the six rows in place with the band moved along
      stdout.write(`\x1b[${ART.length}A`);
      for (let r = 0; r < ART.length; r++) stdout.write(artRow(ART[r], r, -0.15 + f / 22 * 1.3) + '\x1b[K\n');
      await sleep(22);
    }
  }
  const rule = '━'.repeat(ART_WIDTH);
  if (go) { for (let n = 4; n <= ART_WIDTH; n += 6) { stdout.write('\r  ' + gradient('━'.repeat(n), 0, n / ART_WIDTH)); await sleep(8); } stdout.write('\r'); }
  console.log('  ' + gradient(rule));
  if (go) { // the subtitle types itself out
    const text = [...subtitle];
    for (let n = 1; n <= text.length; n += 2) { stdout.write(`\r  ${gradient(text.slice(0, n).join(''), 0, 0.6 * n / text.length)}`); await sleep(9); }
    stdout.write('\r\x1b[K');
  }
  console.log(`  ${gradient(subtitle, 0, 0.6)}${dim(`  ·  v${version}`)}\n`);
}

// ---------- lines, steps, boxes ----------
export const ok = text => console.log(`  ${green(bold('✔'))} ${text}`);
export const fail = text => console.log(`  ${red(bold('✖'))} ${text}`);
export const warn = text => console.log(`  ${yellow(bold('▲'))} ${text}`);
export const info = text => console.log(`    ${dim(text)}`);
export const rule = () => console.log('  ' + (tty ? gradient('─'.repeat(54)) : '-'.repeat(54)));
const bar = (n, total, width = 14) => { const filled = Math.round(width * n / total); return (tty ? gradient('▰'.repeat(filled), 0, n / total) + dim('▱'.repeat(width - filled)) : '#'.repeat(filled) + '-'.repeat(width - filled)); };
export function step(n, total, title) { console.log(`\n  ${bar(n, total)}  ${dim(`${n}/${total}`)}  ${bold(title)}`); rule(); }

/** A rounded box around lines of text. tone: 'brand' (gradient), 'ok', 'warn', 'fail'. */
export function box(lines, { title = '', tone = 'brand', pad = 2 } = {}) {
  const inner = Math.max(...lines.map(visibleLength), visibleLength(title) + 4);
  const width = inner + pad * 2;
  const paint = (s, t) => (tone === 'ok' ? green(s) : tone === 'warn' ? yellow(s) : tone === 'fail' ? red(s) : tty ? gradient(s, t, Math.min(1, t + 0.5)) : s);
  const top = '╭' + (title ? '─ ' + title + ' ' + '─'.repeat(Math.max(0, width - visibleLength(title) - 3)) : '─'.repeat(width)) + '╮';
  const out = [paint(top, 0)];
  for (const l of lines) out.push(paint('│', 0) + ' '.repeat(pad) + l + ' '.repeat(inner - visibleLength(l)) + ' '.repeat(pad) + paint('│', 1));
  out.push(paint('╰' + '─'.repeat(width) + '╯', 0));
  return out;
}
export const printBox = (lines, opts) => { console.log(box(lines, opts).map(l => '  ' + l).join('\n')); };
/** Same box, but it draws itself top to bottom in a real terminal. Await it. */
export const showBox = async (lines, opts) => {
  const out = box(lines, opts).map(l => '  ' + l);
  if (!animated) { console.log(out.join('\n')); return; }
  for (const l of out) { console.log(l); await sleep(16); }
};

/** A little sparkle burst to finish a big moment. */
export async function celebrate(text = 'All set!') {
  const marks = ['✦', '✧', '·', '✶', '✺', '*'], width = 44;
  const frame = () => Array.from({ length: width }, (_, i) => (Math.random() < 0.28 ? fg(...brand(i / width)) + marks[Math.floor(Math.random() * marks.length)] + RESET : ' ')).join('');
  if (animated) { for (let f = 0; f < 9; f++) { stdout.write(`\r  ${frame()}`); await sleep(70); } stdout.write('\r\x1b[K'); }
  console.log(`  ${gradient('✦ ' + text + ' ✦')}`);
}

// ---------- prompts ----------
const q = s => `  ${cyan(bold('›'))} ${s} `;
/** Ask a question; returns the trimmed answer, or the default when the user just presses Enter. */
export async function ask(question, def = '') {
  const rl = readline.createInterface({ input: stdin, output: stdout });
  try { const a = (await rl.question(q(`${question}${def ? dim(` (${def})`) : ''}`))).trim(); return a || def; }
  catch (e) {
    if (e?.name === 'AbortError') { stdout.write(`\n\n  ${dim('Stopped. Nothing was lost: run the same command again to carry on.')}\n\n`); process.exit(130); } // Ctrl+C
    throw e;
  }
  finally { rl.close(); }
}
/** Yes/no question. Enter picks the default. */
export async function confirm(question, def = true) {
  for (;;) {
    const a = (await ask(`${question} ${dim(def ? '[Y/n]' : '[y/N]')}`)).toLowerCase();
    if (!a) return def;
    if (/^y(es)?$/.test(a)) return true;
    if (/^n(o)?$/.test(a)) return false;
  }
}
/** Pick one of several options by number. Returns the index. */
export async function choose(title, options, def = 0) {
  console.log(`\n  ${bold(title)}`);
  options.forEach((o, i) => { console.log(`   ${gradient(String(i + 1), i / Math.max(1, options.length - 1) * 0.6, 0.6)}  ${bold(o.label)}${o.tag ? ' ' + green(o.tag) : ''}`); if (o.desc) console.log(`      ${dim(o.desc)}`); });
  for (;;) {
    const a = await ask(`Choose 1-${options.length}`, String(def + 1));
    const n = Number(a);
    if (Number.isInteger(n) && n >= 1 && n <= options.length) return n - 1;
  }
}
export async function pause(text = 'Press Enter to continue') { await ask(dim(text)); }

/** Read a secret without echoing it. */
export function askHidden(question) {
  return new Promise(resolve => {
    stdout.write(q(question));
    let buf = '';
    if (!stdin.isTTY) { stdin.once('data', d => resolve(String(d).trim())); return; }
    stdin.setRawMode(true); stdin.resume(); stdin.setEncoding('utf8');
    const onData = ch => {
      for (const k of ch) {
        if (k === '\r' || k === '\n') { stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData); stdout.write('\n'); return resolve(buf.trim()); }
        if (k === '\x03') { stdout.write('\n'); process.exit(130); }
        if (k === '\x7f') buf = buf.slice(0, -1); else buf += k;
      }
    };
    stdin.on('data', onData);
  });
}

/** Spinner while `until()` returns null. Returns its first non-null value, or null on timeout. */
export async function spinner(label, until, timeoutMs) {
  const frames = '⣾⣽⣻⢿⡿⣟⣯⣷';
  const t0 = Date.now(); let i = 0;
  const clear = () => { if (tty) stdout.write('\r\x1b[K'); };
  for (;;) {
    const r = await until();
    if (r !== null) { clear(); return r; }
    if (Date.now() - t0 > timeoutMs) { clear(); return null; }
    if (tty) stdout.write(`\r  ${fg(...brand((i % 16) / 15))}${frames[i++ % frames.length]}${RESET} ${label} ${dim(`${Math.floor((Date.now() - t0) / 1000)}s`)}`);
    await sleep(90);
  }
}
export const ago = ms => { const s = Math.floor(ms / 1000); return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m` : `${Math.floor(s / 3600)}h ${Math.floor((s % 3600) / 60)}m`; };
