/**
 * Visual language for the terminal UI. A single dark, muted palette keeps the
 * interface calm and readable across terminal themes. All colors are truecolor
 * hex values; Ink degrades gracefully on 256-color terminals.
 */
export const palette = {
  bg: "#1a1b26",
  panel: "#24283b",
  panelAlt: "#1f2335",
  border: "#3b4261",
  text: "#c0caf5",
  subtext: "#a9b1d6",
  dim: "#565f89",
  faint: "#3b4261",
  accent: "#7aa2f7",
  accentBright: "#89b4fa",
  cyan: "#7dcfff",
  green: "#9ece6a",
  yellow: "#e0af68",
  orange: "#ff9e64",
  red: "#f7768e",
  magenta: "#bb9af7",
  teal: "#73daca",
} as const;

export type PaletteKey = keyof typeof palette;

/** Braille spinner frames; index advances on a timer. */
export const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"] as const;

/** Filled/empty progress bar cells. */
export const BAR_FILLED = "█";
export const BAR_EMPTY = "░";
