/**
 * Visual language for the terminal UI. A warm yellow monochrome palette with
 * the Tornedo lightning identity. Secondary, dim, and faint text are rendered
 * in yellow at varying brightness so every layer of text is clearly legible
 * against the dark background.
 *
 * All colors are truecolor hex values; Ink degrades gracefully on 256-color
 * terminals. The same information is always carried by glyphs and typography,
 * never by color alone.
 *
 * The palette is mutable: the streaming "Watch" mode ships MovieBox-Tui
 * themes (see src/stream/themes.ts), and `applyTheme` swaps the shared
 * palette object in place so every component re-renders with the new colors.
 */
import { resolveTheme, THEME_NAMES, type ThemeName } from "../stream/themes.js";

export type PaletteKey = import("../stream/themes.js").ThemeKey;

export const palette: Record<PaletteKey, string> = { ...resolveTheme("default") };

let currentTheme: ThemeName = "default";

export function applyTheme(name: string): void {
  const resolved = resolveTheme(name);
  const key = (THEME_NAMES as readonly string[]).includes(name) ? (name as ThemeName) : "default";
  for (const k of Object.keys(palette) as PaletteKey[]) {
    palette[k] = resolved[k];
  }
  currentTheme = key;
}

export function currentThemeName(): ThemeName {
  return currentTheme;
}

export const THEME_CHOICES = THEME_NAMES;

/** Braille spinner frames; index advances on a timer. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Filled/empty progress bar cells. */
export const BAR_FILLED = "━";
export const BAR_EMPTY = "░";

/** Generic fallback spinner for low-color terminals (degrades from braille). */
export const SPINNER_FALLBACK = ["|", "/", "-", "\\"] as const;