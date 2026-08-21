/**
 * Visual language for the terminal UI. A warm yellow monochrome palette with
 * the Tornedo lightning identity. Secondary, dim, and faint text are rendered
 * in yellow at varying brightness so every layer of text is clearly legible
 * against the dark background.
 *
 * All colors are truecolor hex values; Ink degrades gracefully on 256-color
 * terminals. The same information is always carried by glyphs and typography,
 * never by color alone.
 */
export const palette = {
  bg: "#0e0e11",
  surface: "#16161a",
  surfaceAlt: "#1c1c22",
  border: "#26262e",
  text: "#e8e8ea",
  subtext: "#d4b44a",
  dim: "#c9a33a",
  faint: "#a88530",

  /** Warm electric yellow — the Tornedo lightning accent. */
  accent: "#f2c14e",
  accentBright: "#ffd97a",
  accentDim: "#8f7225",

  /** Semantic colors. */
  amber: "#d9a441",
  orange: "#e8893b",
  green: "#7fbf7f",
  red: "#d96a5f",

  /** Supporting colors (never bright blue). */
  teal: "#5cbea8",
  cyan: "#5fb0c0",
  magenta: "#a98cc4",
} as const;

export type PaletteKey = keyof typeof palette;

/** Braille spinner frames; index advances on a timer. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Filled/empty progress bar cells. */
export const BAR_FILLED = "━";
export const BAR_EMPTY = "░";

/** Generic fallback spinner for low-color terminals (degrades from braille). */
export const SPINNER_FALLBACK = ["|", "/", "-", "\\"] as const;