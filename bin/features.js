// The "what should it do" questions of the setup wizard. Each answer becomes a piece of the server's settings.
// Keep this in step with src/core/config.ts: every module and category with a decision belongs here or in presets.js.
import { choose, confirm, dim, bold, cyan, ok } from './ui.js';
import { deepMerge, STRICTNESS } from './presets.js';

const yes = (q, def = true) => confirm(q, def);

/** Plain-language tour of every feature, then a choice for each. Returns a settings patch. */
export async function askFeatures({ full }) {
  const cfg = { filter: {}, spam: {}, raid: {}, guard: {} };
  const set = patch => deepMerge(cfg, patch);

  console.log(`\n  Warden has four protections. ${bold('Each one is opt-in')}, and I will explain it before you choose.\n`);

  // ---- word filter
  console.log(`  ${cyan('Word filter')}  Reads messages and removes harmful ones: insults aimed at people, threats, slurs, scams,\n  phone numbers and addresses. Swearing that is not aimed at anyone is allowed unless you say otherwise.\n  ${dim('Edited messages are checked too, and when it is not sure (a joke or a real threat?) it tells your moderators instead of punishing.')}`);
  const filterOn = await yes('Turn the word filter on?', true);
  set({ filter: { enabled: filterOn } });
  if (filterOn) {
    const watch = await choose('Should it delete things right away?', [
      { label: 'Watch first', desc: 'It only records what it would have deleted, so you can look at the Detections page before it really deletes anything.' },
      { label: 'Delete right away', desc: 'Harmful messages vanish immediately.' },
    ]);
    set({ filter: { shadow: watch === 0 } });
    if (full) {
      const level = STRICTNESS[await choose('How strict should the word filter be?', STRICTNESS.map(l => ({ label: l.label, desc: `${l.desc} Allows: ${l.allows.join(', ')}.` })), 1)];
      set({ filter: { categories: level.categories, swearLevel: level.swearLevel } });
      ok(`${level.label}. You can change every rule one by one in the panel.`);
      const swear = await choose('What about swearing that is not aimed at anyone ("this is fucking great")?', [
        { label: 'Allow it', desc: 'Most communities are fine with it. Swearing AT someone is still removed.' },
        { label: 'Just record it', desc: 'Shows up in Detections, nothing is deleted.' },
        { label: 'Delete it', desc: 'A strict, family-friendly server.' },
      ], level.categories.profanity === 'delete' ? 2 : 0);
      set({ filter: { categories: { profanity: ['off', 'log', 'delete'][swear] } } });
      if (swear > 0) {
        const lv = await choose('Which swear words should count?', [
          { label: 'All of them', desc: 'Even damn, hell and crap.' },
          { label: 'Strong and medium', desc: 'Shit, bitch, the f-word... but damn, hell and crap are fine.' },
          { label: 'Only the strongest', desc: 'The f-word and the c-word.' },
        ]);
        set({ filter: { swearLevel: ['all', 'medium', 'strong'][lv] } });
      }
      if (await yes('Delete sexual content as well?', false)) set({ filter: { categories: { sexual: 'delete' } } });
      if (await yes('Delete invite links to other Discord servers? (stops advertising)', false)) set({ filter: { categories: { invites: 'delete' } } });
    }
    const learn = await yes('Let the filter learn new slang by itself? (It only notices words that keep appearing in abusive messages. It stores word counts, never messages.)', true);
    set({ filter: { learning: { enabled: learn } } });
  }

  // ---- spam
  console.log(`\n  ${cyan('Spam protection')}  Stops floods: too many messages too fast, the same message repeated (even with a changing number or link), mention spam,\n  shouting in capitals, emoji walls and glitchy zalgo text. When someone is caught, everything they just sent is deleted.`);
  set({ spam: { enabled: await yes('Turn spam protection on?', true) } });

  // ---- raid + guard
  console.log(`\n  ${cyan('Raid protection')}  Notices when many accounts join at once, or a slow trickle of look-alike new accounts, pauses invites,\n  deletes every message the raiders send and punishes them. ${dim('Long-standing members who just rejoin (a dropped connection) are never mistaken for raiders.')}`);
  const raidOn = await yes('Turn raid protection on?', true);
  set({ raid: { enabled: raidOn } });
  if (raidOn) {
    console.log(`\n  ${cyan('Admin guard')}  Finds whoever let the raiders in (made the invite, added a raid bot, gave a raider a role) and removes their powerful roles,\n  then strips the raiders’ roles. ${dim('It only runs after raid protection fires, and never touches the server owner.')}`);
    set({ guard: { enabled: await yes('Turn admin guard on?', true) } });
    const watch = await choose('Should raid protection and admin guard really act, or just watch?', [
      { label: 'Just watch for now', desc: 'They record what they would do. The "Simulate attack" button in the panel shows them working, and you can switch them to real later.' },
      { label: 'Act for real', desc: 'Raiders are timed out or banned and roles are removed.' },
    ]);
    set({ raid: { shadow: watch === 0 }, guard: { shadow: watch === 0 } });
  } else set({ guard: { enabled: false } });

  // ---- mod log channel
  let modLog = '';
  console.log(`\n  ${cyan('Mod-log channel')}  A private channel where Warden posts what it did and what needs a look, so your moderators can see it.`);
  let createModLog = false, pickModLog = false;
  const how = await choose('Want a log channel?', [
    { label: 'Create one for me', tag: 'recommended', desc: 'Warden makes a private channel only moderators and the bot can see. It needs the Administrator invite (or Manage Channels).' },
    { label: 'I have a channel already', desc: 'You pick it from a list of your channels. Make sure only moderators can read it.' },
    { label: 'No log channel', desc: 'Everything is still recorded in the panel under Logs.' },
  ], 0);
  if (how === 0) createModLog = true;
  else if (how === 1) {
    pickModLog = true; // Warden lists the server's channels to choose from, once it is running and connected
  }
  return { config: cfg, modLogChannel: modLog, createModLog, pickModLog };
}
