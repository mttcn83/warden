// warden --feedback: tell the developer about a bug or an idea, from the terminal.
import { VERSION } from './env.js';
import { banner, ok, fail, warn, info, ask, choose, confirm, printBox, dim, bold, interactive } from './ui.js';
import { MAX_MESSAGE, buildReport, previewText, destination, sendReport, saveUnsent } from './feedback.js';

/** options: { message, kind, contact, diagnostics } from the command line. Anything missing is asked for. */
export async function feedbackCommand(options = {}) {
  await banner(VERSION, 'send feedback');
  const asked = !options.message;
  if (asked && !interactive) { console.log('  Give the message on the command line, for example:  warden --feedback "the panel froze when I saved"\n'); process.exitCode = 1; return; }
  if (!destination()) warn('This copy of Warden has no feedback address set up, so I will save your note to a file instead of sending it.');

  let kind = options.kind, message = options.message ?? '', contact = options.contact ?? '', withDiagnostics = !!options.diagnostics;
  if (asked) {
    console.log(`  Found a bug or have an idea? It goes straight to the developer. ${dim('You see everything before it is sent.')}\n`);
    kind = ['bug', 'idea', 'other'][await choose('What is it?', [{ label: 'A bug', desc: 'something broke or behaved strangely' }, { label: 'An idea', desc: 'something you wish it did' }, { label: 'Something else' }])];
    console.log(`\n  ${bold('Tell me what happened.')} ${dim(`Up to ${MAX_MESSAGE} characters. Press Enter on an empty line when you are done.`)}`);
    const lines = [];
    for (;;) { const l = await ask(lines.length ? '…' : 'Message', ''); if (!l && lines.length) break; if (l) lines.push(l); if (lines.join('\n').length >= MAX_MESSAGE) break; }
    message = lines.join('\n');
    contact = await ask('How can I reach you? (optional, a Discord name or email, Enter to skip)', '');
    withDiagnostics = await confirm('Include diagnostics? (version, system and the last log lines; tokens, IDs, emails and IPs are removed)', true);
  }
  const report = buildReport({ kind: kind ?? 'bug', message, contact, withDiagnostics });
  if (report.message.length < 3) { fail('Write a few words first.'); process.exitCode = 1; return; }

  console.log('');
  printBox(previewText(report).split('\n').map(l => l.slice(0, 92)), { title: 'this is exactly what will be sent', tone: 'brand' });
  console.log('');
  if (asked && !(await confirm('Send it?', true))) { console.log(dim('\n  Okay, nothing was sent.\n')); return; }

  const result = await sendReport(report);
  if (result.ok) { ok(`Sent. Thank you! ${dim('You can send another in a minute.')}`); console.log(''); return; }
  fail(result.message);
  if (result.reason === 'no-destination' || result.reason === 'network' || result.reason === 'rejected') info(`Your note was saved in ${saveUnsent(report)} so it is not lost.`);
  console.log('');
  process.exitCode = 1;
}
