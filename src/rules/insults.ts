// Insults that are not swear words. They only count when aimed at someone (see engine.ts). Edit freely.
// STRONG ones are insults almost anywhere a person is addressed; WEAK ones are also ordinary words, so they need a clearer target.
export const STRONG_INSULTS = new Set((
  'idiot idiots moron morons moronic imbecile dumbass jackass nitwit halfwit dimwit numbskull braindead brainless dumb dumber dumbest stupid stupider stupidest ' +
  'loser losers pathetic worthless useless hopeless incompetent failure disgrace scum filth vermin parasite maggot coward liar fraud ' +
  'creep freak weirdo psycho lunatic degenerate pervert ugly ugliest disgusting repulsive revolting obnoxious insufferable ' +
  'cretin buffoon airhead bonehead blockhead knucklehead dunce ignoramus lowlife sleazebag slimeball bootlicker ' +
  // Swear words used as names for a person. Plain swearing is a separate category; these count as insults when aimed at someone.
  'asshat assclown shitstain dickwad numbnuts shitlord twatwaffle dirtbag jackwagon cumdumpster douchenozzle fucktard butthead fuckhead cuck cuckold pillock knobhead wazzock prat plonker berk twit nincompoop lamebrain birdbrain meathead doofus dingus dolt oaf simpleton twerp manchild drongo knob arse asswipe dipshit fuckwit ' +
  'asshole arsehole dickhead shithead fuckface dumbfuck motherfucker douchebag scumbag bitch bitches bastard cunt prick twat wanker tosser bellend whore slut cocksucker'
).split(/\s+/));
export const WEAK_INSULTS = new Set((
  'tryhard tryhards trash garbage joke waste clown muppet walnut bozo goon noob rat snake pig swine donkey fat gross cringe annoying simp bum nerd tool dork jerk dummy ' +
  'brat pansy sissy wimp loner bore liability neckbeard incel virgin scrub scrubs clueless dense ignorant embarrassment irrelevant fake phony leech worm cockroach fool fools'
).split(/\s+/));

/** Insult phrases: aimed at someone when a "you" is around, the message is short, or someone is mentioned. */
export const INSULT_PHRASES = ['try hard', 'try-hard', 'trash player', 'garbage player', 'terrible player', 'basement dweller', 'pick me', 'no life', 'braindead monkey', 'a-hole', 'ahole', 'shit head', 'dip shit', 'dumb ass', 'jack ass', 'dick head', 'ass hole', 'waste of space', 'piece of garbage', 'piece of trash', 'piece of shit', 'sack of shit', 'brain dead', 'dead weight', 'excuse for a human', 'pathetic excuse', 'waste of oxygen', 'no life', 'nobody likes you', 'nobody asked', 'get a life', 'touch grass'];

/** Mild put-downs. They are rude, not abusive: whether to allow them is up to the server, so they are their own rule ("rudeness"). */
export const MILD_WORDS = new Set((
  'dogwater useless incompetent hopeless boring annoying cringe clueless dense ignorant lame trash garbage joke clown muppet walnut bozo goon noob simp bum nerd tool dork jerk dummy ' +
  'tryhard tryhards scrub scrubs neckbeard incel virgin brat pansy sissy wimp loner bore liability fool fools embarrassment irrelevant fake phony weirdo loser losers coward liar'
).split(/\s+/));
export const MILD_PHRASES = new Set(['try hard', 'try-hard', 'trash player', 'garbage player', 'terrible player', 'pick me', 'no life', 'basement dweller', 'nobody asked', 'get a life', 'touch grass']);
