import { describe, expect, it } from 'vitest';
// The CLI is plain JavaScript (no build step), so it has no type declarations.
// @ts-ignore
import { ART, box, gradient, stripAnsi, visibleLength, tty } from '../../bin/ui.js';

describe('CLI look and feel', () => {
  it('the wordmark has 6 equal-width rows', () => {
    expect(ART).toHaveLength(6);
    const widths = new Set((ART as string[]).map(l => [...l].length));
    expect(widths.size).toBe(1);
  });
  it('boxes are perfectly rectangular, whatever the content', () => {
    const lines = box(['short', 'a much longer line of text here', ''], { title: 'title' }).map((l: string) => visibleLength(l));
    expect(new Set(lines).size).toBe(1);
    for (const tone of ['brand', 'ok', 'warn', 'fail']) expect(new Set(box(['x', 'yy'], { tone }).map((l: string) => visibleLength(l))).size).toBe(1);
  });
  it('colored text measures the same as plain text', () => {
    expect(visibleLength('\x1b[31mred\x1b[0m')).toBe(3);
    expect(stripAnsi('\x1b[38;2;1;2;3mhi\x1b[0m')).toBe('hi');
  });
  it('is plain text when the output is not a terminal', () => {
    if (!tty) expect(gradient('hello world')).toBe('hello world');
    expect(stripAnsi(gradient('hello world'))).toBe('hello world');
  });
});

// @ts-ignore
import { wrap } from '../../bin/help.js';
// @ts-ignore
import { HELP, parseUsage } from '../../bin/commands.js';

describe('help menu', () => {
  it('wraps text to the width without losing words', () => {
    const lines: string[] = wrap('one two three four five six seven eight nine ten', 14);
    expect(lines.every(l => l.length <= 14)).toBe(true);
    expect(lines.join(' ')).toBe('one two three four five six seven eight nine ten');
  });
  it('every command has a plain-language line and no emoji', () => {
    for (const h of HELP) {
      expect(h.short, h.usage).toBeTruthy();
      expect(/\p{Extended_Pictographic}/u.test(h.short + h.usage), h.usage).toBe(false);
    }
  });
  it('splits a usage into its long and short forms', () => {
    expect(parseUsage('warden --setup  (-s)')).toEqual({ long: '--setup', short: '-s' });
    expect(parseUsage('warden --run')).toEqual({ long: '--run', short: '' });
  });
});
