import { describe, expect, it } from 'vitest';
import { removalNotice } from './actions.js';

const msg = (content: string) => ({ author: { id: '111' }, channelId: '222', content, url: 'https://discord.com/x' }) as never;

describe('mod-log notices', () => {
  it('says who, where, why and what was done', () => {
    const t = removalNotice(msg('you absolute idiot'), 'filter', 'insults "idiot"', ['deleted message']);
    expect(t).toContain('<@111>');
    expect(t).toContain('<#222>');
    expect(t).toContain('insults "idiot"');
    expect(t).toContain('deleted message');
    expect(t).toContain('`you absolute idiot`');
  });
  it('never repeats personal information or address details in the log', () => {
    expect(removalNotice(msg('he lives at 5 Oak Street'), 'filter', 'doxxing "address"', ['deleted message'])).not.toContain('Oak');
    expect(removalNotice(msg('my number is 555-0100'), 'filter', 'personalInfo "phone"', [])).not.toContain('555');
  });
  it('cannot be turned into a clickable or markdown-breaking line', () => {
    const t = removalNotice(msg('`` hi\nhttps://evil.example'), 'filter', 'scams "link"', []);
    expect(t.split('\n').filter(l => l.startsWith('>'))).toHaveLength(1);
    expect(t).not.toContain('``');
  });
});
