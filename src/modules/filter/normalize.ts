const LEET: Record<string, string> = { '0': 'o', '1': 'i', '3': 'e', '4': 'a', '5': 's', '7': 't', '@': 'a', '$': 's' };

// Letters from other alphabets that look like Latin ones ("раyраl" with a Cyrillic р). Anything not listed is left alone.
const LOOKALIKE: Record<string, string> = {
  'а': 'a', 'е': 'e', 'о': 'o', 'р': 'p', 'с': 'c', 'у': 'y', 'х': 'x', 'к': 'k', 'м': 'm', 'н': 'h', 'т': 't', 'в': 'b', 'і': 'i', 'ѕ': 's', 'ј': 'j', 'ԁ': 'd', 'ӏ': 'l',
  'ο': 'o', 'ν': 'v', 'α': 'a', 'ε': 'e', 'ρ': 'p', 'τ': 't', 'ι': 'i', 'κ': 'k', 'υ': 'u', 'χ': 'x', 'β': 'b', 'η': 'n',
  'ı': 'i', 'ᴀ': 'a', 'ʙ': 'b', 'ᴄ': 'c', 'ᴅ': 'd', 'ᴇ': 'e', 'ꜰ': 'f', 'ɢ': 'g', 'ʜ': 'h', 'ɪ': 'i', 'ᴊ': 'j', 'ᴋ': 'k', 'ʟ': 'l', 'ᴍ': 'm', 'ɴ': 'n', 'ᴏ': 'o', 'ᴘ': 'p', 'ʀ': 'r', 'ꜱ': 's', 'ᴛ': 't', 'ᴜ': 'u', 'ᴠ': 'v', 'ᴡ': 'w', 'ʏ': 'y', 'ᴢ': 'z', 'ø': 'o', 'đ': 'd', 'ł': 'l', 'ð': 'd', 'ɑ': 'a', 'ʋ': 'u', 'ɱ': 'm', 'ɩ': 'i', 'ǝ': 'e', 'ƒ': 'f', 'ɡ': 'g', '¡': 'i', '€': 'e',
};
const LOOKALIKE_RE = new RegExp(`[${Object.keys(LOOKALIKE).join('')}]`, 'g');

/** Lowercase, strip zero-width/combining marks, map lookalike letters, undo leetspeak, collapse repeated letters. */
/** Boxed, circled and flag-style letters (🅿 🅸 ⓔ 🇦) written as plain letters. */
function unboxLetters(s: string): string {
  return s.replace(/[\u{1F130}-\u{1F149}\u{1F150}-\u{1F169}\u{1F170}-\u{1F189}\u{1F1E6}-\u{1F1FF}]/gu, ch => {
    const c = ch.codePointAt(0)!;
    const base = c >= 0x1F1E6 ? 0x1F1E6 : c >= 0x1F170 ? 0x1F170 : c >= 0x1F150 ? 0x1F150 : 0x1F130;
    return String.fromCharCode(97 + c - base);
  });
}

/** Compatibility and lookalike letters written as plain letters, but nothing else changed (case, digits and spacing stay). */
export function foldLetters(input: string): string {
  return unboxLetters(input).normalize('NFKD').replace(/[\u0300-\u036F\u0483-\u0489]/g, '').replace(LOOKALIKE_RE, c => LOOKALIKE[c] ?? c);
}

export function normalize(input: string): string {
  return unboxLetters(input)
    .replace(/💩/gu, ' shit ')
    .replace(/🖕/gu, ' fuck you ')
    .normalize('NFKD')
    .replace(/[​-‏⁠﻿̀-ͯ]/g, '')
    .toLowerCase()
    .replace(LOOKALIKE_RE, c => LOOKALIKE[c] ?? c)
    .replace(/(?<=\p{L})!(?=\p{L})/gu, 'i') // "sh!t" but not the "!" at the end of "idiot!"
    .replace(/[013457@$]/g, c => LEET[c] ?? c)
    .replace(/(.)\1{2,}/g, '$1$1');
}
