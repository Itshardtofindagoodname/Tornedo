/**
 * Text editing primitives shared by the search box and modal prompts.
 */
import type { Key } from "ink";

export interface EditResult {
  value: string;
  cursor: number;
}

/** Apply a printable/editing keypress to a string at a cursor position. */
export function applyTyping(prev: string, cursor: number, input: string, key: Key): EditResult {
  let value = prev;
  let c = Math.min(Math.max(0, cursor), prev.length);

  if (key.backspace) {
    if (c > 0) {
      value = prev.slice(0, c - 1) + prev.slice(c);
      c -= 1;
    }
  } else if (key.delete) {
    if (c < prev.length) {
      value = prev.slice(0, c) + prev.slice(c + 1);
    }
  } else if (key.leftArrow) {
    c = Math.max(0, c - 1);
  } else if (key.rightArrow) {
    c = Math.min(prev.length, c + 1);
  } else if (key.home) {
    c = 0;
  } else if (key.end) {
    c = prev.length;
  } else if (input && !key.ctrl && !key.meta && !key.escape && !key.tab) {
    value = prev.slice(0, c) + input + prev.slice(c);
    c += input.length;
  }

  return { value, cursor: c };
}

/** Compute the visible window for a list so the selection stays centered. */
export function scrollWindow(selected: number, rows: number, length: number): { start: number; count: number } {
  const n = Math.max(0, length);
  if (n <= rows) return { start: 0, count: n };
  const ideal = selected - Math.floor(rows / 2);
  const start = Math.max(0, Math.min(ideal, n - rows));
  return { start, count: rows };
}
