import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { GuildConfig, defaultGuildConfig } from './config.js';

export class Store {
  private db: Database.Database;
  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.db = new Database(join(dir, 'warden.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS guild_config (guild_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS audit (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, guild_id TEXT NOT NULL,
        module TEXT NOT NULL, action TEXT NOT NULL, user_id TEXT NOT NULL, reason TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS flagged (
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL, text TEXT NOT NULL, score REAL NOT NULL, label TEXT NOT NULL, reviewed INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS strikes (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, guild_id TEXT NOT NULL, user_id TEXT NOT NULL, weight INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS learner_state (guild_id TEXT PRIMARY KEY, data TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS strikes_lookup ON strikes (guild_id, user_id, ts);
      -- human-feedback learning was removed: drop its leftover tables
      DROP TABLE IF EXISTS feedback;
      DROP TABLE IF EXISTS online_model;`);
    try { this.db.exec("ALTER TABLE flagged ADD COLUMN kind TEXT NOT NULL DEFAULT 'flag'"); } catch { /* column already exists */ }
  }
  getConfig(guildId: string): GuildConfig {
    const row = this.db.prepare('SELECT data FROM guild_config WHERE guild_id = ?').get(guildId) as { data: string } | undefined;
    if (!row) return defaultGuildConfig();
    return GuildConfig.parse(JSON.parse(row.data));
  }
  setConfig(guildId: string, cfg: GuildConfig): void {
    const data = JSON.stringify(GuildConfig.parse(cfg));
    this.db.prepare('INSERT INTO guild_config (guild_id, data) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data').run(guildId, data);
  }
  audit(guildId: string, module: string, action: string, userId: string, reason: string): void {
    this.db.prepare('INSERT INTO audit (ts, guild_id, module, action, user_id, reason) VALUES (?,?,?,?,?,?)').run(Date.now(), guildId, module, action, userId, reason);
  }

  // --- ML review data. Flagged text is kept 7 days so moderators can review, then purged. ---
  /** kind: 'flag' = the filter flagged it, 'sample' = a normal message kept for review (shadow mode). */
  addFlag(guildId: string, userId: string, text: string, score: number, label: string, kind: 'flag' | 'sample' | 'review' = 'flag'): number {
    const r = this.db.prepare('INSERT INTO flagged (ts, guild_id, user_id, text, score, label, kind) VALUES (?,?,?,?,?,?,?)').run(Date.now(), guildId, userId, text.slice(0, 300), score, label, kind);
    return Number(r.lastInsertRowid);
  }
  listFlags(guildId: string, limit = 20) {
    return this.db.prepare('SELECT id, ts, user_id AS userId, text, score, label, kind FROM flagged WHERE guild_id = ? ORDER BY id DESC LIMIT ?').all(guildId, limit) as
      { id: number; ts: number; userId: string; text: string; score: number; label: string; kind: string }[];
  }
  purgeOldFlags(maxAgeMs = 7 * 24 * 3600_000) { this.db.prepare('DELETE FROM flagged WHERE ts < ?').run(Date.now() - maxAgeMs); }
  /** Full log: every recorded action, newest first, with optional module filter and text search. */
  listAudit(guildId: string, o: { limit?: number; before?: number; module?: string; actions?: string[]; q?: string } = {}) {
    const limit = Math.min(500, Math.max(1, o.limit ?? 100));
    const where = ['guild_id = ?']; const args: (string | number)[] = [guildId];
    if (o.before) { where.push('id < ?'); args.push(o.before); }
    if (o.module) { where.push('module = ?'); args.push(o.module); }
    if (o.actions?.length) { where.push(`action IN (${o.actions.map(() => '?').join(',')})`); args.push(...o.actions); }
    if (o.q) { where.push('(reason LIKE ? OR user_id LIKE ?)'); args.push(`%${o.q}%`, `%${o.q}%`); }
    const rows = this.db.prepare(`SELECT id, ts, module, action, user_id AS userId, reason FROM audit WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT ?`).all(...args, limit + 1) as
      { id: number; ts: number; module: string; action: string; userId: string; reason: string }[];
    return { items: rows.slice(0, limit), hasMore: rows.length > limit };
  }
  /** How many times each kind of thing happened since `since` (for the Overview). */
  auditCounts(guildId: string, since: number) {
    return this.db.prepare('SELECT module, action, COUNT(*) AS n FROM audit WHERE guild_id = ? AND ts >= ? GROUP BY module, action').all(guildId, since) as { module: string; action: string; n: number }[];
  }
  purgeOldAudit(days = 90) { this.db.prepare('DELETE FROM audit WHERE ts < ?').run(Date.now() - days * 86_400_000); }
  /** One strike for a deletion (serious categories weigh more). Returns the user's total inside the window. */
  addStrike(guildId: string, userId: string, weight: number, windowHours: number): number {
    const now = Date.now();
    this.db.prepare('INSERT INTO strikes (ts, guild_id, user_id, weight) VALUES (?,?,?,?)').run(now, guildId, userId, weight);
    const row = this.db.prepare('SELECT COALESCE(SUM(weight),0) AS total FROM strikes WHERE guild_id = ? AND user_id = ? AND ts > ?').get(guildId, userId, now - windowHours * 3_600_000) as { total: number };
    return row.total;
  }
  purgeOldStrikes(days = 8) { this.db.prepare('DELETE FROM strikes WHERE ts < ?').run(Date.now() - days * 86_400_000); }
  loadLearner(guildId: string): unknown {
    const row = this.db.prepare('SELECT data FROM learner_state WHERE guild_id = ?').get(guildId) as { data: string } | undefined;
    try { return row ? JSON.parse(row.data) : null; } catch { return null; }
  }
  saveLearner(guildId: string, state: unknown): void {
    this.db.prepare('INSERT INTO learner_state (guild_id, data) VALUES (?, ?) ON CONFLICT(guild_id) DO UPDATE SET data = excluded.data').run(guildId, JSON.stringify(state));
  }
}
