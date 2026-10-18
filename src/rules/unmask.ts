// Undo masked swearing: "f*ck", "sh#t", "b**ch", "st*pid". A mask character stands in for one letter; every other letter must match.
// **bold** and *italic* are left alone because only masks inside a word count, and at least two real letters must be visible.

const MASK = '*#%_';
const TOKEN = /[\p{L}\p{N}]+(?:[*#%_]+[\p{L}\p{N}]*)+/gu;

export class Unmasker {
  private byLength = new Map<number, string[]>();
  private strict: Set<string>;
  /** `strict` words may be read even when only their first letter is left ("f***"). */
  constructor(words: Iterable<string>, strict: Iterable<string> = []) {
    this.strict = new Set(strict);
    for (const w of words) {
      if (!/^[a-z]{3,14}$/.test(w)) continue;
      const list = this.byLength.get(w.length) ?? [];
      list.push(w); this.byLength.set(w.length, list);
    }
  }
  /** The vocabulary word a masked token stands for, or null. */
  resolve(token: string): string | null {
    const t = token.toLowerCase();
    const candidates = this.byLength.get(t.length);
    if (!candidates) return null;
    let visible = 0;
    for (const c of t) if (!MASK.includes(c)) visible++;
    if (visible < 2) {
      if (visible !== 1 || !/^[a-z]/.test(t) || t.length - visible < 3) return null;
      return candidates.find(w => w[0] === t[0] && this.strict.has(w)) ?? null;
    }
    for (const w of candidates) {
      let match = true;
      for (let i = 0; i < t.length; i++) if (!MASK.includes(t[i]!) && t[i] !== w[i]) { match = false; break; }
      if (match) return w;
    }
    return null;
  }
  /** Same text with masked words written out. Text without masks is returned unchanged and costs almost nothing. */
  apply(text: string): string {
    if (!/[*#%_]/.test(text)) return text;
    return text.replace(TOKEN, token => this.resolve(token) ?? token);
  }
}
