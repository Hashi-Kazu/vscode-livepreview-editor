import { describe, it, expect } from 'vitest';
import { classifyTableWidgetPress } from '../src/core/editing';

// R-22-08 classifyTableWidgetPress (Issue #82): a mousedown inside an already-open
// table cell `<input>` must be left to native browser behaviour (caret placed at
// the clicked position, drag selection allowed) instead of always reopening the
// cell editor with the caret forced to the end (#79). A press outside the input
// still begins editing (caret-at-end) or is swallowed, exactly as before.
describe('R-22-08 classifyTableWidgetPress', () => {
  it('routes a primary-button press inside the open cell input to native handling', () => {
    expect(classifyTableWidgetPress({ insideCellInput: true, button: 0 })).toBe('cell-input-native');
  });

  it('routes a secondary-button press inside the open cell input to native handling too', () => {
    expect(classifyTableWidgetPress({ insideCellInput: true, button: 2 })).toBe('cell-input-native');
  });

  it('begins cell edit on a primary-button press outside the input', () => {
    expect(classifyTableWidgetPress({ insideCellInput: false, button: 0 })).toBe('begin-cell-edit');
  });

  it('swallows a secondary-button press outside the input', () => {
    expect(classifyTableWidgetPress({ insideCellInput: false, button: 2 })).toBe('swallow');
  });
});
