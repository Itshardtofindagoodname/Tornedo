/**
 * Visual language for the terminal UI. A single very-dark, neutral palette with
 * a warm electric yellow/orange accent (the Tornedo lightning identity). The
 * accent is used sparingly — selection, the wordmark, focused controls and
 * progress emphasis. Most of the interface stays in soft grays.
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
  subtext: "#a6a6b0",
  dim: "#6f6f7a",
  faint: "#3c3c45",

  /** Warm electric yellow — the Tornedo lightning accent. */
  accent: "#f2c14e",
  accentBright: "#ffd97a",
  accentDim: "#8f7225",

  /** Restrained semantic colors. */
  amber: "#d9a441",
  orange: "#e8893b",
  green: "#7fbf7f",
  red: "#d96a5f",

  /** Muted supporting colors (never bright blue). */
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