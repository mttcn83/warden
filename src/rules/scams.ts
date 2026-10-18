import { normalize } from '../modules/filter/normalize.js';
import { compile, firstMatch, loadList } from './lists.js';

/** Scams and phishing: fake gift/giveaway phrases (lists/scams-en.txt) and lookalike login domains. */
const phrases = compile(loadList('scams-en.txt'));

// Domains that imitate Discord or Steam. Official domains are listed so they never match.
const OFFICIAL = /(^|\.)(discord\.com|discord\.gg|discordapp\.com|discordapp\.net|discord\.media|discord\.gift|discordstatus\.com|steamcommunity\.com|steampowered\.com|store\.steampowered\.com)$/i;
const LOOKALIKE = /(?:d[i1l]sc[o0]rd|d[i1l]scorcl|d[i1l]sc0rd|d[i1l]scord[a-z]*|discorb|dlscord|disc0rd|steamcomm?un[i1l]ty|steamcommunnity|steampowred|steamc0mmunity|nitro-?(?:gift|free|drop|claim))/i;

// A real brand mixed with bait words in a domain name (steamgift-claim.ru, vbucks-free.top) is a scam site.
const BRAND = '(?:usps|fedex|dhl|ezpass|dmv|irs|hmrc|app+le|amaz+on|netflix|spotify|iphone|airpods|steam|discord|nitro|roblox|robux|vbucks|fortnite|epicgames|paypal|binance|coinbase|metamask|minecraft|tiktok|instagram|cs2|csgo|skins?|valorant|genshin|apex|pubg|warzone)';
const BAIT = '(?:gift|claim|free|giveaway|verify|login|wallet|promo|reward|airdrop|generator|drop|bonus|redeem|tradeoffer|trade-offer|accept|secure|appeal|support|prize|winner|sale|offer|deal|event|winter|summer|official|community|confirm|identity|limited|win|recover|restore|unlock|redelivery|pay|toll|tolls|refund|invoice|migrat\\w*|mint|drainer)';
const BRAND_BAIT = new RegExp(`${BRAND}[a-z0-9-]*${BAIT}|${BAIT}[a-z0-9-]*${BRAND}`, 'i');

const STRONG_BAIT = /airdrop|giveaway|nitro|robux|vbucks|generator|claim/; // enough on their own in a domain that is not the real brand
const BAIT_WORD = /claim|free|giveaway|airdrop|reward|prize|winner|bonus|redeem|verify|login|promo/g; // two of these in one domain name (claim-eth-airdrop) is a lure

export type ScamHit = { kind: 'scam phrase' | 'lookalike link'; term: string };

export function findScams(text: string): ScamHit[] {
  const out: ScamHit[] = [];
  const phrase = firstMatch(normalize(text), phrases);
  if (phrase) out.push({ kind: 'scam phrase', term: phrase === 'pattern' ? 'giveaway or gift scam' : phrase });
  // A download link to a program: a classic way to spread malware.
  if (/\bhttps?:\/\/\S+\.(?:exe|scr|bat|msi|apk|jar|vbs|cmd)\b|\/\S+\.(?:exe|scr|msi|apk|vbs)\b/i.test(text)) out.push({ kind: 'lookalike link', term: 'program download link' });
  // A crypto wallet address pasted into chat is almost always a donation scam or a drainer.
  if (/\b(?:bc1[a-z0-9]{25,60}|[13][a-km-zA-HJ-NP-Z1-9]{25,34}|0x[a-fA-F0-9]{40})\b/.test(text)) out.push({ kind: 'scam phrase', term: 'crypto wallet address' });
  for (const m of text.matchAll(/\b(?:https?:\/\/)?((?:[a-z0-9-]+\.)+[a-z]{2,})(?:[\/?#]\S*)?/gi)) {
    const host = m[1]!.toLowerCase();
    if (OFFICIAL.test(host)) continue;
    const label = host.replace(/\.[a-z]{2,}$/, '');
    if (/steam(powered|community)/i.test(host)) { out.push({ kind: 'lookalike link', term: host }); continue; } // the real ones were listed as official above
    if (LOOKALIKE.test(host) || BRAND_BAIT.test(label) || (label.match(BAIT_WORD) ?? []).length >= 2 || STRONG_BAIT.test(label)) out.push({ kind: 'lookalike link', term: host });
  }
  return out;
}

/** Discord server invite links (advertising). */
export function findInvites(text: string): string[] {
  return [...text.matchAll(/(?:discord\.gg|discord(?:app)?\.com\/invite|dsc\.gg|invite\.gg)\/([a-z0-9-]{2,})/gi)].map(m => m[0]);
}
