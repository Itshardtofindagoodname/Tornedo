/**
 * Map Ink key events to the logical actions configured in TornedoConfig
 * keybindings. Ink's `useInput` delivers `(input, key)`; we turn that into the
 * same label space the config uses (e.g. "up", "ctrl+f", "shift+d", "enter",
 * "esc", "?") and match it against the user's bindings.
 */
import type { Key } from "ink";
import type { KeyAction } from "../config/config.js";

export type { Key };

/**
 * Produce a canonical label for an Ink key event, or `null` when the event has
 * no label (e.g. a bare modifier release).
 */
export function labelForKey(input: string, key: Key): string | null {
  if (key.ctrl) {
    if (input && input.length === 1) return `ctrl+${input.toLowerCase()}`;
    return null;
  }
  if (key.meta) {
    if (input && input.length === 1) return `meta+${input.toLowerCase()}`;
    return null;
  }
  if (key.upArrow) return "up";
  if (key.downArrow) return "down";
  if (key.leftArrow) return "left";
  if (key.rightArrow) return "right";
  if (key.pageUp) return "pageup";
  if (key.pageDown) return "pagedown";
  if (key.home) return "home";
  if (key.end) return "end";
  if (key.return) return "enter";
  if (key.escape) return "esc";
  if (key.tab) return "tab";
  if (key.delete) return "delete";
  if (key.backspace) return "backspace";
  if (input) {
    if (input.length === 1) {
      const upper = input.toUpperCase();
      if (upper === input && input !== input.toLowerCase()) {
        // Uppercase letter -> "shift+d"; punctuation like "?" stays literal.
        return `shift+${input.toLowerCase()}`;
      }
    }
    return input;
  }
  return null;
}

/** Match an Ink key event against the configured bindings. */
export function matchKey(
  bindings: Partial<Record<KeyAction, string[]>>,
  input: string,
  key: Key,
): KeyAction | null {
  const label = labelForKey(input, key);
  if (!label) return null;
  const candidates = new Set<string>([label, input].filter(Boolean));
  for (const action of Object.keys(bindings) as KeyAction[]) {
    const labels = bindings[action];
    if (!labels) continue;
    for (const bound of labels) {
      if (candidates.has(bound)) return action;
    }
  }
  return null;
}

/** First configured binding for an action, used in on-screen hints. */
export function firstKey(
  bindings: Partial<Record<KeyAction, string[]>>,
  action: KeyAction,
  fallback: string,
): string {
  const list = bindings[action];
  const raw = list && list.length > 0 ? list[0]! : fallback;
  if (raw.startsWith("shift+")) return raw.slice("shift+".length).toUpperCase();
  return raw;
}