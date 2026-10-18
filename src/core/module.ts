import type { Client } from 'discord.js';
import type { Store } from './db.js';

export interface Module { id: string; register(client: Client, store: Store): void }
