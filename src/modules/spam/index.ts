import { Events } from 'discord.js';
import { testModeActive } from '../../core/config.js';
import type { Module } from '../../core/module.js';
import { deleteMessageRefs, isExempt, punish } from '../../core/actions.js';
import { SpamTracker } from './tracker.js';
import { isRealEdit } from '../filter/edits.js';

export const spamModule: Module = {
  id: 'spam',
  register(client, store) {
    const trackers = new Map<string, SpamTracker>();
    setInterval(() => trackers.forEach(t => t.sweep()), 60_000).unref();

    // Editing an ordinary message into a wall of emoji or shouting must not get past the shape limits.
    client.on(Events.MessageUpdate, async (before, after) => {
      try {
        const msg = after.partial ? await after.fetch().catch(() => null) : after;
        if (!msg || !msg.inGuild() || !isRealEdit(before.content, msg.content, !!msg.editedTimestamp)) return;
        const cfg = store.getConfig(msg.guild.id);
        if (!cfg.spam.enabled || isExempt(msg, cfg.spam.exempt, testModeActive(cfg))) return;
        const t = trackers.get(msg.guild.id) ?? new SpamTracker(cfg.spam);
        t.setLimits(cfg.spam);
        const reason = t.checkShape(msg.content);
        if (reason) await punish(msg, { store, module: 'spam', action: cfg.spam.action, reason: `${reason} (after an edit)`, timeoutSeconds: cfg.spam.timeoutSeconds, modLog: cfg.modLogChannel });
      } catch (e) { console.error('spam: edit check failed:', (e as Error).message); }
    });

    client.on(Events.MessageCreate, async msg => {
      if (!msg.inGuild()) return;
      const cfg = store.getConfig(msg.guild.id);
      if (!cfg.spam.enabled || isExempt(msg, cfg.spam.exempt, testModeActive(cfg))) return;
      let t = trackers.get(msg.guild.id);
      if (!t) trackers.set(msg.guild.id, (t = new SpamTracker(cfg.spam)));
      t.setLimits(cfg.spam);
      const joined = msg.member?.joinedTimestamp ?? 0;
      const fresh = cfg.spam.newMemberMinutes > 0 && joined > 0 && Date.now() - joined < cfg.spam.newMemberMinutes * 60_000;
      const reason = t.check(msg.author.id, msg.content, msg.mentions.users.size + msg.mentions.roles.size, Date.now(), { strict: fresh, ref: { id: msg.id, channelId: msg.channelId } });
      if (!reason) return;
      const earlier = cfg.spam.deleteAll ? t.take(msg.author.id).filter(r => r.id !== msg.id) : [];
      await punish(msg, { store, module: 'spam', action: cfg.spam.action, reason: fresh ? `${reason}, new member` : reason, timeoutSeconds: cfg.spam.timeoutSeconds, modLog: cfg.modLogChannel });
      if (earlier.length) {
        const n = await deleteMessageRefs(msg.guild, earlier);
        if (n) store.audit(msg.guild.id, 'spam', 'purge', msg.author.id, `deleted ${n} earlier message${n === 1 ? '' : 's'} from the same person`);
      }
    });
  },
};
