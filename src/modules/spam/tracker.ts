import { contentProblem, type ContentLimits } from './content.js';

export interface SpamLimits extends ContentLimits { maxMessages: number; windowSeconds: number; maxDuplicates: number; maxMentions: number }
export interface MessageRef { id: string; channelId: string }

const KEEP_REFS_MS = 120_000; // messages remembered per person so everything they just sent can be deleted together
const MAX_REFS = 100;

/** Same message with the parts spammers vary taken out: case, numbers, spacing, links and punctuation. */
export const sameness = (content: string) => content.toLowerCase().replace(/https?:\/\/\S+/g, 'link').replace(/[\d\s\p{P}\p{S}]+/gu, '');

/** Per-user sliding window. Pure and clock-injectable so it can be unit tested. */
export class SpamTracker {
  private seen = new Map<string, { ts: number; content: string; same: string }[]>();
  private refs = new Map<string, (MessageRef & { ts: number })[]>();
  constructor(private limits: SpamLimits) {}
  setLimits(l: SpamLimits) { this.limits = l; }

  /** `strict` halves the message and duplicate limits (for members who only just joined). `ref` lets the message be deleted later with the rest. */
  check(key: string, content: string, mentions: number, now = Date.now(), o: { strict?: boolean; ref?: MessageRef } = {}): string | null {
    const { windowSeconds, maxMentions } = this.limits;
    const maxMessages = o.strict ? Math.max(2, Math.ceil(this.limits.maxMessages / 2)) : this.limits.maxMessages;
    const maxDuplicates = o.strict ? Math.max(2, this.limits.maxDuplicates - 1) : this.limits.maxDuplicates;
    const cutoff = now - windowSeconds * 1000;
    const same = sameness(content);
    const hist = (this.seen.get(key) ?? []).filter(m => m.ts > cutoff);
    hist.push({ ts: now, content, same });
    this.seen.set(key, hist);
    if (o.ref) {
      const list = (this.refs.get(key) ?? []).filter(r => now - r.ts < KEEP_REFS_MS);
      list.push({ ...o.ref, ts: now });
      this.refs.set(key, list.slice(-MAX_REFS));
    }
    const shape = contentProblem(content, this.limits);
    if (shape) return shape;
    if (mentions > maxMentions) return `mention spam (${mentions} mentions)`;
    if (hist.length > maxMessages) return `rate limit (${hist.length} messages in ${windowSeconds}s)`;
    const dupes = hist.filter(m => m.content === content).length;
    if (content && dupes >= maxDuplicates) return `duplicate messages (${dupes}x)`;
    const alike = same.length >= 6 ? hist.filter(m => m.same === same).length : 0;
    if (alike >= maxDuplicates + 1) return `near-identical messages (${alike}x)`; // "buy now 1", "buy now 2", "buy now 3"
    return null;
  }

  /** The shape of one message only (shouting, emoji walls, zalgo), for edited messages: an edit is not a new message, so it does not count toward the rate limit. */
  checkShape(content: string): string | null { return contentProblem(content, this.limits); }

  /** Everything this person sent recently, so it can all be deleted once they are caught. Forgets it afterwards. */
  take(key: string, now = Date.now()): MessageRef[] {
    const list = (this.refs.get(key) ?? []).filter(r => now - r.ts < KEEP_REFS_MS);
    this.refs.delete(key);
    return list.map(({ id, channelId }) => ({ id, channelId }));
  }

  /** Drop idle users so memory stays bounded. */
  sweep(now = Date.now()) {
    const cutoff = now - this.limits.windowSeconds * 1000;
    for (const [k, v] of this.seen) if (!v.some(m => m.ts > cutoff)) this.seen.delete(k);
    for (const [k, v] of this.refs) if (!v.some(r => now - r.ts < KEEP_REFS_MS)) this.refs.delete(k);
  }
}
