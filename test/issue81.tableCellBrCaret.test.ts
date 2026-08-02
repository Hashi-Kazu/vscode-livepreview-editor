import { describe, it, expect } from 'vitest';
import { insertBrAtCaret } from '../src/core/tableEdit';

describe('Issue #81 / R-22-10: insertBrAtCaret (table cell <br> insertion)', () => {
  it('inserts <br> at a collapsed caret and places the caret right after it', () => {
    const value = 'abcdef';
    const start = 3;
    const end = 3; // collapsed selection
    const result = insertBrAtCaret(value, start, end);
    expect(result.value).toBe('abc<br>def');
    expect(result.caret).toBe(start + '<br>'.length);
    expect(result.caret).toBe(7);
  });

  it('replaces a non-empty selection with <br> and places the caret right after it', () => {
    const value = 'abcXYZdef';
    const start = 3;
    const end = 6; // selects "XYZ"
    const result = insertBrAtCaret(value, start, end);
    expect(result.value).toBe('abc<br>def');
    expect(result.caret).toBe(start + '<br>'.length);
    expect(result.caret).toBe(7);
  });

  it('preserves the text before and after the caret/selection', () => {
    const value = 'prefix-here-suffix';
    const start = 7; // after "prefix-"
    const end = 11; // "here"
    const result = insertBrAtCaret(value, start, end);
    expect(result.value.startsWith('prefix-')).toBe(true);
    expect(result.value.endsWith('-suffix')).toBe(true);
    expect(result.value).toBe('prefix-<br>-suffix');
  });

  it('does not mutate its inputs', () => {
    const value = 'hello world';
    const original = value;
    insertBrAtCaret(value, 5, 5);
    expect(value).toBe(original);
  });

  it('handles insertion at the very start and very end of the value', () => {
    const value = 'text';
    const atStart = insertBrAtCaret(value, 0, 0);
    expect(atStart.value).toBe('<br>text');
    expect(atStart.caret).toBe(4);

    const atEnd = insertBrAtCaret(value, value.length, value.length);
    expect(atEnd.value).toBe('text<br>');
    expect(atEnd.caret).toBe(8);
  });
});
