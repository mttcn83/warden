// Run the attack simulation from the command line: npx tsx bench/simulate.ts [attackers] [burst|waves|drip]
import { defaultGuildConfig } from '../src/core/config.js';
import { simulateAttack } from '../src/sim/attack.js';
const cfg = defaultGuildConfig();
const r = await simulateAttack(cfg.raid, cfg.guard, { attackers: Number(process.argv[2] ?? 24), style: (process.argv[3] ?? 'burst') as 'burst', adminRaiders: 3, outrankingAdmin: false, messagesPerBot: 5, innocents: 2, seed: 1 });
console.log(r.verdict.toUpperCase(), JSON.stringify(r.stats));
r.checks.forEach(c => console.log(c.pass ? '  ok  ' : '  FAIL', c.label, '-', c.detail));
console.log(r.events.length, 'events; first detected:', r.events.find(e => e.kind === 'detected')?.text);
