/**
 * Terminal poster rendering: decode PNG (pngjs) / JPEG (jpeg-js) images into
 * RGBA buffers, downscale them to a target cell grid with box averaging, and
 * encode each cell as an upper/lower half-block or a style-only space.
 *
 * Each terminal row paints two image pixel rows (via "▀"/"▄"), so a poster
 * `rows` high covers `rows * 2` pixel rows. Frames that are entirely a single
 * color collapse into a plain background space (saves rendering cells).
 */
import { PNG } from "pngjs";
import * as jpeg from "jpeg-js";

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8Array; // RGBA, 4 bytes per pixel
}

export type CellColor = string | null;

export interface BlockSpan {
  text: string;
  color: string | null;
  bg: string | null;
}

export interface BlockRow {
  spans: BlockSpan[];
  /** Plain-text row for accessibility/non-truecolor fallback. */
  text: string;
}

export function isPng(buf: Uint8Array): boolean {
  return buf.length >= 8 && buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47;
}

export function isJpeg(buf: Uint8Array): boolean {
  return buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

export function decodeImage(input: Uint8Array): RgbaImage | null {
  const buf = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
  if (isPng(buf)) {
    const png = PNG.sync.read(buf);
    return { width: png.width, height: png.height, data: new Uint8Array(png.data.buffer, png.data.byteOffset, png.data.byteLength) };
  }
  if (isJpeg(buf)) {
    const decoded = jpeg.decode(buf, { useTArray: true, formatAsRGBA: true }) as unknown as {
      width: number;
      height: number;
      data: Uint8Array;
    };
    return { width: decoded.width, height: decoded.height, data: decoded.data };
  }
  return null;
}

/**
 * Box-average downsample of the RGBA image into a cols × (rows*2) pixel grid.
 *
 * The source is first fit into the grid preserving its aspect ratio ("contain")
 * and centered, so non-2:3 artwork is letterboxed instead of squashed - the
 * same behavior ratatui-image gives in the reference. Coverage alpha is stored
 * as 0..255 per cell so partially-covered edge cells blend instead of popping.
 */
function sampleGrid(img: RgbaImage, cols: number, rows: number, contain = true): Uint8Array {
  const gh = rows * 2; // two pixel rows are painted per terminal row
  const out = new Uint8Array(cols * gh * 4);
  if (cols <= 0 || rows <= 0) return out;
  // Uniform scale fits the source inside / covers the pillars of the grid.
  const scale = contain ? Math.min(cols / img.width, gh / img.height) : Math.max(cols / img.width, gh / img.height);
  const fw = Math.max(0.001, img.width * scale); // grid columns spanned
  const fh = Math.max(0.001, img.height * scale); // grid pixel rows spanned
  const fx = (cols - fw) / 2;
  const fy = (gh - fh) / 2;
  const cellW = img.width / fw; // source columns per grid column
  const cellH = img.height / fh; // source rows per grid pixel row
  for (let cy = 0; cy < gh; cy++) {
    const y0 = Math.min(img.height, Math.max(0, Math.floor((cy - fy) * cellH)));
    const y1 = Math.min(img.height, Math.max(y0, Math.ceil((cy - fy + 1) * cellH)));
    for (let cx = 0; cx < cols; cx++) {
      const x0 = Math.min(img.width, Math.max(0, Math.floor((cx - fx) * cellW)));
      const x1 = Math.min(img.width, Math.max(x0, Math.ceil((cx - fx + 1) * cellW)));
      let r = 0, g = 0, b = 0, a = 0;
      for (let y = y0; y < y1; y++) {
        const row = y * img.width * 4;
        for (let x = x0; x < x1; x++) {
          const i = row + x * 4;
          const alpha = img.data[i + 3]!;
          r += img.data[i]! * alpha;
          g += img.data[i + 1]! * alpha;
          b += img.data[i + 2]! * alpha;
          a += alpha;
        }
      }
      const outIdx = (cy * cols + cx) * 4;
      if (a === 0) {
        out[outIdx + 3] = 0;
        continue;
      }
      const area = (x1 - x0) * (y1 - y0);
      const coverage = Math.max(1, Math.min(255, Math.round((a / (area * 255)) * 255)));
      out[outIdx] = Math.round(r / a);
      out[outIdx + 1] = Math.round(g / a);
      out[outIdx + 2] = Math.round(b / a);
      out[outIdx + 3] = coverage;
    }
  }
  return out;
}

/** Truecolor terminal escape code for "r;g;b". */
export function rgb(color: [number, number, number]): string {
  return `${color[0]};${color[1]};${color[2]}`;
}

export interface RenderOptions {
  transparent: CellColor;
  /** "contain" letterboxes to preserve aspect; "cover" crops to fill. Default "contain". */
  fit?: "contain" | "cover";
}

const PERFECT = 0xff;

/**
 * Render a decoded image into `rows` terminal rows × `cols` columns. Cells that
 * are fully transparent fall back to `transparent` (terminal background).
 */
export function toBlockRows(img: RgbaImage, cols: number, rows: number, opts?: RenderOptions): BlockRow[] {
  const fallback = opts?.transparent ?? null;
  const fit = opts?.fit ?? "contain";
  const grid = sampleGrid(img, cols, rows, fit === "contain");
  const lines: BlockRow[] = [];

  for (let line = 0; line < rows; line++) {
    const spans: BlockSpan[] = [];
    let current: BlockSpan | null = null;

    for (let col = 0; col < cols; col++) {
      const topIdx = (line * 2 * cols + col) * 4;
      const bottomIdx = (((line * 2 + 1) * cols) + col) * 4;
      const hasBottom = line * 2 + 1 < rows * 2;

      const topAlpha = grid[topIdx + 3]!;
      const bottomAlpha = hasBottom ? grid[bottomIdx + 3]! : 0;

      const top = topAlpha >= PERFECT / 2 ? cellColor(grid, topIdx) : null;
      const bottom = hasBottom && bottomAlpha >= PERFECT / 2 ? cellColor(grid, bottomIdx) : null;

      let color: string | null;
      let bg: string | null;
      let char: string;
      if (top === null && bottom === null) {
        color = null;
        bg = fallback;
        char = " ";
      } else if (bottom === null || top === null) {
        // Only one visible half → use it as fg, other half as background.
        const visible = top ?? bottom!;
        color = visible;
        bg = fallback;
        char = top !== null ? "▀" : "▄";
      } else if (top === bottom) {
        color = top;
        bg = top;
        char = " ";
      } else {
        color = top;
        bg = bottom;
        char = "▀";
      }

      if (current !== null && current.color === color && current.bg === bg) {
        current.text += char;
      } else {
        current = { text: char, color, bg };
        spans.push(current);
      }
    }

    const text = spans
      .map((s) => s.text)
      .join("")
      .trimEnd();
    lines.push({ spans, text });
  }
  return lines;
}

function cellColor(grid: Uint8Array, idx: number): string | null {
  return rgb([grid[idx]!, grid[idx + 1]!, grid[idx + 2]!]);
}