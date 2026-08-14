/**
 * Torrent download domain model. Everything the download manager, scheduler and
 * UI reason about lives here.
 */
import type { ReleaseMetadata } from "./search.js";

export type TorrentStatus =
  | "queued"
  | "starting"
  | "downloading"
  | "paused"
  | "completed"
  | "seeding"
  | "stopped"
  | "error"
  | "checking";

export const TORRENT_STATUSES: readonly TorrentStatus[] = [
  "queued",
  "starting",
  "downloading",
  "paused",
  "completed",
  "seeding",
  "stopped",
  "error",
  "checking",
];

/** Statuses that occupy an active download slot. */
export const ACTIVE_DOWNLOAD_STATUSES: ReadonlySet<TorrentStatus> = new Set([
  "starting",
  "downloading",
  "checking",
]);

/** Statuses the engine may be serving a live handle for. */
export const ENGINE_STATUSES: ReadonlySet<TorrentStatus> = new Set([
  "starting",
  "downloading",
  "checking",
  "seeding",
]);

export interface TorrentStats {
  /** 0..1 */
  progress: number;
  downloaded: number;
  uploaded: number;
  total: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  seeds: number;
  /** ms remaining; Infinity when unknown. */
  timeRemaining: number;
  name: string;
  /** Torrent metadata is available. */
  ready: boolean;
}

/** Metadata about a torrent after its metadata parses. */
export interface TorrentMeta {
  name: string;
  total: number;
  files: number;
  /** Raw .torrent bencode, persisted for re-seeding. */
  torrentFile?: Uint8Array;
}

export interface TorrentItem {
  /** Canonical infohash; primary key. */
  id: string;
  infohash: string;
  magnet: string;
  name: string;
  category: string | null;
  sourceId: string | null;
  /** Structured release metadata parsed at add time (best-effort). */
  metadata: ReleaseMetadata;
  /** Destination directory for this torrent's data. */
  destination: string;
  status: TorrentStatus;
  /** 0..1 */
  progress: number;
  downloaded: number;
  uploaded: number;
  size: number;
  downloadSpeed: number;
  uploadSpeed: number;
  peers: number;
  seeds: number;
  /** ms remaining; Infinity when unknown. */
  timeRemaining: number;
  /** Lower = higher priority. */
  priority: number;
  seedEnabled: boolean;
  queuedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  lastUpdated: number;
  error: string | null;
  /** Number of files once metadata is known. */
  files: number | null;
}

/** Input for adding a torrent to the manager. */
export interface AddTorrentInput {
  infohash: string;
  magnet: string;
  name: string;
  category?: string | null;
  sourceId?: string | null;
  /** Best-effort parsed release metadata. */
  metadata?: ReleaseMetadata;
  destination?: string;
  priority?: number;
  seedEnabled?: boolean;
  size?: number;
}

/** Summary counts for the downloads view. */
export interface DownloadSummary {
  active: number;
  queued: number;
  paused: number;
  completed: number;
  seeding: number;
  error: number;
  totalDownloadSpeed: number;
  totalUploadSpeed: number;
}