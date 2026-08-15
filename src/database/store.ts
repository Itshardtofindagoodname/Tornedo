/**
 * Typed persistence accessors for the SQLite schema.
 */
import type Database from "better-sqlite3";
import type { ReleaseMetadata } from "../model/search.js";
import type { TorrentItem, TorrentStatus } from "../model/torrent.js";

export interface TorrentRow {
  id: string;
  infohash: string;
  magnet: string;
  name: string;
  category: string | null;
  source_id: string | null;
  metadata: string;
  destination: string;
  status: string;
  progress: number;
  downloaded: number;
  uploaded: number;
  size: number;
  source_size: number | null;
  torrent_size: number | null;
  download_speed: number;
  upload_speed: number;
  peers: number;
  seeds: number;
  time_remaining: number;
  priority: number;
  seed_enabled: number;
  files: number | null;
  queued_at: number;
  started_at: number | null;
  completed_at: number | null;
  last_updated: number;
  error: string | null;
}

export function rowToItem(row: TorrentRow): TorrentItem {
  let metadata: ReleaseMetadata = {};
  try {
    const parsed = JSON.parse(row.metadata) as unknown;
    if (parsed && typeof parsed === "object") metadata = parsed as ReleaseMetadata;
  } catch {
    metadata = {};
  }
  return {
    id: row.id,
    infohash: row.infohash,
    magnet: row.magnet,
    name: row.name,
    category: row.category,
    sourceId: row.source_id,
    metadata,
    destination: row.destination,
    status: row.status as TorrentStatus,
    progress: row.progress,
    downloaded: row.downloaded,
    uploaded: row.uploaded,
    size: row.size,
    sourceSize: row.source_size ?? undefined,
    torrentSize: row.torrent_size ?? undefined,
    downloadSpeed: row.download_speed,
    uploadSpeed: row.upload_speed,
    peers: row.peers,
    seeds: row.seeds,
    timeRemaining: row.time_remaining >= 0 ? row.time_remaining : Infinity,
    priority: row.priority,
    seedEnabled: row.seed_enabled !== 0,
    files: row.files,
    queuedAt: row.queued_at,
    startedAt: row.started_at,
    completedAt: row.completed_at,
    lastUpdated: row.last_updated,
    error: row.error,
  };
}

export interface TorrentPatch {
  status?: TorrentStatus;
  progress?: number;
  downloaded?: number;
  uploaded?: number;
  size?: number;
  sourceSize?: number | null;
  torrentSize?: number | null;
  downloadSpeed?: number;
  uploadSpeed?: number;
  peers?: number;
  seeds?: number;
  timeRemaining?: number;
  priority?: number;
  seedEnabled?: boolean;
  name?: string;
  category?: string | null;
  sourceId?: string | null;
  metadata?: ReleaseMetadata;
  destination?: string;
  files?: number | null;
  startedAt?: number | null;
  completedAt?: number | null;
  lastUpdated?: number;
  error?: string | null;
}

export class TorrentStore {
  private db: Database.Database;

  constructor(db: Database.Database) {
    this.db = db;
  }

  /** Run a function inside a single SQLite transaction. */
  transaction<T>(fn: () => T): T {
    const tx = this.db.transaction(fn);
    return tx();
  }

  get(id: string): TorrentItem | null {
    const row = this.db.prepare("SELECT * FROM torrents WHERE id = ?").get(id) as
      | TorrentRow
      | undefined;
    return row ? rowToItem(row) : null;
  }

  list(): TorrentItem[] {
    const rows = this.db.prepare("SELECT * FROM torrents").all() as TorrentRow[];
    return rows.map(rowToItem);
  }

  listByStatus(status: TorrentStatus): TorrentItem[] {
    const rows = this.db
      .prepare("SELECT * FROM torrents WHERE status = ? ORDER BY queued_at")
      .all(status) as TorrentRow[];
    return rows.map(rowToItem);
  }

  upsert(item: TorrentItem): void {
    this.db
      .prepare(
        `INSERT INTO torrents (
          id, infohash, magnet, name, category, source_id, metadata, destination,
          status, progress, downloaded, uploaded, size, source_size, torrent_size,
          download_speed, upload_speed,
          peers, seeds, time_remaining, priority, seed_enabled, files, queued_at,
          started_at, completed_at, last_updated, error
        ) VALUES (
          @id, @infohash, @magnet, @name, @category, @sourceId, @metadata, @destination,
          @status, @progress, @downloaded, @uploaded, @size, @sourceSize, @torrentSize,
          @downloadSpeed, @uploadSpeed,
          @peers, @seeds, @timeRemaining, @priority, @seedEnabled, @files, @queuedAt,
          @startedAt, @completedAt, @lastUpdated, @error
        )
        ON CONFLICT(id) DO UPDATE SET
          infohash = excluded.infohash,
          magnet = excluded.magnet,
          name = excluded.name,
          category = excluded.category,
          source_id = excluded.source_id,
          metadata = excluded.metadata,
          destination = excluded.destination,
          status = excluded.status,
          progress = excluded.progress,
          downloaded = excluded.downloaded,
          uploaded = excluded.uploaded,
          size = excluded.size,
          source_size = excluded.source_size,
          torrent_size = excluded.torrent_size,
          download_speed = excluded.download_speed,
          upload_speed = excluded.upload_speed,
          peers = excluded.peers,
          seeds = excluded.seeds,
          time_remaining = excluded.time_remaining,
          priority = excluded.priority,
          seed_enabled = excluded.seed_enabled,
          files = excluded.files,
          queued_at = excluded.queued_at,
          started_at = excluded.started_at,
          completed_at = excluded.completed_at,
          last_updated = excluded.last_updated,
          error = excluded.error`,
      )
      .run(this.toParams(item));
  }

  private toParams(item: TorrentItem): Record<string, unknown> {
    return {
      id: item.id,
      infohash: item.infohash,
      magnet: item.magnet,
      name: item.name,
      category: item.category,
      sourceId: item.sourceId,
      metadata: JSON.stringify(item.metadata ?? {}),
      destination: item.destination,
      status: item.status,
      progress: item.progress,
      downloaded: item.downloaded,
      uploaded: item.uploaded,
      size: item.size,
      sourceSize: item.sourceSize ?? null,
      torrentSize: item.torrentSize ?? null,
      downloadSpeed: item.downloadSpeed,
      uploadSpeed: item.uploadSpeed,
      peers: item.peers,
      seeds: item.seeds,
      timeRemaining: Number.isFinite(item.timeRemaining) ? item.timeRemaining : -1,
      priority: item.priority,
      seedEnabled: item.seedEnabled ? 1 : 0,
      files: item.files,
      queuedAt: item.queuedAt,
      startedAt: item.startedAt,
      completedAt: item.completedAt,
      lastUpdated: item.lastUpdated,
      error: item.error,
    };
  }

  patch(id: string, patch: TorrentPatch): void {
    const existing = this.get(id);
    if (!existing) return;
    const merged: TorrentItem = { ...existing };
    if (patch.status !== undefined) merged.status = patch.status;
    if (patch.progress !== undefined) merged.progress = patch.progress;
    if (patch.downloaded !== undefined) merged.downloaded = patch.downloaded;
    if (patch.uploaded !== undefined) merged.uploaded = patch.uploaded;
    if (patch.size !== undefined) merged.size = patch.size;
    if (patch.sourceSize !== undefined) merged.sourceSize = patch.sourceSize ?? undefined;
    if (patch.torrentSize !== undefined) merged.torrentSize = patch.torrentSize ?? undefined;
    if (patch.downloadSpeed !== undefined) merged.downloadSpeed = patch.downloadSpeed;
    if (patch.uploadSpeed !== undefined) merged.uploadSpeed = patch.uploadSpeed;
    if (patch.peers !== undefined) merged.peers = patch.peers;
    if (patch.seeds !== undefined) merged.seeds = patch.seeds;
    if (patch.timeRemaining !== undefined) merged.timeRemaining = patch.timeRemaining;
    if (patch.priority !== undefined) merged.priority = patch.priority;
    if (patch.seedEnabled !== undefined) merged.seedEnabled = patch.seedEnabled;
    if (patch.name !== undefined) merged.name = patch.name;
    if (patch.category !== undefined) merged.category = patch.category;
    if (patch.sourceId !== undefined) merged.sourceId = patch.sourceId;
    if (patch.metadata !== undefined) merged.metadata = patch.metadata;
    if (patch.destination !== undefined) merged.destination = patch.destination;
    if (patch.files !== undefined) merged.files = patch.files;
    if (patch.startedAt !== undefined) merged.startedAt = patch.startedAt;
    if (patch.completedAt !== undefined) merged.completedAt = patch.completedAt;
    if (patch.lastUpdated !== undefined) merged.lastUpdated = patch.lastUpdated;
    if (patch.error !== undefined) merged.error = patch.error;
    this.upsert(merged);
  }

  delete(id: string): void {
    this.db.prepare("DELETE FROM torrents WHERE id = ?").run(id);
  }

  clearCompleted(): number {
    const r = this.db
      .prepare("DELETE FROM torrents WHERE status IN ('completed', 'seeding', 'stopped')")
      .run();
    return r.changes;
  }

  clearAll(): number {
    const r = this.db.prepare("DELETE FROM torrents").run();
    return r.changes;
  }

  countByStatus(): Record<TorrentStatus, number> {
    const out = {
      queued: 0,
      starting: 0,
      downloading: 0,
      paused: 0,
      completed: 0,
      seeding: 0,
      stopped: 0,
      error: 0,
      checking: 0,
    } as Record<TorrentStatus, number>;
    const rows = this.db
      .prepare("SELECT status, COUNT(*) AS n FROM torrents GROUP BY status")
      .all() as { status: string; n: number }[];
    for (const row of rows) {
      if (row.status in out) out[row.status as TorrentStatus] = row.n;
    }
    return out;
  }

  // --- torrent metadata cache (raw .torrent bencode blobs) ---

  saveCache(id: string, data: Uint8Array): void {
    this.db
      .prepare(
        `INSERT INTO torrent_cache (id, data, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at`,
      )
      .run(id, Buffer.from(data), Date.now());
  }

  loadCache(id: string): Uint8Array | null {
    const row = this.db.prepare("SELECT data FROM torrent_cache WHERE id = ?").get(id) as
      | { data: Uint8Array }
      | undefined;
    return row ? row.data : null;
  }

  deleteCache(id: string): void {
    this.db.prepare("DELETE FROM torrent_cache WHERE id = ?").run(id);
  }

  // --- key/value meta ---

  metaGet(key: string): string | null {
    const row = this.db.prepare("SELECT value FROM meta WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value ?? null;
  }

  metaSet(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO meta (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      )
      .run(key, value);
  }

  metaDelete(key: string): void {
    this.db.prepare("DELETE FROM meta WHERE key = ?").run(key);
  }

  // --- crash-recovery run marker ---------------------------------------------
  //
  // Tornedo writes a marker at startup and clears it only on a clean suspend.
  // If the process dies (SIGKILL, power loss, crash) the marker survives, so
  // the next start knows the previous run was interrupted and can reconcile
  // download state with the filesystem instead of guessing.

  setRunMarker(): void {
    this.metaSet("run:active", String(Date.now()));
  }

  clearRunMarker(): void {
    this.metaDelete("run:active");
  }

  /** True when a previous run ended without a clean shutdown. */
  hasRunMarker(): boolean {
    return this.metaGet("run:active") !== null;
  }

  // --- watch-mode processed-file state ---

  watchGet(path: string): { mtime: number; size: number; hash: string } | null {
    const row = this.db.prepare("SELECT mtime, size, hash FROM watch_files WHERE path = ?").get(path) as
      | { mtime: number; size: number; hash: string }
      | undefined;
    return row ?? null;
  }

  watchSet(path: string, state: { mtime: number; size: number; hash: string }): void {
    this.db
      .prepare(
        `INSERT INTO watch_files (path, mtime, size, hash, added_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, size = excluded.size, hash = excluded.hash`,
      )
      .run(path, state.mtime, state.size, state.hash, Date.now());
  }

  watchList(): { path: string; mtime: number; size: number; hash: string }[] {
    return this.db.prepare("SELECT path, mtime, size, hash FROM watch_files").all() as {
      path: string;
      mtime: number;
      size: number;
      hash: string;
    }[];
  }

  watchPrune(keep: Set<string>): number {
    const stmt = this.db.prepare("DELETE FROM watch_files WHERE path = ?");
    let removed = 0;
    for (const row of this.watchList()) {
      if (!keep.has(row.path)) {
        stmt.run(row.path);
        removed++;
      }
    }
    return removed;
  }
}