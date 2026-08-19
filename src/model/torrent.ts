/**
 * Torrent download domain model. Everything the download manager, scheduler and
 * UI reason about lives here.
 */
import type { ReleaseMetadata } from "./search.js";

/**
 * Lifecycle phase of a torrent item, from the moment it is queued until it is
 * removed. The states the UI reasons about map onto these:
 *
 *   SEARCH_RESULT       -> a SearchResult, not yet added to the manager
 *   RESOLVING_METADATA  -> queued / waiting_metadata / starting
 *   READY               -> metadata received; store ready, download not started
 *   DOWNLOADING         -> downloading / stalled / checking
 *   PAUSED              -> paused
 *   COMPLETED           -> completed / stopped
 *   SEEDING             -> seeding
 *   FAILED              -> error
 */
export type TorrentStatus =
  | "queued"
  | "waiting_metadata"
  | "starting"
  | "ready"
  | "downloading"
  | "stalled"
  | "paused"
  | "completed"
  | "seeding"
  | "stopped"
  | "error"
  | "checking";

export const TORRENT_STATUSES: readonly TorrentStatus[] = [
  "queued",
  "waiting_metadata",
  "starting",
  "ready",
  "downloading",
  "stalled",
  "paused",
  "completed",
  "seeding",
  "stopped",
  "error",
  "checking",
];

/** Statuses that occupy an active download slot. */
export const ACTIVE_DOWNLOAD_STATUSES: ReadonlySet<TorrentStatus> = new Set([
  "waiting_metadata",
  "starting",
  "ready",
  "downloading",
  "checking",
]);

/** Statuses the engine may be serving a live handle for. */
export const ENGINE_STATUSES: ReadonlySet<TorrentStatus> = new Set([
  "waiting_metadata",
  "starting",
  "ready",
  "downloading",
  "checking",
  "seeding",
]);

/** True once torrent metadata (name/total/files) is actually known. */
export function metadataKnown(item: { torrentSize?: number; files?: number | null; status: TorrentStatus }): boolean {
  return item.torrentSize !== undefined || item.files !== null || item.status === "ready";
}

/** Live discovery and metadata-exchange telemetry for the current engine session. */
export interface TorrentDiagnostics {
  magnetValid: boolean;
  infohashPresent: boolean;
  magnetUri: string;
  displayName: string;
  trackerUrls: string[];
  trackerTotal: number;
  trackerHealthy: number;
  /**
   * DHT lifecycle label. "ready" means the UDP socket is bound AND the library
   * reported bootstrap complete; it says nothing about routing-table health
   * (see dhtRoutingTable/dhtRoutingNodes for that).
   */
  dht: "disabled" | "starting" | "listening" | "bootstrapping" | "ready" | "failed";
  /** DHT was enabled for this client. */
  dhtEnabled: boolean;
  /** UDP socket is bound. */
  dhtListening: boolean;
  /** DHT bootstrap populate finished (the library's `ready` event). */
  dhtBootstrapped: boolean;
  dhtPort: number | null;
  dhtAddress: string | null;
  dhtFamily: string | null;
  /** Routing table has learned at least one node. */
  dhtRoutingTable: "initializing" | "ready" | "empty";
  dhtRoutingNodes: number;
  /** DHT announce/lookup cycles completed for this torrent. */
  dhtQueries: number;
  /** Routing-table nodes learned (each implies a DHT response received). */
  dhtResponses: number;
  dhtLastQuery: number | null;
  peersDiscovered: number;
  ipv4Peers: number;
  ipv6Peers: number;
  metadata: "waiting" | "requesting" | "received" | "timeout";
  metadataRequests: number;
  metadataResponses: number;
  lastMetadataAttempt: number | null;
  nextRetry: number | null;
  metadataRetries: number;
  connection: "idle" | "discovering" | "connected" | "downloading";
  engineState: "created" | "discovering" | "metadata_received" | "destroyed";
  lastEvent: string | null;
}

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

/** One file inside a torrent, once metadata is known. */
export interface TorrentFileInfo {
  /** Relative path inside the torrent (e.g. "subs/en.srt"). */
  path: string;
  /** Size in bytes. */
  length: number;
}

/** Metadata about a torrent after its metadata parses. */
export interface TorrentMeta {
  name: string;
  total: number;
  files: number;
  /** Per-file listing (path + length), present once metadata is known. */
  fileList?: TorrentFileInfo[];
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
  /**
   * Effective size in bytes. Equals torrentSize once metadata arrives,
   * otherwise the source-reported size (sourceSize), otherwise unknown (0).
   */
  size: number;
  /** Size in bytes reported by the search source (may be known before metadata). */
  sourceSize?: number;
  /** Size in bytes from the torrent's own metadata (unknown until metadata arrives). */
  torrentSize?: number;
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
  /** Per-file listing once metadata is known. */
  fileList?: TorrentFileInfo[] | null;
  /**
   * Subset of file paths to download (relative torrent paths). When set, only
   * these files are selected in the engine; everything else is skipped. Absent
   * (or empty) means "the whole torrent".
   */
  selectedFiles?: string[] | null;
  /**
   * Transient (not persisted): the engine starts this torrent fully deselected
   * so nothing downloads until the user picks files. Consumed on first start.
   */
  startDeselected?: boolean;
  diagnostics?: TorrentDiagnostics;
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
  /**
   * Restrict the download to these file paths (relative torrent paths). When
   * present the torrent starts deselected and only the listed files download.
   */
  selectedFiles?: string[];
  /**
   * Start with every file deselected (nothing downloads until a selection is
   * applied). Used to preview files before committing to the download.
   */
  startDeselected?: boolean;
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

/**
 * What a crash recovery pass reconciled. Produced once at startup when the
 * previous run died without a clean shutdown; surfaced to the user instead of
 * silently resuming.
 */
export interface RecoveryReport {
  /** Database was opened and migrations verified. */
  database: boolean;
  /** Download state was re-read from SQLite. */
  downloadState: boolean;
  /** Torrent metadata (name/size) was available for the recovered items. */
  torrentMetadata: boolean;
  /** Existing pieces were handed to the engine for verification. */
  existingPieces: boolean;
  /** Interrupted downloads restored and resumed. */
  resumed: string[];
  /** Items detected as already complete and reconciled. */
  completed: string[];
  /** Queued downloads preserved. */
  recoveredQueued: number;
  /** Items that could not be recovered (e.g. invalid state). */
  failed: string[];
  /** Human notes (e.g. engine delegated piece verification). */
  notes: string[];
}
