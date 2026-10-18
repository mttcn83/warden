// Starting, stopping and talking to the running bot. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { ROOT, DATA, STATE, LOG, KEY, DEFAULT_PORT, readEnvValue, tailLines } from './env.js';
import { ok, fail, dim, bold, green, red, cyan, stripAnsi, spinner, sleep, ago, printBox, showBox } from './ui.js';

export const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
export const readState = () => { try { return JSON.parse(fs.readFileSync(STATE, 'utf8')); } catch { return null; } };
export function running() {
  const s = readState();
  if (s && alive(s.pid)) return s;
  if (s) fs.rmSync(STATE, { force: true }); // stale
  return null;
}
const portFree = port => new Promise(resolve => {
  const srv = net.createServer();
  srv.once('error', () => resolve(false));
  srv.listen(port, '127.0.0.1', () => srv.close(() => resolve(true)));
});
export async function pickPort(wanted) {
  if (wanted) { if (await portFree(wanted)) return wanted; throw new Error(`port ${wanted} is already in use`); }
  for (const p of [readState()?.port, DEFAULT_PORT]) if (p && await portFree(p)) return p;
  return await new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => { const { port } = srv.address(); srv.close(() => resolve(port)); });
  });
}
function newestMtime(dir) {
  let newest = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); newest = Math.max(newest, e.isDirectory() ? newestMtime(p) : fs.statSync(p).mtimeMs); }
  return newest;
}
/** Prefer the compiled build when it is up to date, otherwise run the TypeScript source through tsx. */
function entry() {
  const dist = path.join(ROOT, 'dist', 'index.js'), tsx = path.join(ROOT, 'node_modules', '.bin', 'tsx');
  if (fs.existsSync(dist) && fs.statSync(dist).mtimeMs >= newestMtime(path.join(ROOT, 'src'))) return [process.execPath, [dist]];
  if (fs.existsSync(tsx)) return [tsx, [path.join(ROOT, 'src', 'index.ts')]];
  if (fs.existsSync(dist)) return [process.execPath, [dist]];
  throw new Error('nothing to run yet. Run "warden --setup" (or "npm install") first');
}
export const dependenciesInstalled = () => fs.existsSync(path.join(ROOT, 'node_modules', '.bin', 'tsx')) || fs.existsSync(path.join(ROOT, 'dist', 'index.js'));

export function openBrowser(url) {
  const opener = process.platform === 'darwin' ? 'open' : 'xdg-open';
  try { spawn(opener, [url], { detached: true, stdio: 'ignore' }).on('error', () => {}).unref(); return true; } catch { return false; }
}
export function writeKey() {
  fs.mkdirSync(DATA, { recursive: true });
  const key = randomBytes(24).toString('hex');
  fs.writeFileSync(KEY, key, { mode: 0o600 });
  return key;
}
export function openPanel(port) {
  const key = writeKey();
  const opened = openBrowser(`http://127.0.0.1:${port}/?key=${key}`);
  if (!opened) console.log(`  Could not open a browser. Run ${bold('warden --open')} or visit http://127.0.0.1:${port}\n`);
  return opened;
}

/** Start the bot in the background. Returns { port, pid } or null if it did not come up. */
export async function startBot({ port: wanted = 0, open = true, quiet = false } = {}) {
  const already = running();
  if (already) { if (!quiet) { ok(`Warden is already running on port ${bold(already.port)}.`); console.log(dim('    Open the panel with: warden --open\n')); } if (open) openPanel(already.port); return already; }
  if (!readEnvValue('DISCORD_TOKEN')) { fail('No Discord bot token yet.'); console.log(`    Run ${bold('warden --setup')} (guided) or ${bold('warden --token')}.\n`); process.exitCode = 1; return null; }
  let port, cmd, args;
  try { port = await pickPort(wanted); [cmd, args] = entry(); } catch (e) { fail(e.message); console.log(''); process.exitCode = 1; return null; }
  fs.mkdirSync(DATA, { recursive: true });
  const logFd = fs.openSync(LOG, 'a');
  const from = fs.statSync(LOG).size;
  const child = spawn(cmd, args, { cwd: ROOT, detached: true, stdio: ['ignore', logFd, logFd], env: { ...process.env, GUI_PORT: String(port), DATA_DIR: DATA, WARDEN_KEY_FILE: KEY } });
  child.unref();
  fs.writeFileSync(STATE, JSON.stringify({ pid: child.pid, port, startedAt: Date.now() }));
  const ready = await spinner('starting Warden…', async () => {
    if (!alive(child.pid)) return 'dead';
    return fs.readFileSync(LOG, 'utf8').slice(from).includes(`GUI: http://127.0.0.1:${port}`) ? 'up' : null;
  }, 90_000);
  if (ready !== 'up') {
    fail(`Warden ${ready === 'dead' ? 'stopped right after starting' : 'did not come up in time'}. Last log lines:`);
    tailLines(LOG, 8).forEach(l => console.log(dim('    ' + stripAnsi(l))));
    if (ready !== 'dead') { try { process.kill(-child.pid, 'SIGTERM'); } catch { /* gone */ } }
    fs.rmSync(STATE, { force: true });
    console.log('');
    process.exitCode = 1; return null;
  }
  if (!quiet) {
    console.log('');
    printBox([
      `${green('●')} ${bold('Warden is running')}`,
      '',
      `${dim('panel')}   ${cyan(`http://127.0.0.1:${port}`)}`,
      `${dim('pid')}     ${child.pid}`,
      `${dim('logs')}    warden --logs    ${dim('stop:')} warden --stop`,
    ], { title: 'Warden', tone: 'brand' });
    console.log('');
  }
  if (open) openPanel(port);
  return { port, pid: child.pid };
}

/** Run the bot in the foreground (used by the automatic-start service, which wants the process to stay attached). */
export async function runForeground() {
  if (running()) { console.error('Warden is already running.'); process.exit(1); }
  if (!readEnvValue('DISCORD_TOKEN')) { console.error('No Discord bot token yet. Run: warden --setup'); process.exit(1); }
  const port = await pickPort(0), [cmd, args] = entry();
  fs.mkdirSync(DATA, { recursive: true });
  const child = spawn(cmd, args, { cwd: ROOT, stdio: 'inherit', env: { ...process.env, GUI_PORT: String(port), DATA_DIR: DATA, WARDEN_KEY_FILE: KEY } });
  fs.writeFileSync(STATE, JSON.stringify({ pid: child.pid, port, startedAt: Date.now() }));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => child.kill(sig));
  child.on('exit', code => { fs.rmSync(STATE, { force: true }); process.exit(code ?? 0); });
}

export async function stopBot(quiet = false) {
  const s = running();
  if (!s) { if (!quiet) console.log(`\n  ${dim('○')} Warden is not running.\n`); return false; }
  try { process.kill(-s.pid, 'SIGTERM'); } catch { try { process.kill(s.pid, 'SIGTERM'); } catch { /* gone */ } }
  for (let i = 0; i < 50 && alive(s.pid); i++) await sleep(100);
  if (alive(s.pid)) { try { process.kill(-s.pid, 'SIGKILL'); } catch { /* gone */ } }
  fs.rmSync(STATE, { force: true }); fs.rmSync(KEY, { force: true });
  if (!quiet) { console.log(''); ok('Warden stopped.'); console.log(''); }
  return true;
}

export async function status() {
  const s = running();
  console.log('');
  if (!s) { printBox([`${dim('○')} ${bold('Not running')}`, '', dim('Start it with: warden --start')], { title: 'Warden', tone: 'warn' }); console.log(''); return; }
  const online = tailLines(LOG, 400).reverse().find(l => l.includes('warden online as'));
  const discord = online ? green(stripAnsi(online).replace(/^.*warden online as /, 'online as ').replace(/ with modules.*/, '')) : dim('connecting… (see warden --logs)');
  await showBox([
    `${green('●')} ${bold('Running')}    ${dim('for')} ${ago(Date.now() - s.startedAt)}`,
    '',
    `${dim('panel')}    ${cyan(`http://127.0.0.1:${s.port}`)}`,
    `${dim('discord')}  ${discord}`,
    `${dim('pid')}      ${s.pid}`,
  ], { title: 'Warden', tone: 'ok' });
  console.log('');
}

export function logs(follow) {
  if (!fs.existsSync(LOG)) { console.log(`\n  ${dim('No log yet. Start Warden first.')}\n`); return; }
  if (follow) spawn('tail', ['-n', '30', '-f', LOG], { stdio: 'inherit' });
  else console.log(tailLines(LOG, 40).map(stripAnsi).join('\n'));
}

export async function openCommand() {
  const s = running();
  if (!s) { console.log(`\n  ${red('✖')} Warden is not running. Start it with ${bold('warden --start')}\n`); process.exitCode = 1; return; }
  openPanel(s.port);
  console.log(`\n  ${green('✔')} Opening ${cyan(`http://127.0.0.1:${s.port}`)} in your browser\n`);
}

// ---------- the `warden` command on your PATH ----------
const linkPath = () => path.join(os.homedir(), '.local', 'bin', 'warden');
export const installedOnPath = () => { try { return fs.realpathSync(linkPath()) === path.join(ROOT, 'bin', 'warden.js'); } catch { return false; } };
export function install(quiet = false) {
  const dir = path.dirname(linkPath()), target = path.join(ROOT, 'bin', 'warden.js');
  fs.mkdirSync(dir, { recursive: true });
  fs.chmodSync(target, 0o755);
  try { if (fs.lstatSync(linkPath())) fs.rmSync(linkPath(), { force: true }); } catch { /* none yet */ }
  fs.symlinkSync(target, linkPath());
  if (quiet) return;
  console.log(''); ok(`Installed: ${linkPath()}`);
  if (!(process.env.PATH || '').split(':').includes(dir)) console.log(`  ${dim('Add this to your shell profile so "warden" is found:')}\n    export PATH="$HOME/.local/bin:$PATH"`);
  else console.log(`  Try it: ${bold('warden --start')}`);
  console.log('');
}
export function uninstall() {
  try { if (installedOnPath()) { fs.rmSync(linkPath()); console.log(`\n  ${green('✔')} Removed ${linkPath()}\n`); return; } } catch { /* nothing there */ }
  console.log(`\n  ${dim('Nothing to remove.')}\n`);
}

// ---------- the running panel's API (used by the setup wizard to apply a preset) ----------
export async function panelSession(port) {
  const key = writeKey();
  const res = await fetch(`http://127.0.0.1:${port}/?key=${key}`, { redirect: 'manual', signal: AbortSignal.timeout(10_000) });
  const cookie = (res.headers.getSetCookie?.() ?? []).map(c => c.split(';')[0]).find(c => c.startsWith('warden_session='));
  if (!cookie) throw new Error('could not sign in to the panel');
  return async (pathname, method = 'GET', body) => {
    const r = await fetch(`http://127.0.0.1:${port}${pathname}`, { method, headers: { cookie, ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(20_000) });
    const json = await r.json().catch(() => null);
    if (!r.ok) throw new Error(`${pathname}: ${JSON.stringify(json?.error ?? r.status)}`);
    return json;
  };
}
