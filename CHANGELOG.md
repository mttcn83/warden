# Changelog

## 0.1.0-beta
First public release (beta).
- **Word filter** (edited messages are checked too) with per-rule actions (Allow / Log / Delete), strictness levels (Relaxed, Standard, Strict), a swearing level, rudeness as its own rule, exceptions per channel or role, strikes and gentle timeouts, a "needs a look" tier that tells moderators instead of punishing, and optional adaptive learning. No AI model: plain, editable rules.
- **Spam protection** with rate, repeat and near-identical detection, mention spam, shouting, emoji walls and zalgo; deletes everything a caught person just sent; stricter for brand-new members.
- **Raid protection** for bursts and slow drips, one count per account (so Kevin rejoining never triggers it), established accounts let through, every raider message deleted, a same-text catch and history sweeps, invites paused.
- **Admin guard** focused on whoever let the raiders in, acting during the raid once the evidence is clear, with the reasons shown.
- **Control panel** on `127.0.0.1`: Overview with a Watch only / Protect switch, pickers for channels, roles and people, Logs tab, Test it with examples, "Simulate attack", bot profile editor.
- **Private mod-log channel** created for you, `warden --activity`, `--logchannel` and a guided setup in Quick, Guided and Full modes.
- Docker image for always-on hosting.
- Panel sessions survive restarts and last 30 idle days.
