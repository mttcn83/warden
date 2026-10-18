// Where things live, and reading/writing the .env file. No dependencies.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fs.realpathSync(fileURLToPath(import.meta.url))), '..');
export const DATA = path.resolve(ROOT, process.env.DATA_DIR || 'data');
export const STATE = path.join(DATA, 'run.json');
export const LOG = path.join(DATA, 'warden.log');
export const KEY = path.join(DATA, 'open-key');
export const ENV_FILE = path.join(ROOT, '.env');
export const DEFAULT_PORT = 48731;
export const VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version;

export function readEnvValue(name) {
  if (process.env[name]) return process.env[name];
  try { const m = fs.readFileSync(ENV_FILE, 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm')); return m ? m[1].trim() : ''; } catch { return ''; }
}
function writeEnv(text) { fs.writeFileSync(ENV_FILE, text, { mode: 0o600 }); fs.chmodSync(ENV_FILE, 0o600); }
const readEnvFile = () => { try { return fs.readFileSync(ENV_FILE, 'utf8'); } catch { return ''; } };

/** Set KEY=value in .env, keeping every other line. The file is readable only by you. */
export function setEnv(name, value) {
  let env = readEnvFile();
  const re = new RegExp(`^${name}=.*$`, 'm');
  env = re.test(env) ? env.replace(re, () => `${name}=${value}`) : (env && !env.endsWith('\n') ? env + '\n' : env) + `${name}=${value}\n`;
  writeEnv(env);
}
export function removeEnv(name) {
  const env = readEnvFile();
  if (!new RegExp(`^${name}=`, 'm').test(env)) return false;
  writeEnv(env.replace(new RegExp(`^${name}=.*\\n?`, 'm'), ''));
  return true;
}
export const tailLines = (file, n) => { try { return fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(-n); } catch { return []; } };
