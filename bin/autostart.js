// Start Warden by itself when the computer starts (Linux systemd user service, macOS launchd). No dependencies.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ROOT } from './env.js';

const NAME = 'warden';
export const systemdUnit = ({ node, root }) => `[Unit]
Description=Warden Discord moderation bot
After=network-online.target
Wants=network-online.target

[Service]
WorkingDirectory=${root}
ExecStart=${node} ${path.join(root, 'bin', 'warden.js')} --run
Restart=on-failure
RestartSec=10

[Install]
WantedBy=default.target
`;
export const launchdPlist = ({ node, root }) => `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>Label</key><string>dev.warden.bot</string>
<key>WorkingDirectory</key><string>${root}</string>
<key>ProgramArguments</key><array><string>${node}</string><string>${path.join(root, 'bin', 'warden.js')}</string><string>--run</string></array>
<key>RunAtLoad</key><true/><key>KeepAlive</key><true/>
</dict></plist>
`;

const unitPath = (home = os.homedir()) => path.join(home, '.config', 'systemd', 'user', `${NAME}.service`);
const plistPath = (home = os.homedir()) => path.join(home, 'Library', 'LaunchAgents', 'dev.warden.bot.plist');
const run = (cmd, args) => { const r = spawnSync(cmd, args, { encoding: 'utf8' }); return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }; };

/** What this computer supports: 'systemd', 'launchd' or 'none' (Windows and others need a manual step). */
export function autostartKind() {
  if (process.platform === 'darwin') return 'launchd';
  if (process.platform === 'linux' && run('systemctl', ['--user', '--version']).ok) return 'systemd';
  return 'none';
}
export function autostartEnabled(home) {
  const kind = autostartKind();
  if (kind === 'systemd') return fs.existsSync(unitPath(home)) && run('systemctl', ['--user', 'is-enabled', NAME]).ok;
  if (kind === 'launchd') return fs.existsSync(plistPath(home));
  return false;
}

/** Returns { ok, message }. Does not start the bot itself; the caller decides (it must stop any running copy first). */
export function enableAutostart({ home, now = false } = {}) {
  const kind = autostartKind();
  const node = process.execPath;
  if (kind === 'systemd') {
    fs.mkdirSync(path.dirname(unitPath(home)), { recursive: true });
    fs.writeFileSync(unitPath(home), systemdUnit({ node, root: ROOT }));
    const steps = [run('systemctl', ['--user', 'daemon-reload']), run('systemctl', ['--user', 'enable', ...(now ? ['--now'] : []), NAME])];
    if (steps.some(s => !s.ok)) return { ok: false, message: steps.find(s => !s.ok).out || 'systemctl failed' };
    const linger = run('loginctl', ['enable-linger', os.userInfo().username]); // lets it start at boot even before you log in
    return { ok: true, message: linger.ok ? 'Warden will now start whenever this computer starts.' : 'Warden will now start when you log in. (To start it at boot, before you log in, run: sudo loginctl enable-linger $USER)' };
  }
  if (kind === 'launchd') {
    fs.mkdirSync(path.dirname(plistPath(home)), { recursive: true });
    fs.writeFileSync(plistPath(home), launchdPlist({ node, root: ROOT }));
    const r = run('launchctl', ['load', '-w', plistPath(home)]);
    return r.ok ? { ok: true, message: 'Warden will now start whenever you log in.' } : { ok: false, message: r.out || 'launchctl failed' };
  }
  return { ok: false, message: 'Automatic start is not supported on this system. On Windows, create a Task Scheduler task that runs "node bin\\warden.js --run" when you log in.' };
}
export function disableAutostart({ home } = {}) {
  const kind = autostartKind();
  if (kind === 'systemd') { run('systemctl', ['--user', 'disable', '--now', NAME]); fs.rmSync(unitPath(home), { force: true }); run('systemctl', ['--user', 'daemon-reload']); return { ok: true, message: 'Warden will no longer start by itself.' }; }
  if (kind === 'launchd') { run('launchctl', ['unload', '-w', plistPath(home)]); fs.rmSync(plistPath(home), { force: true }); return { ok: true, message: 'Warden will no longer start by itself.' }; }
  return { ok: false, message: 'Nothing to remove on this system.' };
}

/** Does this look like a laptop? (They sleep when the lid closes, which stops the bot.) */
export function looksLikeLaptop() {
  try { return fs.readdirSync('/sys/class/power_supply').some(n => /^BAT/i.test(n)); } catch { return false; }
}
