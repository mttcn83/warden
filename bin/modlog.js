// The private mod-log channel: a channel only moderators can see, where Warden posts what it did and what needs a look.
// Used by the setup wizard and by `warden --logchannel`. The panel API does the work (it holds the Discord connection).
import { ok, warn, info, confirm, choose, pause, printBox, dim, bold, cyan } from './ui.js';

/**
 * A short guide to the private log channel. `full` is for beginners (what shows up, who can see it, how to add a moderator,
 * how to check it is private); `compact` is a few lines for people who just want the facts.
 */
export async function modLogGuide(name, { full = false } = {}) {
  const lines = [
    `${bold(`#${name}`)} is ${bold('private')}: only moderator roles, admins and Warden can see it.`,
    '',
    `${cyan('What shows up there')}`,
    '  • messages Warden removed, and why (personal info is never repeated)',
    '  • members it timed out, raids, and what Admin guard did',
    '  • "Needs a look": messages that could be a joke or a real problem, for a human to judge',
    '',
    `${cyan('Give a moderator access')}`,
    `  Channel settings → Permissions → add their role → turn on ${bold('View Channel')}.`,
  ];
  if (full) lines.push(
    '',
    `${cyan('Check that it is private')}`,
    `  Channel settings → Permissions → ${bold('View channel as role')} → pick @everyone: it should say you cannot see it.`,
    '',
    `${cyan('Keep it private')}`,
    '  Do not give @everyone or a member role access. The panel warns you if the channel becomes public.',
    '',
    `${cyan('The full history')}`,
    `  Everything Warden does is also in the panel under ${bold('Logs')}, or run ${bold('warden --activity')}.`,
  );
  printBox(lines, { title: 'your mod log', tone: 'brand' });
  if (full) await pause('Press Enter once you have read this');
}

/** Lets the user pick an existing channel from a list (no IDs to copy). Returns how many servers were set. */
export async function pickModLog(api, servers) {
  let set = 0;
  for (const g of servers) {
    const { channels } = await api(`/api/directory/${g.id}`);
    const text = channels.filter(c => c.kind === 'text');
    if (!text.length) { warn(`${g.name}: no text channels found.`); continue; }
    const options = text.slice(0, 30).map(c => ({ label: `#${c.name}`, desc: c.parent ? `in ${c.parent}` : '' }));
    options.push({ label: 'None of these', desc: 'Skip. You can pick one in the panel later.' });
    const i = await choose(`Which channel in ${g.name} should be the mod log? Only moderators should be able to read it.`, options, 0);
    if (i >= text.length) continue;
    const cfg = await api(`/api/config/${g.id}`);
    cfg.modLogChannel = text[i].id;
    await api(`/api/config/${g.id}`, 'PUT', cfg);
    ok(`Mod log in ${bold(g.name)} is #${text[i].name}. Check that it is moderators-only.`); set++;
  }
  return set;
}

/**
 * Makes sure every server has a private mod-log channel. `auto` creates it without asking (Quick mode).
 * Returns how many channels were created.
 */
export async function offerModLog(api, servers, { auto = false, guide = 'compact' } = {}) {
  let made = 0;
  for (const g of servers) {
    let status;
    try { status = await api(`/api/modlog/${g.id}`); } catch (e) { warn(`${g.name}: could not check the mod-log channel (${e.message})`); continue; }
    if (status.exists) {
      if (status.publicTo === 'everyone') warn(`#${status.name} in ${bold(g.name)} can be read by everyone. Hide it from @everyone so only moderators see it.`);
      else info(`${g.name}: mod log is #${status.name} (private).`);
      continue;
    }
    if (!auto) {
      console.log(dim(`\n  A private channel in ${g.name} where Warden writes what it removed, who was timed out, raids, and messages that need a moderator to look.\n  It is hidden from everyone except moderator roles and the bot. Keep it moderators-only.`));
      if (!(await confirm(`Create the private log channel in ${g.name}?`, true))) { info('Skipped. Run "warden --logchannel" any time.'); continue; }
    }
    try {
      const c = await api(`/api/modlog/${g.id}`, 'POST');
      ok(`Created private #${c.name} in ${bold(g.name)}. Only moderators can see it. Keep it that way.`); made++;
      if (guide !== 'none' && made === 1) await modLogGuide(c.name, { full: guide === 'full' });
    } catch (e) { warn(`${g.name}: ${e.message.replace(/^[^:]+: /, '')}`); }
  }
  return made;
}
