// What a single message looks like, regardless of how fast it was sent: shouting, emoji walls and zalgo ("t̶̢̛e̷x̸t̶").
export interface ContentLimits { maxCapsPercent?: number; maxEmojis?: number; blockZalgo?: boolean }

const EMOJI = /\p{Extended_Pictographic}|<a?:\w+:\d+>/gu;

export function contentProblem(content: string, l: ContentLimits): string | null {
  if (!content) return null;
  if (l.blockZalgo) {
    const marks = (content.match(/\p{M}/gu) ?? []).length;
    if (marks >= 10 && marks / content.length > 0.3) return 'zalgo text';
  }
  if (l.maxEmojis && l.maxEmojis > 0) {
    const n = (content.match(EMOJI) ?? []).length;
    if (n > l.maxEmojis) return `emoji spam (${n} emojis)`;
  }
  if (l.maxCapsPercent && l.maxCapsPercent > 0) {
    const stripped = content.replace(/<a?:\w+:\d+>|<[@#!&]+\d+>|https?:\/\/\S+|:\w+:/g, ''); // emoji names, mentions and links do not count
    const letters = stripped.match(/\p{L}/gu) ?? [];
    if (letters.length >= 15) {
      const upper = letters.filter(c => c !== c.toLowerCase() && c === c.toUpperCase()).length;
      const pct = Math.round((upper / letters.length) * 100);
      if (pct >= l.maxCapsPercent) return `too many capital letters (${pct}%)`;
    }
  }
  return null;
}
