/**
 * Presentation helpers: stable colors for categories/statuses, glyphs for
 * download states, and source-health markers. Presentation only — every value
 * is derived from real application state.
 */
import type { MediaCategory } from "../model/search.js";
import type { SourceHealth } from "../app/search-service.js";
import type { TorrentStatus } from "../model/torrent.js";
import { palette } from "./theme.js";
import type { DownloadUiState } from "./state.js";

const CATEGORY_COLORS: Record<MediaCategory, string> = {
  Movie: palette.magenta,
  TV: palette.cyan,
  Anime: palette.green,
  Music: palette.amber,
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
  waiting_metadata: palette.accent,
  starting: palette.accent,
  ready: palette.green,
  downloading: palette.accent,
  stalled: palette.amber,
  checking: palette.amber,
  paused: palette.orange,
  completed: palette.green,
  seeding: palette.teal,
  stopped: palette.dim,
  error: palette.red,
};

export function statusColor(status: TorrentStatus): string {
  return STATUS_COLORS[status] ?? palette.dim;
}

/** Color for a derived UI download state (used by badges/cards). */
export function stateColor(state: DownloadUiState): string {
  switch (state.kind) {
    case "downloading":
      return palette.accent;
    case "waitingPeers":
    case "resolvingMetadata":
    case "metadataReady":
    case "checking":
      return palette.amber;
    case "metadataUnavailable":
      return palette.orange;
    case "paused":
    case "stopped":
      return palette.dim;
    case "completed":
      return palette.green;
    case "seeding":
      return palette.teal;
    case "queued":
      return palette.dim;
    case "failed":
      return palette.red;
  }
}

/** Single glyph used as a leading state marker in download rows/cards. */
export function stateGlyph(state: DownloadUiState): string {
  switch (state.kind) {
    case "downloading":
      return "↓";
    case "seeding":
      return "↑";
    case "queued":
    case "stopped":
      return "·";
    case "resolvingMetadata":
    case "metadataReady":
    case "waitingPeers":
    case "checking":
      return "◌";
    case "metadataUnavailable":
      return "⚠";
    case "paused":
      return "‖";
    case "completed":
      return "✓";
    case "failed":
      return "!";
  }
}

/** Raw backend status glyph, used only inside diagnostics. */
export function statusGlyph(status: TorrentStatus): string {
  return stateGlyph(rawStatusState(status));
}

function rawStatusState(status: TorrentStatus): DownloadUiState {
  switch (status) {
    case "downloading":
      return { kind: "downloading" };
    case "seeding":
      return { kind: "seeding" };
    case "queued":
      return { kind: "queued" };
    case "paused":
      return { kind: "paused" };
    case "completed":
      return { kind: "completed" };
    case "stopped":
      return { kind: "stopped" };
    case "error":
      return { kind: "failed", message: "" };
    case "checking":
      return { kind: "checking" };
    case "stalled":
      return { kind: "waitingPeers" };
    default:
      return { kind: "resolvingMetadata" };
  }
}

/** ● healthy · ◐ degraded · ○ unavailable — the source-health vocabulary. */
export function sourceGlyph(health: SourceHealth): string {
  switch (health) {
    case "healthy":
      return "●";
    case "working":
      return "◐";
    case "degraded":
      return "◐";
    case "unsupported":
      return "○";
    case "failed":
      return "○";
    case "idle":
      return "○";
    default:
      return "○";
  }
}

export function sourceHealthColor(health: SourceHealth): string {
  switch (health) {
    case "healthy":
    case "working":
      return palette.green;
    case "degraded":
      return palette.amber;
    case "unsupported":
    case "idle":
      return palette.dim;
    case "failed":
      return palette.red;
    default:
      return palette.dim;
  }
}

export function sourceHealthLabel(health: SourceHealth): string {
  switch (health) {
    case "healthy":
      return "healthy";
    case "working":
      return "working";
    case "degraded":
      return "degraded";
    case "unsupported":
      return "unsupported";
    case "idle":
      return "idle";
    case "failed":
      return "unavailable";
    default:
      return "unknown";
  }
}

export function sourceColor(sourceId: string): string {
  const n = [...sourceId].reduce((acc, c) => acc + c.charCodeAt(0), 0);
  const colors = [palette.teal, palette.cyan, palette.magenta, palette.amber, palette.green, palette.orange];
  return colors[n % colors.length]!;
}