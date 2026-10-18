import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { Client, GatewayIntentBits, Events, Partials } from 'discord.js';
import { Store } from './core/db.js';
import type { Module } from './core/module.js';
import { filterModule } from './modules/filter/index.js';
import { spamModule } from './modules/spam/index.js';
import { raidModule } from './modules/raid/index.js';
import { guardModule } from './modules/guard/index.js';
import { startGui } from './gui/server.js';
import { saveLearners } from './rules/learning.js';

const token = process.env.DISCORD_TOKEN;
if (!token) { console.error('DISCORD_TOKEN is not set (see .env.example)'); process.exit(1); }

const dataDir = process.env.DATA_DIR ?? './data';
const store = new Store(dataDir);
store.purgeOldAudit();
const client = new Client({
  // MessageContent is a privileged intent: enable it in the developer portal.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers, GatewayIntentBits.GuildInvites, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Message, Partials.Channel], // so edits to messages sent before the bot started are still seen
});

const modules: Module[] = [filterModule, spamModule, raidModule, guardModule];
for (const m of modules) m.register(client, store);

client.once(Events.ClientReady, c => {
  console.log(`warden online as ${c.user.tag} with modules: ${modules.map(m => m.id).join(', ')} (all opt-in, off by default)`);
});

// GUI_PASSWORD is optional: without it a random one is used and you sign in through `warden --open` (a one-time link).
const guiPassword = process.env.GUI_PASSWORD || randomBytes(24).toString('hex');
// The panel listens on this computer only. GUI_HOST exists for Docker, where the container publishes the port to the host's loopback.
const guiHost = process.env.GUI_HOST ?? '127.0.0.1';
if (guiHost !== '127.0.0.1' && !process.env.GUI_PASSWORD) { console.error('GUI_HOST is set to something other than 127.0.0.1, so GUI_PASSWORD is required.'); process.exit(1); }
await startGui(client, store, guiPassword, Number(process.env.GUI_PORT ?? 48731), process.env.WARDEN_KEY_FILE ?? join(dataDir, 'open-key'), guiHost);

try {
  await client.login(token);
} catch (e) {
  console.error(`Discord login failed: ${(e as Error).message}\nCheck DISCORD_TOKEN and that Message Content + Server Members intents are enabled in the developer portal. The GUI is still running.`);
}

// Save what the filter has learned before stopping.
for (const sig of ['SIGINT', 'SIGTERM'] as const) process.once(sig, () => { try { saveLearners(store); } catch { /* nothing more to do */ } process.exit(0); });
