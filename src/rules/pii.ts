// Personal information patterns: the things people get doxxed with. High precision on purpose (validated, not just shaped like numbers).

const luhn = (digits: string): boolean => {
  let sum = 0, alt = false;
  for (let i = digits.length - 1; i >= 0; i--) { let n = Number(digits[i]); if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; }
  return sum % 10 === 0;
};
// Small dotted numbers (2.4.1.7, 1.1.1.1) are version numbers far more often than addresses, so at least one part must be 32 or more.
const validIPv4 = (s: string) => { const p = s.split('.').map(Number); return p.length === 4 && p.every(n => Number.isInteger(n) && n >= 0 && n <= 255) && Math.max(...p) >= 32; };
const TIME_WORDS = new Set(['min', 'mins', 'minute', 'minutes', 'hour', 'hours', 'hr', 'hrs', 'mile', 'miles', 'second', 'seconds', 'day', 'days', 'year', 'years', 'mph', 'km', 'more', 'other', 'last', 'next', 'big', 'long', 'short']);

export type PiiKind = 'bank account' | 'date of birth' | 'email' | 'ip address' | 'phone number' | 'card number' | 'social security number' | 'street address' | 'token or secret';
export interface PiiHit { kind: PiiKind; value: string }

/** Home-network, loopback and link-local addresses are fine to share: they only mean something inside one building. */
const privateIp = (ip: string) => /^(10\.|127\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.)/.test(ip);
const TOLL_FREE = /(?<![\d-])(?:\+?1[\s.-]?)?\(?8(?:00|33|44|55|66|77|88)\)?[\s.-]/;
const BUSINESS_PHONE = /\b(office|support|helpline|hotline|customer\s+service|toll[-\s]?free|reception|front\s+desk|clinic|call\s+us|contact\s+us|meeting\s+id|zoom|ticket|tracking|order|invoice|reference|case\s+(number|id)|serial)\b/i;
const PERSONAL_CUE = /\b(my|her|his|their|your)\s+(number|phone|cell|mobile|address|email)\b|\b(call|text|message|dm)\s+me\b|\bhis\b|\bher\b/i;
function ibanValid(raw: string): boolean {
  const s = raw.replace(/\s/g, '');
  if (s.length < 15 || s.length > 34) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) { const v = /\d/.test(ch) ? ch : String(ch.charCodeAt(0) - 55); for (const d of v) rem = (rem * 10 + Number(d)) % 97; }
  return rem === 1;
}
export function findPii(text: string): PiiHit[] {
  const out: PiiHit[] = [];
  // Role addresses (support@, info@) and example.com are published on purpose; a person's own address is what we protect.
  const ROLE = /^(support|help|info|contact|admin|sales|hello|hi|noreply|no-reply|billing|press|hr|careers|jobs|team|service|mail|office|abuse|security|privacy|legal|webmaster|feedback|news|office|enquiries|inquiries)([._+-].*)?$/i;
  for (const m of text.matchAll(/\b([\w.+-]+)@([\w-]+(?:\.[\w-]+)*\.[a-z]{2,})\b/gi)) if (!ROLE.test(m[1]!) && !/(^|\.)example\.(com|org|net)$/i.test(m[2]!)) out.push({ kind: 'email', value: m[0] });
  for (const m of text.matchAll(/(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?![\d.]*\d)(?!\.\d)/g)) if (validIPv4(m[0]) && !privateIp(m[0]) && !/(?:\bv|version\s*|sdk\s*)\d*$/i.test(text.slice(Math.max(0, (m.index ?? 0) - 10), m.index ?? 0))) out.push({ kind: 'ip address', value: m[0] });
  for (const m of text.matchAll(/(?<![\w:])(?:[0-9a-f]{1,4}:){3,7}[0-9a-f]{1,4}(?![\w:])/gi)) if (/[a-f]/i.test(m[0]) || m[0].includes('::')) out.push({ kind: 'ip address', value: m[0] });
  const businessy = BUSINESS_PHONE.test(text) && !PERSONAL_CUE.test(text);
  for (const m of text.matchAll(/(?<![\d-])(?:\+\d{1,3}[\s.-]?)?(?:\(\d{3}\)\s?|\d{3}[\s.-])\d{3}[\s.-]\d{4}(?![\d-])/g)) if (!businessy && !TOLL_FREE.test(m[0] + ' ')) out.push({ kind: 'phone number', value: m[0] });
  for (const m of text.matchAll(/(?<![\d-])\+\d{1,3}[\s.-]?\d{2,4}[\s.-]?\d{3,4}[\s.-]?\d{3,4}(?![\d-])/g)) if (!out.some(o => o.value === m[0])) out.push({ kind: 'phone number', value: m[0] });
  for (const m of text.matchAll(/(?<![\d-])(?:07\d{3}[\s-]?\d{6}|04\d{2}[\s-]?\d{3}[\s-]?\d{3}|0[1-3]\d{2,3}[\s-]\d{3}[\s-]\d{3,4})(?![\d-])/g)) out.push({ kind: 'phone number', value: m[0] });
  // Cards: grouped with spaces/dashes, or a plain 13-16 digit run starting with a real card prefix. Discord IDs (17-19 digits, start with 1) never match.
  for (const m of text.matchAll(/(?<![\d-])(?:\d[ -]?){12,18}\d(?![\d-])/g)) {
    const d = m[0].replace(/\D/g, '');
    const grouped = /[ -]/.test(m[0]);
    const prefixOk = d.length >= 13 && d.length <= 16 && /^(4|5[1-5]|2[2-7]|3[47]|6011|65)/.test(d);
    if (/\btest\b|\bsandbox\b|\bstripe\b/i.test(text)) continue; // documented test cards
    if (d.length >= 13 && d.length <= 19 && luhn(d) && (grouped ? /^[3-6]/.test(d) : prefixOk)) out.push({ kind: 'card number', value: m[0] });
  }
  for (const m of text.matchAll(/(?<![\d-])(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?![\d-])/g)) out.push({ kind: 'social security number', value: m[0] });
  for (const m of text.matchAll(/\b\d{1,5}\s+((?:[A-Za-z]+\s+){1,3})(street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|court|ct|circle|cir|terrace|parkway|pkwy|highway|hwy)\b\.?/gi)) {
    const between = m[1]!.trim().toLowerCase().split(/\s+/);
    if (between.some(w => TIME_WORDS.has(w))) continue;
    out.push({ kind: 'street address', value: m[0] }); // any street address: an address does not belong in a public server, whether it is a home or a shop
  }
  if (/\b(?:my\s+)(?:password|passwd|pwd|passcode)\s*(?:is|=|:)\s*(\S{4,})/i.test(text)) out.push({ kind: 'token or secret', value: 'password' });
  if (/\b(?:pass|pwd|passwd)\s*[:=]\s*\S{5,}|\bpassword\s*[:=]\s*(?!required|incorrect|invalid|wrong|hidden)\S{5,}/i.test(text)) out.push({ kind: 'token or secret', value: 'password' });
  if (/\bpassport\s+(?:number|no\.?|#)\s*(?:is\s*)?[:#]?\s*[a-z0-9]{6,10}\b/i.test(text)) out.push({ kind: 'social security number', value: 'passport number' });
  if (/\b(?:driver'?s?\s+licen[sc]e|dl)\s+(?:number|no\.?|#)\s*[:#]?\s*[a-z0-9-]{6,}\b/i.test(text)) out.push({ kind: 'social security number', value: 'driver license number' });
  // Bank details
  for (const m of text.matchAll(/\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){2,7}(?:\s?[A-Z0-9]{1,4})?)\b/g)) if (ibanValid(m[1]!)) out.push({ kind: 'bank account', value: 'IBAN' });
  if (/\b(account|acct)\s+(number|no\.?|#)\s*(is|:)?\s*\d{6,17}\b|\brouting\s+(number|no\.?)\s*(is|:)?\s*\d{9}\b|\bsort\s+code\s*(is|:)?\s*\d{2}-?\d{2}-?\d{2}\b/i.test(text)) out.push({ kind: 'bank account', value: 'bank details' });
  if (/\b(dob|date\s+of\s+birth|born(\s+on)?)\s*(is|:)?\s*\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4}\b|\bmaiden\s+name\b/i.test(text)) out.push({ kind: 'date of birth', value: 'date of birth' });
  if (/\bpassport\s*[:#]\s*[a-z]?\d{6,9}\b/i.test(text)) out.push({ kind: 'social security number', value: 'passport number' });
  if (/\b(?:login|credentials|user(?:name)?)\s*(?:is|=|:)\s*\S+\s*(?:\/|\||:)\s*\S{6,}|\badmin\s*[\/:]\s*\S{6,}/i.test(text)) out.push({ kind: 'token or secret', value: 'login details' });
  if (/\b(?:my|the)\s+(?:seed|recovery|secret)\s+phrase\s*(?:is|:)/i.test(text) || /\b(?:private\s+key|priv\s*key)\s*[:=]?\s*(?:0x)?[a-f0-9]{64}\b|\b0x[a-f0-9]{64}\b/i.test(text)) out.push({ kind: 'token or secret', value: 'wallet secret' });
  // Leaked secrets: bot tokens, API keys and private keys. Posting one is as dangerous as posting a password.
  if (/\b[MNO][A-Za-z\d_-]{23,25}\.[A-Za-z\d_-]{6}\.[A-Za-z\d_-]{27,38}\b/.test(text)) out.push({ kind: 'token or secret', value: 'Discord token' });
  if (/\b(?:sk-[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35})\b/.test(text)) out.push({ kind: 'token or secret', value: 'API key' });
  if (/\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/.test(text)) out.push({ kind: 'token or secret', value: 'login token (JWT)' });
  if (/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/.test(text)) out.push({ kind: 'token or secret', value: 'private key' });
  return out;
}
