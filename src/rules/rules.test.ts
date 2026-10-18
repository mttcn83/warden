import { describe, expect, it } from 'vitest';
import { classify, type Category, type Context } from './engine.js';
import { findPii } from './pii.js';
import { OBSCENITY_PHRASES, categoryOfPhrase, findProfanity } from './profanity.js';
import { decide, escalate, type Policy, type Place } from './policy.js';

const ctx: Context = { mentionsOthers: false, replyToOther: false };
const base: Policy = { categories: { personalInfo: 'delete', doxxing: 'delete', threats: 'delete', scams: 'delete', slurs: 'delete', insults: 'delete', rudeness: 'delete', directedProfanity: 'delete', profanity: 'off', sexual: 'off', invites: 'off', custom: 'delete', learned: 'log' }, exceptions: [] };
const cats = (text: string, c: Context = ctx) => [...new Set(classify(text, c).hits.map(h => h.category))].sort();
const has = (text: string, cat: Category, c: Context = ctx) => classify(text, c).hits.some(h => h.category === cat);

describe('rudeness is its own rule', () => {
  const run = (text: string, p: Policy = base) => decide(classify(text, ctx), p, { channelId: 'c1', roleIds: [] });
  it.each(['you are the most useless admin ever', 'nobody asked, you clown', 'ur such a try hard noob', 'you suck at this', 'ur trash', 'get a life', 'touch grass loser'])('%s is mild, not abusive', t => {
    const k = classify(t, { mentionsOthers: true, replyToOther: false }).hits.map(h => h.category);
    expect(k).toContain('rudeness'); expect(k).not.toContain('insults');
  });
  it.each(['you are an idiot', 'you worthless idiot', 'you absolute moron', 'ur a pathetic piece of shit'])('%s is abusive', t => {
    expect(classify(t, { mentionsOthers: true, replyToOther: false }).hits.map(h => h.category)).toContain('insults');
  });
  it('can be allowed or logged while real insults are still deleted', () => {
    const lenient = { ...base, categories: { ...base.categories, rudeness: 'off' as const } };
    expect(run('nobody asked, you clown', lenient).action).toBe('none');
    expect(run('you absolute moron', lenient).action).toBe('delete');
    const log = { ...base, categories: { ...base.categories, rudeness: 'log' as const } };
    expect(run('ur such a try hard', log).action).toBe('log');
  });
  it('mild put-downs never add strikes', () => expect(run('nobody asked, you clown').weight).toBe(0));
});

describe('swearing levels', () => {
  const swear = (text: string, level: 'all' | 'medium' | 'strong') => decide(classify(text, ctx), { ...base, categories: { ...base.categories, profanity: 'delete' }, swearLevel: level }, { channelId: 'c1', roleIds: [] }).action;
  it('"all" blocks every swear word, even a friendly one', () => { for (const t of ['this is fucking great', 'well shit', 'damn that was close', 'what the hell']) expect(swear(t, 'all'), t).toBe('delete'); });
  it('"medium" lets damn and hell through but not shit or the f-word', () => {
    expect(swear('damn that was close', 'medium')).toBe('none'); expect(swear('what the hell', 'medium')).toBe('none');
    expect(swear('well shit', 'medium')).toBe('delete'); expect(swear('this is fucking great', 'medium')).toBe('delete');
  });
  it('"strong" only blocks the strongest', () => {
    expect(swear('well shit', 'strong')).toBe('none'); expect(swear('damn', 'strong')).toBe('none');
    expect(swear('this is fucking great', 'strong')).toBe('delete');
  });
});

describe('personal information', () => {
  it.each([
    ['my number is 555-123-4567', 'phone number'], ['call (555) 123-4567 now', 'phone number'], ['+1 555 123 4567', 'phone number'],
    ['his ip is 98.45.221.7', 'ip address'], ['mail me at bob.smith@gmail.com', 'email'],
    ['4111 1111 1111 1111', 'card number'], ['ssn 123-45-6789', 'social security number'], ['he lives at 221 Baker Street', 'street address'],
  ])('finds %s', (text, kind) => expect(findPii(text).map(p => p.kind)).toContain(kind));
  it.each([
    'version 1.2.3.4.5 is out', 'v2.0.1 released', 'version 2.4.1.7 fixes the crash', 'its a 5 min drive', 'a 3 hour drive away', '1700000000',
    'id 1000000000000000002', 'at 12:30:45 today', '1234 5678 9012 3456', 'score was 10.5.3', 'call me at 5', 'room 12 on the next floor',
  ])('ignores %s', text => expect(findPii(text)).toEqual([]));
});

describe('swearing and who it is aimed at', () => {
  it('general swearing is profanity but not directed', () => {
    expect(cats('this game is fucking trash')).toEqual(['profanity']);
    expect(cats('shit happens')).toEqual(['profanity']);
  });
  it('swearing aimed at someone is directed', () => {
    expect(has('fuck you', 'directedProfanity')).toBe(true);
    expect(has('shut the fuck up', 'directedProfanity')).toBe(true);
    expect(has('you are a fucking idiot', 'directedProfanity')).toBe(true);
    expect(has('@bob this is fucking stupid', 'directedProfanity', { mentionsOthers: true, replyToOther: false })).toBe(true);
  });
  it('does not flag normal words that contain swear fragments', () => {
    expect(cats('I love the classic assassin class')).toEqual([]);
    expect(cats('Scunthorpe is a nice town')).toEqual([]);
  });
  it('catches evasion', () => {
    expect(has('fuuuuck you', 'profanity')).toBe(true);
    expect(has('what the fvck', 'profanity')).toBe(true);
    expect(has('sh1t', 'profanity')).toBe(true);
  });
});

describe('insults must be aimed at someone', () => {
  it('flags insults aimed at a person', () => {
    expect(has('you are an idiot', 'insults')).toBe(true);
    expect(has('idiot', 'insults')).toBe(true);
    expect(has('you worthless piece of garbage', 'insults')).toBe(true);
    expect(has('what a waste of space lol', 'insults', { mentionsOthers: true, replyToOther: false })).toBe(true);
  });
  it('leaves normal talk alone', () => {
    expect(cats('this movie is trash')).toEqual([]);
    expect(cats('idiot driver cut me off today in traffic')).toEqual([]);
    expect(cats('the boss fight is brutal')).toEqual([]);
    expect(cats('what a stupid bug in my code')).toEqual([]);
  });
});

describe('de-duplication and no friendliness guessing', () => {
  it('reports swearing aimed at someone once', () => expect(classify('fuck you', ctx).hits.filter(h => h.category === 'directedProfanity')).toHaveLength(1));
  it('"lol" does not change what the rules see', () => {
    expect(has('fuck you lol', 'directedProfanity')).toBe(true);
    expect(has('ur trash lol', 'rudeness')).toBe(true);
    expect(has('you suck lmao', 'rudeness')).toBe(true);
    expect(Object.keys(classify('hello', ctx))).toEqual(['hits', 'maybes']);
  });
});

describe('threats and doxxing', () => {
  it('finds them', () => {
    expect(has('kys', 'threats')).toBe(true);
    expect(has('just go kill yourself', 'threats')).toBe(true);
    expect(has("i'm going to kill you", 'threats')).toBe(true);
    expect(has('i know where you live', 'doxxing')).toBe(true);
    expect(has('we will swat you', 'doxxing')).toBe(true);
  });
  it('ignores game talk', () => {
    for (const t of ['I will kill the boss tonight in the raid', 'this game is killing me lol', 'ill find you a seat', 'swat team arrives in the movie', 'we should go find the key'])
      expect(cats(t), t).toEqual([]);
  });
});

describe('custom lists and allow list', () => {
  it('custom words and regex', () => {
    expect(classify('say banana now', ctx, { customWords: ['banana'], customRegex: [], allowWords: [] }).hits).toEqual([{ category: 'custom', term: 'banana' }]);
    expect(has('aaa123', 'custom')).toBe(false);
    expect(classify('aaa123', ctx, { customWords: [], customRegex: ['[', 'a+\\d+'], allowWords: [] }).hits.map(h => h.category)).toEqual(['custom']);
  });
  it('allow words are skipped', () => {
    expect(classify('shit happens', ctx, { customWords: [], customRegex: [], allowWords: ['shit'] }).hits).toEqual([]);
  });
});

describe('obscenity grouping', () => {
  it('is pinned to the list version the groups were made for', () => expect(OBSCENITY_PHRASES).toBe(69));
  it('groups cover each phrase once', () => {
    const counts = { slurs: 0, sexual: 0, profanity: 0 };
    for (let i = 0; i < OBSCENITY_PHRASES; i++) counts[categoryOfPhrase(i)]++;
    expect(counts).toEqual({ slurs: 15, sexual: 36, profanity: 18 });
  });
  it('ordinary swearing is profanity and explicit terms are sexual', () => {
    expect(findProfanity('fuck')[0]?.category).toBe('profanity');
    expect(findProfanity('bastard')[0]?.category).toBe('profanity');
    expect(findProfanity('penis')[0]?.category).toBe('sexual');
  });
});

describe('server policy', () => {
  const place: Place = { channelId: 'c1', roleIds: [] };
  const run = (text: string, p: Policy = base, pl: Place = place, c: Context = ctx) => decide(classify(text, c), p, pl);
  it('allows general swearing by default', () => expect(run('this is fucking great').action).toBe('none'));
  it('deletes swearing aimed at someone, with or without "lol"', () => {
    expect(run('fuck you').action).toBe('delete');
    expect(run('fuck you lol').action).toBe('delete');
  });
  it('follows the category setting exactly', () => {
    const allowed = { ...base, categories: { ...base.categories, directedProfanity: 'off' as const } };
    expect(run('fuck you', allowed).action).toBe('none');
    expect(run('fuck you lol', allowed).action).toBe('none');
    expect(run('kys', allowed).action).toBe('delete');
  });
  it('log mode records without deleting', () => expect(run('fuck you', { ...base, categories: { ...base.categories, directedProfanity: 'log' } }).action).toBe('log'));
  it('serious hits are worth more strikes', () => {
    expect(run('kys').weight).toBe(2);
    expect(run('his ip is 98.45.221.7').weight).toBe(1);
  });
});

describe('exceptions', () => {
  const ex = (e: Partial<Policy['exceptions'][number]>): Policy => ({ ...base, exceptions: [{ channels: [], roles: [], categories: ['directedProfanity', 'profanity'], mode: 'off', ...e }] });
  const run = (text: string, p: Policy, pl: Place) => decide(classify(text, ctx), p, pl).action;
  it('apply only in the listed channels', () => {
    const p = ex({ channels: ['fun'] });
    expect(run('fuck you', p, { channelId: 'fun', roleIds: [] })).toBe('none');
    expect(run('fuck you', p, { channelId: 'general', roleIds: [] })).toBe('delete');
  });
  it('apply only to the listed roles', () => {
    const p = ex({ roles: ['vip'] });
    expect(run('fuck you', p, { channelId: 'c', roleIds: ['vip', 'x'] })).toBe('none');
    expect(run('fuck you', p, { channelId: 'c', roleIds: ['x'] })).toBe('delete');
  });
  it('need the channel and the role when both are listed', () => {
    const p = ex({ channels: ['fun'], roles: ['vip'] });
    expect(run('fuck you', p, { channelId: 'fun', roleIds: ['vip'] })).toBe('none');
    expect(run('fuck you', p, { channelId: 'fun', roleIds: [] })).toBe('delete');
    expect(run('fuck you', p, { channelId: 'other', roleIds: ['vip'] })).toBe('delete');
  });
  it('only cover the categories they list', () => {
    const p = ex({ channels: ['fun'] });
    expect(run('kys', p, { channelId: 'fun', roleIds: [] })).toBe('delete');
    expect(run('you are an idiot', p, { channelId: 'fun', roleIds: [] })).toBe('delete');
  });
  it('can also be stricter than the default', () => {
    const p = ex({ channels: ['support'], categories: ['profanity'], mode: 'delete' });
    expect(run('this is fucking great', p, { channelId: 'support', roleIds: [] })).toBe('delete');
    expect(run('this is fucking great', p, { channelId: 'general', roleIds: [] })).toBe('none');
  });
  it('can only log; the last matching exception wins', () => {
    const p: Policy = { ...base, exceptions: [
      { channels: [], roles: [], categories: ['insults'], mode: 'log' },
      { channels: ['mods'], roles: [], categories: ['insults'], mode: 'off' },
    ] };
    expect(run('you are an idiot', p, { channelId: 'general', roleIds: [] })).toBe('log');
    expect(run('you are an idiot', p, { channelId: 'mods', roleIds: [] })).toBe('none');
  });
  it('explain themselves in the result', () => {
    const d = decide(classify('fuck you', ctx), ex({ channels: ['fun'] }), { channelId: 'fun', roleIds: [] });
    expect(d.outcomes.every(o => o.why.includes('exception 1'))).toBe(true);
  });
});

describe('escalation', () => {
  const e = { enabled: true, timeoutAfter: 3, timeoutMinutes: 10, longTimeoutAfter: 6, longTimeoutHours: 24 };
  it('steps up with strikes', () => {
    expect(escalate(2, e)).toBe(0);
    expect(escalate(3, e)).toBe(600);
    expect(escalate(7, e)).toBe(86400);
    expect(escalate(9, { ...e, enabled: false })).toBe(0);
  });
});

describe('scams and phishing', () => {
  it.each([
    'free nitro for everyone click here', 'claim your free nitro gift now', 'you have been selected to receive a prize', 'robux generator works 100%',
    'crypto giveaway, send 0.1 btc and get 1 back', 'go to dlscord-gift.com/abc to claim', 'steamcommunnity.com/gift/abc', 'verify your account here to avoid a ban',
  ])('flags %s', text => expect(has(text, 'scams')).toBe(true));
  it.each([
    'check discord.com/channels/123/456', 'my steam profile is steamcommunity.com/id/someone', 'free to play game on steam', 'nitro boost is great', 'giveaway tonight at 8, rules in the pinned post',
    'the gift shop was closed', 'i got a free upgrade at the hotel', 'discord.gg/abc is our server',
  ])('ignores %s', text => expect(has(text, 'scams')).toBe(false));
  it('treats server invites as their own category', () => {
    expect(has('join discord.gg/abcdef', 'invites')).toBe(true);
    expect(has('join discord.com/invite/abcdef', 'invites')).toBe(true);
    expect(has('discord is great', 'invites')).toBe(false);
  });
});

describe('leaked secrets', () => {
  const fakeToken = 'M' + 'A'.repeat(23) + '.' + 'abcdef' + '.' + 'x'.repeat(27);
  it('finds tokens and keys', () => {
    expect(findPii(`my token is ${fakeToken}`).map(p => p.kind)).toContain('token or secret');
    expect(findPii('key sk-' + 'a'.repeat(24)).map(p => p.kind)).toContain('token or secret');
    expect(findPii('AKIA' + 'A'.repeat(16)).map(p => p.kind)).toContain('token or secret');
    expect(findPii('-----BEGIN PRIVATE KEY-----').map(p => p.kind)).toContain('token or secret');
    expect(has(`token ${fakeToken}`, 'personalInfo')).toBe(true);
  });
  it('ignores normal text', () => {
    expect(findPii('my token of appreciation for the sk-ate park')).toEqual([]);
    expect(findPii('M.A.G.A.Z.I.N.E is a long word')).toEqual([]);
  });
});

describe('more threats and hostile phrasing', () => {
  it('finds self-harm and death wishes', () => {
    for (const t of ['go jump off a bridge', 'hang yourself', 'i hope you get cancer', 'drop dead', 'die in a fire', 'slit your wrists']) expect(has(t, 'threats'), t).toBe(true);
  });
  it('finds hate threats against groups but not normal talk about groups', () => {
    expect(has('those immigrants should be killed', 'threats')).toBe(true);
    for (const t of ['all women deserve respect', 'kill all the bugs in my code', 'all immigrants are welcome here', 'every gay bar in town is great', 'muslims celebrate eid today']) expect(has(t, 'threats'), t).toBe(false);
  });
  it('finds more hostile swearing', () => {
    for (const t of ['get fucked', 'go to hell', 'rot in hell', 'fuck your mom', 'suck my dick']) expect(has(t, 'directedProfanity'), t).toBe(true);
  });
  it('treats swear-word names as insults only when aimed at someone', () => {
    expect(has('you asshole', 'insults')).toBe(true);
    expect(has('ur such a douchebag', 'insults')).toBe(true);
    expect(has('you are a bitch', 'insults')).toBe(true);
    for (const t of ['my boss is such an asshole today', 'that referee is a bastard', 'what a cunt of a day', 'i spilled coffee, what a bitch of a morning']) expect(has(t, 'insults'), t).toBe(false);
  });
  it('more insults', () => {
    expect(has('you absolute buffoon', 'insults')).toBe(true);
    expect(has('such a dunce', 'insults', { mentionsOthers: true, replyToOther: false })).toBe(true);
  });
});

describe('new categories in the server policy', () => {
  const run = (text: string, p: Policy = base) => decide(classify(text, ctx), p, { channelId: 'c1', roleIds: [] });
  it('scams are deleted by default, invites allowed', () => {
    expect(run('free nitro click here').action).toBe('delete');
    expect(run('free nitro click here').weight).toBe(2);
    expect(run('join discord.gg/abcdef').action).toBe('none');
  });
  it('invites can be logged or deleted', () => {
    expect(run('join discord.gg/abcdef', { ...base, categories: { ...base.categories, invites: 'delete' } }).action).toBe('delete');
    expect(run('join discord.gg/abcdef', { ...base, categories: { ...base.categories, invites: 'log' } }).action).toBe('log');
  });
});

describe('lookalike characters and typos', () => {
  it('sees through letters from other alphabets', () => {
    expect(has('you are an іdіоt', 'insults')).toBe(true); // Cyrillic і and о
    expect(has('you are a mоrоn', 'insults')).toBe(true);
    expect(findProfanity('fuсk')[0]?.category).toBe('profanity'); // Cyrillic с
  });
  it('catches typos of strong insults', () => {
    for (const t of ['you are a dumbas', 'you pathtic loser', 'you absolute bufoon', 'ur such a jackas', 'you worthles clown']) expect(has(t, 'insults'), t).toBe(true);
  });
  it('does not turn ordinary words into insults', () => {
    for (const t of ['you are a loving person', 'you have lovers', 'the pathfinder guide helps you', 'you can use the lesser potion', 'you should disguise your base', 'thank you for the useful tips'])
      expect(has(t, 'insults'), t).toBe(false);
  });
});

describe('learned words', () => {
  it('flags words the learner picked up, but not allowed ones', () => {
    const learnedWords = new Set(['gronk']);
    const extras = { customWords: [], customRegex: [], allowWords: [], learnedWords };
    expect(classify('what a gronk', { mentionsOthers: false, replyToOther: false }, extras).hits.map(h => h.category)).toContain('learned');
    expect(classify('what a gronk', { mentionsOthers: false, replyToOther: false }, { ...extras, allowWords: ['gronk'] }).hits).toHaveLength(0);
    expect(classify('what a nice day', { mentionsOthers: false, replyToOther: false }, extras).hits).toHaveLength(0);
  });
});

describe('masked words, safe words and new threat phrasings', () => {
  const kinds = (t: string) => classify(t, { mentionsOthers: false, replyToOther: false }).hits.map(h => h.category);
  it('reads masked swearing and insults', () => {
    expect(kinds('what a b*tch')).toContain('profanity');
    expect(kinds('f**k you')).toContain('directedProfanity');
    expect(kinds('you piece of s#it')).toContain('profanity');
    expect(kinds('you are an id*ot')).toContain('insults');
  });
  it('leaves markdown and normal words alone', () => {
    for (const t of ['**bold text here**', '*italic* and __underline__', 'what a **great** day', 'use the * wildcard', 'snake_case_name works']) expect(kinds(t), t).toEqual([]);
  });
  it('does not flag names and words that merely contain a swear word', () => {
    for (const t of ['Scunthorpe is a town', 'shiitake mushrooms', 'Dick Van Dyke', 'the cockpit door', 'Penistone', 'cum laude', 'Hancock', 'I need to assess the class', 'a cucumber salad', 'the Sussex coast'])
      expect(kinds(t), t).toEqual([]);
  });
  it('still catches a real insult next to a safe word', () => {
    expect(kinds('you absolute idiot, go to Scunthorpe')).toContain('insults');
  });
  it('catches more ways to tell someone to die', () => {
    for (const t of ['you should just die', 'i hope you rot', 'the world would be better without you', 'do us all a favor and disappear']) expect(kinds(t), t).toContain('threats');
  });
});
