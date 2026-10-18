import { Events, type Message } from 'discord.js';
import { isRealEdit } from './edits.js';
import type { Module } from '../../core/module.js';
import { testModeActive } from '../../core/config.js';
import { actOnMember, isExempt, postModLog, punish } from '../../core/actions.js';
import { classify, type Context } from '../../rules/engine.js';
import { decide, escalate, type Decision } from '../../rules/policy.js';
import { learnFrom, learnerFor, saveLearners } from '../../rules/learning.js';

// "Needs a look" notices: at most a few a minute per server, one per person per minute, so a busy chat cannot flood the mod-log.
const notices = new Map<string, number[]>();
const allowNotice = (guildId: string, userId: string, now = Date.now()): boolean => {
  const recent = (notices.get(guildId) ?? []).filter(t => now - t < 60_000);
  const key = `${guildId}:${userId}`; const last = notices.get(key)?.[0] ?? 0;
  if (recent.length >= 5 || now - last < 60_000) return false;
  notices.set(guildId, [...recent, now]); notices.set(key, [now]);
  return true;
};

const SAMPLE_RATE = 0.03; // shadow mode keeps this share of normal messages so you can see what the filter lets through

export const contextOf = (msg: Message<true>): Context => ({
  mentionsOthers: msg.mentions.users.some(u => u.id !== msg.author.id),
  replyToOther: !!msg.reference?.messageId && msg.mentions.repliedUser?.id !== msg.author.id,
});

const reasonOf = (d: Decision): string => d.outcomes.filter(o => o.mode === d.action).map(o => `${o.hit.category}${o.hit.term ? ` "${o.hit.term}"` : ''}`).join(', ');

export const filterModule: Module = {
  id: 'filter',
  register(client, store) {
    setInterval(() => { store.purgeOldFlags(); store.purgeOldStrikes(); }, 3600_000).unref();
    store.purgeOldFlags(); store.purgeOldStrikes(); store.purgeOldAudit();
    setInterval(() => saveLearners(store), 120_000).unref();
    process.once('beforeExit', () => saveLearners(store));

    async function check(msg: Message<true>, edited = false): Promise<void> {
      const cfg = store.getConfig(msg.guild.id);
      const f = cfg.filter;
      if (!f.enabled || isExempt(msg, f.exempt, testModeActive(cfg))) return;
      if (!msg.content.trim()) return;

      const learnedWords = f.learning.enabled ? new Set(learnerFor(store, msg.guild.id).learned()) : undefined;
      const c = classify(msg.content, contextOf(msg), { customWords: f.customWords, customRegex: f.customRegex, allowWords: f.allowWords, learnedWords });
      if (f.learning.enabled) learnFrom(store, msg.guild.id, msg.author.id, msg.content, c);
      const d = decide(c, { categories: f.categories, exceptions: f.exceptions, swearLevel: f.swearLevel }, { channelId: msg.channelId, roleIds: msg.member ? [...msg.member.roles.cache.keys()] : [] });
      let action = d.action, weight = d.weight, reason = reasonOf(d) + (edited && d.action !== 'none' ? ' (after an edit)' : ''), score = 1;
      let unsure: { why: string; label: string } | null = c.maybes?.[0] ? { why: `${c.maybes[0].category} "${c.maybes[0].term}": ${c.maybes[0].why}`, label: c.maybes[0].category } : null;

      if (action === 'none' && unsure && f.unsure !== 'off') {
        store.addFlag(msg.guild.id, msg.author.id, msg.content, score, unsure.label, 'review');
        store.audit(msg.guild.id, 'filter', 'review', msg.author.id, `needs a look: ${unsure.why}`);
        if (f.unsure === 'notify' && cfg.modLogChannel && allowNotice(msg.guild.id, msg.author.id)) await postModLog(msg.guild, cfg.modLogChannel, `**Needs a look** <@${msg.author.id}> in <#${msg.channelId}>\nWhy: ${unsure.why}\n> \`${msg.content.slice(0, 240).replace(/[`\n]+/g, ' ')}\`\n${msg.url}`);
        return;
      }
      if (action === 'none') {
        if (f.shadow && Math.random() < SAMPLE_RATE) store.addFlag(msg.guild.id, msg.author.id, msg.content, 0, 'sample', 'sample');
        return;
      }

      store.addFlag(msg.guild.id, msg.author.id, msg.content, score, reason.split(' ')[0] || 'rule', 'flag');
      if (f.shadow) { store.audit(msg.guild.id, 'filter', 'shadow', msg.author.id, `SHADOW (nothing done): would ${action}: ${reason}`); return; }
      if (action === 'log') { store.audit(msg.guild.id, 'filter', 'log', msg.author.id, `logged only: ${reason}`); return; }

      await punish(msg, { store, module: 'filter', action: 'delete', reason, timeoutSeconds: 0, modLog: cfg.modLogChannel });
      const total = store.addStrike(msg.guild.id, msg.author.id, weight, f.escalation.windowHours);
      const seconds = escalate(total, f.escalation);
      if (seconds > 0 && msg.member) {
        const outcome = await actOnMember(msg.member, 'timeout', `Filter: ${total} strikes in ${f.escalation.windowHours}h`, seconds);
        store.audit(msg.guild.id, 'filter', 'escalate', msg.author.id, `${total} strikes in ${f.escalation.windowHours}h: ${outcome}`);
        await postModLog(msg.guild, cfg.modLogChannel, `**Timeout** <@${msg.author.id}>: ${outcome}. ${total} strikes in ${f.escalation.windowHours}h (each is a deleted message). Last: ${reason}.`);
      }
    }

    // Writing something harmless and editing it into something bad must not get past the filter: edited text is checked like a new message.
    client.on(Events.MessageUpdate, async (before, after) => {
      try {
        const msg = after.partial ? await after.fetch().catch(() => null) : after;
        if (!msg || !msg.inGuild() || !isRealEdit(before.content, msg.content, !!msg.editedTimestamp)) return;
        await check(msg, true);
      } catch (e) { console.error('filter: edit check failed:', (e as Error).message); }
    });

    client.on(Events.MessageCreate, async msg => {
      if (!msg.inGuild()) return;
      try { await check(msg); } catch (e) { console.error('filter: check failed:', (e as Error).message); }
    });
  },
};
