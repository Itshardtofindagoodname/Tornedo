/**
 * Presentation helpers: stable colors for categories/statuses and small
 * text-builder functions used by the list views.
 */
import type { MediaCategory } from "../model/search.js";
import type { TorrentStatus } from "../model/torrent.js";
import { palette } from "./theme.js";

const CATEGORY_COLORS: Record<MediaCategory, string> = {
  Movie: palette.magenta,
  TV: palette.cyan,
  Anime: palette.green,
  Music: palette.yellow,
  Podcast: palette.teal,
  Audiobook: palette.orange,
  Game: palette.red,
  Other: palette.dim,
};

export function categoryColor(category: MediaCategory): string {
  return CATEGORY_COLORS[category] ?? palette.dim;
}

export function categoryTag(category: MediaCategory): string {
  return category.toUpperCase().padEnd(4);
}

const STATUS_COLORS: Record<TorrentStatus, string> = {
  queued: palette.dim,
  waiting_metadata: palette.yellow,
  starting: palette.yellow,
  downloading: palette.cyan,
  stalled: palette.dim,
  checking: palette.yellow,
  paused: palette.orange,
  completed: palette.green,
  seeding: palette.teal,
  stopped: palette.dim,
  error: palette.red,
};

export function statusColor(status: TorrentStatus): string {
  return STATUS_COLORS[status] ?? palette.dim;
}

/** Single uppercase glyph used as a leading status marker in download rows. */
export function statusGlyph(status: TorrentStatus): string {
  switch (status) {
    case "downloading":
      return "↓";
    case "seeding":
      return "↑";
    case "queued":
      return "·";
    case "starting":
    case "waiting_metadata":
    case "checking":
      return "~";
    case "paused":
      return "‖";
    case "stalled":
      return "⚠";
    case "completed":
      return "✓";
    case "error":
      return "!";
    case "stopped":
      return "·";
    default:
      return "·";
  }
}

export function sourceColor(sourceId: string): string {
  const n = [...sourceId].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const colors = [palette.cyan, palette.green, palette.magenta, palette.yellow, palette.teal, palette.accent];
  return colors[n % colors.length]!;
}
