/**
 * App-wide themes. Every theme maps onto Tornedo's single palette vocabulary
 * (the same 18 keys used by ui/theme.ts) so all existing UI adapts instantly.
 * The shipped themes are the 9 MovieBox-Tui palettes: the Catppuccin family
 * (Mocha, Latte, Macchiato, Frappe), Nord, Tokyo Night, Dracula, Gruvbox and
 * Rose Pine. "default" keeps the classic warm-yellow Tornedo look.
 */

export interface PaletteType {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  subtext: string;
  dim: string;
  faint: string;
  accent: string;
  accentBright: string;
  accentDim: string;
  amber: string;
  orange: string;
  green: string;
  red: string;
  teal: string;
  cyan: string;
  magenta: string;
}

export type ThemeKey = keyof PaletteType;

/* ---------------------------------------------------------------- */
/* color math (hex → rgb → hex)                                      */
/* ---------------------------------------------------------------- */

function parseHex(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  if (h.length === 3) {
    return [
      parseInt(h[0]! + h[0]!, 16),
      parseInt(h[1]! + h[1]!, 16),
      parseInt(h[2]! + h[2]!, 16),
    ];
  }
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

function mix(a: string, b: string, amount: number): string {
  const ca = parseHex(a);
  const cb = parseHex(b);
  return toHex([
    ca[0] * (1 - amount) + cb[0] * amount,
    ca[1] * (1 - amount) + cb[1] * amount,
    ca[2] * (1 - amount) + cb[2] * amount,
  ]);
}

export function lighten(hex: string, amount: number): string {
  return mix(hex, "#ffffff", amount);
}

export function darken(hex: string, amount: number): string {
  return mix(hex, "#000000", amount);
}

/* ---------------------------------------------------------------- */
/* theme ingredients (MovieBox-Tui palettes)                          */
/* ---------------------------------------------------------------- */

interface Ingredients {
  bg: string;
  surface: string;
  surfaceAlt: string;
  border: string;
  text: string;
  subtext: string;
  dim: string;
  faint: string;
  accent: string;
  green: string;
  red: string;
  amber: string;
  orange: string;
  teal: string;
  cyan: string;
  magenta: string;
}

const INGREDIENTS: Record<string, Ingredients> = {
  mocha: {
    bg: "#1e1e2e", surface: "#181825", surfaceAlt: "#11111b", border: "#45475a",
    text: "#cdd6f4", subtext: "#a6adc8", dim: "#7f849c", faint: "#6c7086",
    accent: "#f9e2af", green: "#a6e3a1", red: "#f38ba8", amber: "#fab387",
    orange: "#fe640b", teal: "#94e2d5", cyan: "#89dceb", magenta: "#cba6f7",
  },
  latte: {
    bg: "#eff1f5", surface: "#e6e9ef", surfaceAlt: "#dce0e8", border: "#bcc0cc",
    text: "#4c4f69", subtext: "#6c6f85", dim: "#8c8fa1", faint: "#9ca0b0",
    accent: "#df8e1d", green: "#40a02b", red: "#d20f39", amber: "#fe640b",
    orange: "#e64553", teal: "#179299", cyan: "#04a5e5", magenta: "#8839ef",
  },
  macchiato: {
    bg: "#24273a", surface: "#1e2030", surfaceAlt: "#181926", border: "#494d64",
    text: "#cad3f5", subtext: "#a5adcb", dim: "#8087a2", faint: "#6e738d",
    accent: "#eed49f", green: "#a6da95", red: "#ed8796", amber: "#f5a97f",
    orange: "#fe640b", teal: "#8bd5ca", cyan: "#91d7e3", magenta: "#c6a0f6",
  },
  frappe: {
    bg: "#303446", surface: "#292c3c", surfaceAlt: "#232634", border: "#51576d",
    text: "#c6d0f5", subtext: "#a5adce", dim: "#838ba7", faint: "#737994",
    accent: "#e5c890", green: "#a6d189", red: "#e78284", amber: "#ef9f76",
    orange: "#fe640b", teal: "#81c8be", cyan: "#99d1db", magenta: "#ca9ee6",
  },
  nord: {
    bg: "#2e3440", surface: "#3b4252", surfaceAlt: "#434c5e", border: "#4c566a",
    text: "#eceff4", subtext: "#d8dee9", dim: "#81a1c1", faint: "#4c566a",
    accent: "#ebcb8b", green: "#a3be8c", red: "#bf616a", amber: "#d08770",
    orange: "#d08770", teal: "#8fbcbb", cyan: "#88c0d0", magenta: "#b48ead",
  },
  tokyonight: {
    bg: "#1a1b26", surface: "#16161e", surfaceAlt: "#292e42", border: "#414868",
    text: "#c0caf5", subtext: "#a9b1d6", dim: "#565f89", faint: "#3b4261",
    accent: "#e0af68", green: "#9ece6a", red: "#f7768e", amber: "#ff9e64",
    orange: "#ff9e64", teal: "#1abc9c", cyan: "#89ddff", magenta: "#bb9af7",
  },
  dracula: {
    bg: "#282a36", surface: "#21222c", surfaceAlt: "#191a21", border: "#44475a",
    text: "#f8f8f2", subtext: "#8be9fd", dim: "#6272a4", faint: "#44475a",
    accent: "#ff79c6", green: "#50fa7b", red: "#ff5555", amber: "#f1fa8c",
    orange: "#ffb86c", teal: "#50fa7b", cyan: "#8be9fd", magenta: "#bd93f9",
  },
  gruvbox: {
    bg: "#282828", surface: "#3c3836", surfaceAlt: "#504945", border: "#665c54",
    text: "#fbf1c7", subtext: "#d5c4a1", dim: "#a89984", faint: "#7c6f64",
    accent: "#fabd2f", green: "#b8bb26", red: "#fb4934", amber: "#fe8019",
    orange: "#fe8019", teal: "#8ec07c", cyan: "#83a598", magenta: "#d3869b",
  },
  rosepine: {
    bg: "#191724", surface: "#1f1d2e", surfaceAlt: "#26233a", border: "#403d52",
    text: "#e0def4", subtext: "#908caa", dim: "#6e6a86", faint: "#403d52",
    accent: "#ebbcba", green: "#9ccfd8", red: "#eb6f92", amber: "#f6c177",
    orange: "#ebbcba", teal: "#9ccfd8", cyan: "#9ccfd8", magenta: "#c4a7e7",
  },
};

export const THEME_NAMES = ["default", ...Object.keys(INGREDIENTS)] as const;
export type ThemeName = (typeof THEME_NAMES)[number];

/* ---------------------------------------------------------------- */
/* palette building                                                  */
/* ---------------------------------------------------------------- */

function accentBrightFor(accent: string, bg: string): string {
  // Lighter accents on dark bg, darker accents on light bg.
  const [, , b] = parseHex(bg);
  return b < 128 ? lighten(accent, 0.35) : darken(accent, 0.35);
}

function accentDimFor(accent: string, bg: string): string {
  const [, , b] = parseHex(bg);
  return b < 128 ? darken(accent, 0.5) : lighten(accent, 0.5);
}

function ingredientsToPalette(ing: Ingredients): PaletteType {
  const [, , b] = parseHex(ing.bg);
  return {
    ...ing,
    accentBright: accentBrightFor(ing.accent, ing.bg),
    accentDim: accentDimFor(ing.accent, ing.bg),
    amber: ing.amber,
    orange: ing.orange,
    green: ing.green,
    red: ing.red,
    teal: ing.teal,
    cyan: ing.cyan,
    magenta: ing.magenta,
    dim: b < 128 ? ing.dim : ing.dim,
    faint: ing.faint,
  };
}

export const THEMES: Record<ThemeName, PaletteType> = {
  default: {
    bg: "#0e0e11",
    surface: "#16161a",
    surfaceAlt: "#1c1c22",
    border: "#26262e",
    text: "#e8e8ea",
    subtext: "#e8cc60",
    dim: "#ddb844",
    faint: "#cea038",
    accent: "#f2c14e",
    accentBright: "#ffd97a",
    accentDim: "#8f7225",
    amber: "#d9a441",
    orange: "#e8893b",
    green: "#7fbf7f",
    red: "#d96a5f",
    teal: "#5cbea8",
    cyan: "#5fb0c0",
    magenta: "#a98cc4",
  },
  ...(Object.fromEntries(
    Object.entries(INGREDIENTS).map(([name, ing]) => [name, ingredientsToPalette(ing)]),
  ) as Record<Exclude<ThemeName, "default">, PaletteType>),
};

export function isThemeName(name: string): name is ThemeName {
  return (THEME_NAMES as readonly string[]).includes(name);
}

export function resolveTheme(name: string | undefined | null): PaletteType {
  const candidate = name ?? "";
  const key: ThemeName = isThemeName(candidate) ? candidate : "default";
  return THEMES[key] as PaletteType;
}