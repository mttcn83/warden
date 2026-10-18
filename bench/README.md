# How the word filter is tested

> **Content warning:** the data files contain insults, slurs, threats and other abusive language on purpose: they are the test cases for a moderation filter. All names, numbers and addresses in them are invented.

Everything here is **human-style validation data**, the way you would validate a fine-tuned model: messages written by hand the way people really type, labelled by what a moderator would do, then scored with the default server settings. Each file was written **blind** (before looking at how the rules work), scored **before** any change, and only then used to improve the rules.

- **1** = a moderator would remove it (abuse aimed at someone, threats, slurs, hate, scams, doxxing, personal info).
- **0** = leave it alone (banter, games, quotes and reports of abuse, self-talk, general swearing, names, code, news and history, supportive messages).
- **edge** = reasonable people disagree. Reported separately, never counted.

## Files

| File | Messages | Notes |
|---|---|---|
| `validation-final.json` | **2,927** | **Everything below combined (built by `build-final.py`). This is the final test.** |
| `validation-casual.json` | **409** | friends chatting: casual swearing, banter, hang-out plans, plus the doxxing, threats and scams that must still be caught. Scored with the Standard policy (rudeness is logged, not deleted) |
| `validation-real.json` | **198** | real insults in many styles, including polite wording ("kindly shut up, you idiot"), gaming taunts, indirect and creative put-downs, threats, hate, doxxing and scams, next to harmless near-misses. Written blind: the first run caught 77% and was then fixed, so its score is no longer a blind result. Guards against the filter getting loose |
| `validation-dev.json`, `validation-sealed.json` | 143 + 101 | first human sets |
| `validation-r1.json` ... `r6.json` | 84-124 each | gaming, everyday chat, evasion + languages, long messages and pings, reworded rechecks, slang |
| `validation-h1.json`, `h2.json`, `h3.json` | **427, 423, 444** | the hard rounds: ~3x bigger, full of look-alikes, sensitive-but-harmless topics, coded abuse, scams, 25+ languages |
| `dataset.json`, `holdout.json` | 115 + 70 | the original early sets, kept for history |

## Run it

```bash
npx tsx bench/validate-final.ts            # the final test: every message, per set and per kind, plus a speed stress test
npx tsx bench/validate-final.ts --set h3   # one set
npx tsx bench/validate-final.ts --tag scam --show
npx tsx bench/validate.ts h2 --show        # one set, with every mistake listed
npx vitest run                             # includes src/rules/validation.test.ts, which fails on any false alarm or miss
python3 bench/build-final.py               # rebuild validation-final.json after editing a set
```

## Honest numbers

Score of the rules on each **fresh** set *before* fixing anything for it (this is the real "unseen data" number), and after fixing:

| Set | Before | After |
|---|---|---|
| sealed | 0.67 | 1.00 |
| R1 gaming | 0.83 | 1.00 |
| R2 everyday | 0.76 | 1.00 |
| R3 evasion + languages | 0.71 | 1.00 |
| R4 long + pings | 0.61 | 1.00 |
| R5 rewording check | 0.73 | 1.00 |
| R6 slang | 0.69 | 1.00 |
| H1 hard | 0.71 | 1.00 |
| H2 hard | 0.77 | 1.00 |
| H3 hardest | 0.70 | 1.00 |

So the final file is a perfect score, but it is a score on data the rules were improved against. On a brand-new hard set, expect roughly 0.7-0.8 F1 first time (precision stays high, around 0.95+; most misses are creative new wording). Every round makes the rules broader, and the sets stay as a regression suite so nothing already fixed can break.

Known limits: sarcasm and context that needs the previous message, abuse in languages beyond the ~25 covered, and insults about someone who is not mentioned (these are deliberately left alone).
Rows that contain a leaked bot token use placeholders such as `<<token-a>>`; `src/testing/tokens.ts` assembles the fake token at run time (GitHub secret scanning refuses even made-up token-shaped strings).
