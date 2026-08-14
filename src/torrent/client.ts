/**
 * TorrentClient abstraction. All torrent-engine access flows through this
 * interface so the rest of Tornedo never touches a library-specific object.
 */
import type { TorrentMeta, TorrentStats } from "../model/torrent.js";

export interface TorrentClientHandlers {
  onMetadata(id: string, meta: TorrentMeta): void;
  onDone(id: string): void;
  onError(id: string, message: string): void;
  onWarning(id: string, message: string): void;
  /** Optional live progress (0..1). Torrent engines poll instead; yt-dlp reports. */
  onProgress?(id: string, progress: number): void;
}

export interface TorrentClientAdd {
  /** Tornedo-side id (normally the infohash). */
  id: string;
  /** Magnet URI, bare infohash, a path to a .torrent file, or raw .torrent bytes. */
  source: string | Uint8Array;
  /** Destination directory for file data. */
  destination: string;
  /** Extra announce URLs appended to every add. */
  announce?: string[];
}

export interface SpeedLimits {
  /** Bytes/sec; 0 or negative = unlimited. */
  download: number;
  upload: number;
}

export interface ClientStats {
  downloadSpeed: number;
  uploadSpeed: number;
  active: number;
}

export interface TorrentClient {
  readonly kind: string;
  /** Start downloading (or verifying, for an existing file) a torrent. */
  add(input: TorrentClientAdd, handlers: TorrentClientHandlers): void;
  /** Pause a torrent in place (keeps the handle). */
  pause(id: string): void;
  /** Resume a paused torrent in place. */
  resume(id: string): void;
  /** Tear down a torrent handle. */
  remove(id: string): void;
  /** Latest stats for a torrent, or null when unknown. */
  get(id: string): TorrentStats | null;
  /** Aggregate client stats. */
  stats(): ClientStats;
  /** Apply global speed limits. */
  setSpeedLimits(limits: SpeedLimits): void;
  /** The TCP port accepting inbound peers (diagnostics). */
  listenPort(): number | null;
  /** Shut down the client; safe to call multiple times. */
  destroy(): void;
}