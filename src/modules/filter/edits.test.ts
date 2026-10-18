import { describe, expect, it } from 'vitest';
import { isRealEdit } from './edits.js';

describe('edited messages', () => {
  it('checks text that was really changed', () => {
    expect(isRealEdit('hello', 'his address is 12 Oak Street', true)).toBe(true);
  });
  it('checks an edit even when the old text is unknown (message sent before the bot started)', () => {
    expect(isRealEdit(null, 'something new', true)).toBe(true);
    expect(isRealEdit(undefined, 'something new', true)).toBe(true);
  });
  it('ignores updates that are not edits (link previews, pins) or leave the text alone', () => {
    expect(isRealEdit('same', 'same', true)).toBe(false);
    expect(isRealEdit('a', 'b', false)).toBe(false);
  });
  it('ignores an edit that empties the message', () => {
    expect(isRealEdit('hello', '', true)).toBe(false);
    expect(isRealEdit('hello', '   ', true)).toBe(false);
  });
});
