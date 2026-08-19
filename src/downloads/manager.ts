/**
 * TorrentManager: owns the in-memory torrent set, drives the engine client,
 * enforces the active-download cap, restores state from SQLite, and emits
 * change events for the UI / CLI. UI code never touches the client directly.
 */
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import type { TornedoConfig } from "../config/config.js";
import type { TorrentStore } from "../database/store.js";
import type { AddTorrentInput, DownloadSummary, RecoveryReport, TorrentDiagnostics, TorrentItem, TorrentStatus } from "../model/torrent.js";
import type { TorrentClient, TorrentClientHandlers } from "../torrent/client.js";
import { buildMagnet, mergeTrackers, parseInput, PUBLIC_TRACKERS } from "../torrent/parse.js";

const POLL_MS = 500;
/** Discovery needs more than a fixed 30-second window on cold DHT paths. */
const METADATA_RETRY_BASE_MS = 60_000;
const METADATA_RETRY_MAX_MS = 10 * 60_000;
/** Seeding grace before the stray-download detector starts watching. */
const SEED_GRACE_MS = 10_000;
const STRAY_TICKS = 3;
/** Persist progress changes at most this often. */
const PERSIST_INTERVAL_MS = 1_000;
/** Metadata known but no peers/speed for this long flips the row to STALLED. */
const STALL_THRESHOLD_MS = 30_000;

export interface TorrentManagerOptions {
  client: TorrentClient;
  store: TorrentStore;
  getConfig(): TornedoConfig;
  /**
   * When false, `init()` loads persisted items into memory but does not start
   * timers or resume downloads. Used by destructive commands (`--clear`,
   * `uninstall`) that only need to enumerate and delete items.
   */
  restoreOnInit?: boolean;
}

export interface TorrentManagerEvents {
  /** Any item changed. */
  update(): void;
  added(item: TorrentItem): void;
  removed(id: string): void;
  completed(item: TorrentItem): void;
  failed(id: string, message: string): void;
  statusChanged(item: TorrentItem, from: TorrentStatus, to: TorrentStatus): void;
  /** Emitted once at startup when a previous run crashed and state was recovered. */
  recovered(report: RecoveryReport): void;
}

export class TorrentManager extends EventEmitter {
  private items = new Map<string, TorrentItem>();
  private client: TorrentClient;
  private store: TorrentStore;
  private getConfig: () => TornedoConfig;
  private poll: ReturnType<typeof setInterval> | null = null;
  private persistTimer: ReturnType<typeof setInterval> | null = null;
  private dirty = new Set<string>();
private strayHits = new Map<string, number>();
  private startedAt = new Map<string, number>();
  private metadataRetries = new Map<string, number>();
  private stalledSince = new Map<string, number>();
  private disposed = false;
  private recovery: RecoveryReport | null = null;
  private restoreOnInit: boolean;

  constructor(opts: TorrentManagerOptions) {
    super();
    this.client = opts.client;
    this.store = opts.store;
    this.getConfig = opts.getConfig;
    this.restoreOnInit = opts.restoreOnInit ?? true;
  }

  override on(event: "update", listener: () => void): this;
  override on(event: "added", listener: (item: TorrentItem) => void): this;
  override on(event: "removed", listener: (id: string) => void): this;
  override on(event: "completed", listener: (item: TorrentItem) => void): this;
  override on(event: "failed", listener: (id: string, message: string) => void): this;
  override on(event: "statusChanged", listener: (item: TorrentItem, from: TorrentStatus, to: TorrentStatus) => void): this;
  override on(event: "recovered", listener: (report: RecoveryReport) => void): this;
  override on(event: string | symbol, listener: (...args: any[]) => void): this {
    return super.on(event, listener);
  }

  // --- lifecycle ------------------------------------------------------------

  async init(): Promise<void> {
    const cfg = this.getConfig();
    this.client.setSpeedLimits({
      download: cfg.maxDownloadSpeed,
      upload: cfg.maxUploadSpeed,
    });
    // Never let a missing/corrupt download directory stop startup: create it
    // lazily and surface a clear error per-item if it cannot be created.
    ensureDirectory(cfg.downloadDir);
    for (const item of this.store.list()) {
      this.items.set(item.id, item);
    }
    // Crash recovery: a leftover run marker means the previous run was
    // interrupted. Reconcile state with what we now know before resuming.
    const crashed = this.store.hasRunMarker();
    this.store.setRunMarker();
    if (crashed) {
      this.recoverAfterCrash();
    }
    if (!this.restoreOnInit) {
      // Destructive commands only enumerate items; do not start downloads or
      // timers.
      return;
    }
    this.restore();
    this.startTimers();
  }

  /**
   * Called once at startup when the previous run died without a clean
   * shutdown. Detects interrupted downloads, reconciles database state with
   * what the torrent engine will re-verify, resumes what can be resumed and
   * reports anything that could not be recovered. Never silently loses state.
   */
  private recoverAfterCrash(): void {
    const report: RecoveryReport = {
      database: true,
      downloadState: true,
      torrentMetadata: true,
      existingPieces: true,
      resumed: [],
      completed: [],
      recoveredQueued: 0,
      failed: [],
      notes: [],
    };
    let activeResumed = 0;
    for (const it of this.items.values()) {
      // Reconcile: active items whose progress says "done" but whose status
      // didn't reach completion before the crash.
      const size = it.torrentSize ?? it.sourceSize ?? 0;
      if (size > 0 && it.progress >= 1) {
        it.progress = 1;
        it.downloaded = size;
        it.completedAt = it.completedAt ?? Date.now();
        it.status = it.seedEnabled ? "seeding" : "completed";
        it.lastUpdated = Date.now();
        report.completed.push(it.name);
        this.markDirty(it.id, { persist: true });
        continue;
      }
      switch (it.status) {
        case "downloading":
        case "starting":
        case "waiting_metadata":
        case "ready":
        case "stalled":
        case "checking": {
          // Interrupted mid-flight: progress preserved in SQLite, pieces on
          // disk will be re-verified by the engine on resume.
          if (it.progress > 0) report.resumed.push(`${it.name} (${Math.round(it.progress * 1000) / 10}%)`);
          activeResumed++;
          break;
        }
        case "queued":
          report.recoveredQueued++;
          break;
        case "error":
          report.failed.push(`${it.name}: ${it.error ?? "error"}`);
          break;
        default:
          break;
      }
    }
    report.notes.push(
      "existing pieces handed to the engine for verification; interrupted downloads resume automatically",
    );
    if (report.resumed.length === 0 && activeResumed > 0) {
      report.resumed.push("(discovery in progress; will resume)");
    }
    this.recovery = report;
    this.emit("recovered", report);
  }

  /** Report from the startup crash-recovery pass, or null when none ran. */
  lastRecovery(): RecoveryReport | null {
    return this.recovery;
  }

  private startTimers(): void {
    this.poll = setInterval(() => this.tick(), POLL_MS);
    this.poll.unref();
    this.persistTimer = setInterval(() => this.flushPersist(), PERSIST_INTERVAL_MS);
    this.persistTimer.unref();
  }

  private stopTimers(): void {
    if (this.poll) {
      clearInterval(this.poll);
      this.poll = null;
    }
    if (this.persistTimer) {
      clearInterval(this.persistTimer);
      this.persistTimer = null;
    }
  }

  // --- reads -----------------------------------------------------------------

  list(): TorrentItem[] {
    return [...this.items.values()].sort(
      (a, b) => a.queuedAt - b.queuedAt || a.priority - b.priority,
    );
  }

  get(id: string): TorrentItem | null {
    return this.items.get(id) ?? null;
  }

  has(id: string): boolean {
    return this.items.has(id);
  }

private activeCount(): number {
    let n = 0;
    for (const it of this.items.values()) {
      if (
        it.status === "downloading" ||
        it.status === "starting" ||
        it.status === "waiting_metadata" ||
        it.status === "ready" ||
        it.status === "stalled" ||
        it.status === "checking"
      )
        n++;
    }
    return n;
  }

  private seedingCount(): number {
    let n = 0;
    for (const it of this.items.values()) {
      if (it.status === "seeding") n++;
    }
    return n;
  }

  summary(): DownloadSummary {
    const out: DownloadSummary = {
      active: 0,
      queued: 0,
      paused: 0,
      completed: 0,
      seeding: 0,
      error: 0,
      totalDownloadSpeed: 0,
      totalUploadSpeed: 0,
    };
    for (const it of this.items.values()) {
switch (it.status) {
        case "downloading":
        case "starting":
        case "waiting_metadata":
        case "ready":
        case "stalled":
        case "checking":
          out.active++;
          out.totalDownloadSpeed += it.downloadSpeed;
          out.totalUploadSpeed += it.uploadSpeed;
          break;
        case "queued":
          out.queued++;
          break;
        case "paused":
          out.paused++;
          break;
        case "seeding":
          out.seeding++;
          out.totalUploadSpeed += it.uploadSpeed;
          break;
        case "completed":
          out.completed++;
          break;
        case "error":
          out.error++;
          break;
        default:
          break;
      }
    }
    return out;
  }

  // --- adding ----------------------------------------------------------------

  add(input: AddTorrentInput): TorrentItem {
    const parsed = parseInput(input.magnet || input.infohash);
    const infohash = (parsed?.infoHash ?? input.infohash).toLowerCase();
    const id = infohash;
    const cfg = this.getConfig();

    const existing = this.items.get(id);
    if (existing) {
      if (existing.status === "error") this.retry(id);
      return existing;
    }

    const destination = input.destination ?? cfg.downloadDir;
    ensureDirectory(destination);

const item: TorrentItem = {
      id,
      infohash,
      magnet: input.magnet || parsed?.magnet || buildMagnet(infohash, input.name),
      name: input.name || parsed?.name || infohash,
      category: input.category ?? null,
      sourceId: input.sourceId ?? null,
      metadata: input.metadata ?? {},
      destination,
      status: "queued",
      progress: 0,
      downloaded: 0,
      uploaded: 0,
      // The source-reported size is a hint from the search result; the torrent
      // metadata size (torrentSize) arrives later. Never overwrite a known
      // source size with a fake zero — an unknown size stays unknown.
      sourceSize: input.size && input.size > 0 ? input.size : undefined,
      torrentSize: undefined,
      size: input.size && input.size > 0 ? input.size : 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      seeds: 0,
      timeRemaining: Infinity,
      priority: input.priority ?? 0,
      seedEnabled: input.seedEnabled ?? cfg.seedAfterComplete,
      queuedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      lastUpdated: Date.now(),
      error: null,
      files: null,
      fileList: null,
      selectedFiles: input.selectedFiles && input.selectedFiles.length > 0 ? [...input.selectedFiles] : null,
      startDeselected: input.startDeselected ?? false,
      diagnostics: initialDiagnostics(input.magnet, infohash),
    };
    if (process.env.TORNEDO_DIAGNOSTICS === "1") {
      process.stderr.write(`[tornedo:diagnostics] ${id} magnet parsed ${JSON.stringify(item.diagnostics)}\n`);
    }
    this.items.set(id, item);
    this.markDirty(id, { persist: true });
    this.schedule();
    this.emit("added", item);
    this.changed();
    return item;
  }

  // --- scheduler -------------------------------------------------------------

  private canStart(item: TorrentItem): boolean {
    const cfg = this.getConfig();
    const max = cfg.maxActiveDownloads;
    if (max <= 0) return true;
    return this.activeCount() < max;
  }

  private schedule(): void {
    const cfg = this.getConfig();
    const max = cfg.maxActiveDownloads <= 0 ? Infinity : cfg.maxActiveDownloads;
    let started = false;
    while (this.activeCount() < max) {
      const next = [...this.items.values()]
        .filter((it) => it.status === "queued")
        .sort((a, b) => a.priority - b.priority || a.queuedAt - b.queuedAt)[0];
      if (!next) break;
      this.startItem(next);
      started = true;
    }
    if (started) this.changed();
  }

private startItem(item: TorrentItem): void {
    this.setStatus(item, "waiting_metadata");
    item.error = null;
    item.startedAt = Date.now();
    this.startedAt.set(item.id, Date.now());
    const handlers = this.handlersFor(item.id);
    // A file selection (or an explicit deselected start) means only the chosen
    // files download; start the torrent fully deselected so nothing is fetched
    // before the selection is applied (which happens when metadata arrives).
    const startDeselected = item.startDeselected === true || (item.selectedFiles?.length ?? 0) > 0;
    item.startDeselected = false;
    try {
      this.client.add(
        {
          id: item.id,
          source: item.magnet,
          destination: item.destination,
          announce: [...PUBLIC_TRACKERS],
          startDeselected,
        },
        handlers,
      );
    } catch (e) {
      this.fail(item, e instanceof Error ? e.message : String(e));
    }
  }

  private handlersFor(id: string): TorrentClientHandlers {
    return {
onMetadata: (_id, meta) => {
        const it = this.items.get(id);
        if (!it) return;
        if (meta.name) it.name = meta.name;
        if (meta.total > 0) {
          it.torrentSize = meta.total;
          it.size = meta.total;
        }
        it.files = meta.files;
        if (meta.fileList) it.fileList = meta.fileList;
        if (meta.torrentFile) this.store.saveCache(id, meta.torrentFile);
        // A persisted/requested file selection is re-applied now that the file
        // list is known, so deselected files are never fetched.
        if (it.selectedFiles && it.selectedFiles.length > 0) {
          this.client.selectFiles(id, it.selectedFiles);
        }
        it.diagnostics = { ...it.diagnostics!, metadata: "received", nextRetry: null, connection: "downloading", lastEvent: "torrent metadata received" };
        // Metadata (and the store) are ready: the item is READY, not yet
        // DOWNLOADING. The poller promotes it once bytes actually flow.
        if (it.status === "starting" || it.status === "waiting_metadata" || it.status === "queued") {
          this.setStatus(it, "ready");
        }
        this.markDirty(id);
      },
      onDone: (_id) => {
        const it = this.items.get(id);
        if (!it) return;
        if (it.status === "seeding") {
          // Re-seed verification passed; reset stray detection.
          this.strayHits.delete(id);
          this.startedAt.delete(id);
          return;
        }
if (it.status === "downloading" || it.status === "starting" || it.status === "waiting_metadata" || it.status === "ready" || it.status === "stalled" || it.status === "checking") {
          this.completeItem(it);
        }
      },
      onError: (_id, message) => {
        const it = this.items.get(id);
        if (!it) return;
        if (it.status === "seeding") {
          // A seed that errors is most likely missing its data.
          this.client.remove(id);
          this.strayHits.delete(id);
          this.startedAt.delete(id);
          it.error = message;
          it.uploadSpeed = 0;
          it.peers = 0;
          this.setStatus(it, "completed");
          this.markDirty(id, { persist: true });
          this.changed();
          return;
        }
        this.fail(it, message);
      },
      onWarning: (_id, message) => {
        const it = this.items.get(id);
        if (it) {
          it.error = null;
          // Warnings are informational; keep any prior error untouched.
        }
      },
      onDiagnostics: (_id, patch) => {
        const it = this.items.get(id);
        if (!it) return;
        it.diagnostics = { ...it.diagnostics!, ...patch };
        it.lastUpdated = Date.now();
        this.changed();
      },
      onProgress: (_id, progress) => {
        const it = this.items.get(id);
        if (!it) return;
        it.progress = Math.max(0, Math.min(1, progress));
        it.lastUpdated = Date.now();
        this.markDirty(id);
      },
    };
  }

  private completeItem(it: TorrentItem): void {
    const was = it.status;
    const now = Date.now();
    it.progress = 1;
    it.downloaded = it.size || it.downloaded;
    it.completedAt = now;
    it.lastUpdated = now;
    it.timeRemaining = 0;
    // A subset download leaves WebTorrent's empty placeholders for every file
    // that was not selected. The user only asked for the chosen files, so the
    // deselected ones are removed from disk once the subset is verified done
    // (otherwise the download folder is littered with 0-byte files the user
    // never wanted — and an installer sees missing files it can't run).
    if (it.selectedFiles && it.selectedFiles.length > 0 && it.fileList && it.fileList.length > 0) {
      void removeUnselectedFiles(it.destination, it.fileList, it.selectedFiles);
    }
    if (it.seedEnabled) {
      it.status = "seeding";
      this.strayHits.set(it.id, 0);
      this.startedAt.set(it.id, now);
      this.emit("statusChanged", it, was, "seeding");
    } else {
      it.status = "completed";
      this.client.remove(it.id);
      this.emit("statusChanged", it, was, "completed");
    }
    this.markDirty(it.id, { persist: true });
    this.emit("completed", it);
    this.changed();
    this.schedule();
  }

  private fail(it: TorrentItem, message: string): void {
    this.client.remove(it.id);
    this.strayHits.delete(it.id);
    this.startedAt.delete(it.id);
    this.stalledSince.delete(it.id);
    it.status = "error";
    it.error = translateError(message);
    it.downloadSpeed = 0;
    it.uploadSpeed = 0;
    it.peers = 0;
    it.timeRemaining = Infinity;
    it.lastUpdated = Date.now();
    this.markDirty(it.id, { persist: true });
    this.emit("failed", it.id, it.error);
    this.changed();
    this.schedule();
  }

  // --- user actions ----------------------------------------------------------

  pause(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    if (it.status === "seeding") {
      this.pauseSeeding(id);
      return;
    }
if (it.status !== "downloading" && it.status !== "starting" && it.status !== "waiting_metadata" && it.status !== "ready" && it.status !== "stalled" && it.status !== "queued") return;
    const was = it.status;
    this.client.remove(id);
    it.status = "paused";
    it.downloadSpeed = 0;
    it.uploadSpeed = 0;
    it.peers = 0;
    it.timeRemaining = Infinity;
    it.lastUpdated = Date.now();
    this.strayHits.delete(id);
    this.startedAt.delete(id);
    this.stalledSince.delete(id);
    this.emit("statusChanged", it, was, "paused");
    this.markDirty(it.id, { persist: true });
    this.changed();
    this.schedule();
  }

  resume(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    if (it.status === "paused" || it.status === "stopped") {
      const was = it.status;
      it.status = "queued";
      this.emit("statusChanged", it, was, "queued");
      this.markDirty(it.id, { persist: true });
      this.changed();
      this.schedule();
      return;
    }
    if (it.status === "completed" && it.seedEnabled) {
      this.resumeSeeding(id);
      return;
    }
    if (it.status === "error") {
      this.retry(id);
    }
  }

  togglePause(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    if (it.status === "paused" || it.status === "completed" || it.status === "stopped") this.resume(id);
    else this.pause(id);
  }

  retry(id: string): void {
    const it = this.items.get(id);
    if (!it || it.status !== "error") return;
    it.error = null;
    it.status = "queued";
    it.progress = 0;
    it.lastUpdated = Date.now();
    this.markDirty(id, { persist: true });
    this.changed();
    this.schedule();
  }

  async remove(id: string, opts: { deleteFiles?: boolean } = {}): Promise<void> {
    const it = this.items.get(id);
    if (!it) return;
    this.client.remove(id);
    this.items.delete(id);
    this.strayHits.delete(id);
    this.startedAt.delete(id);
    this.stalledSince.delete(id);
    this.store.delete(id);
    this.store.deleteCache(id);
    if (opts.deleteFiles && it.destination && it.name) {
      await removeDataSafe(it.destination, it.name);
    }
    this.emit("removed", id);
    this.changed();
    this.schedule();
  }

  setPriority(id: string, priority: number): void {
    const it = this.items.get(id);
    if (!it) return;
    it.priority = Math.max(0, Math.floor(priority));
    it.lastUpdated = Date.now();
    this.markDirty(id, { persist: true });
    this.changed();
    this.schedule();
  }

  setDestination(id: string, dir: string): void {
    const it = this.items.get(id);
    if (!it) return;
    const changed = it.destination !== dir;
    it.destination = dir;
    if (changed && it.status === "downloading") {
      // Moving data mid-download is out of scope: restart at the new location.
      this.client.remove(id);
      it.status = "queued";
      it.progress = 0;
      it.downloaded = 0;
      this.markDirty(id, { persist: true });
      this.changed();
      this.schedule();
    } else {
      this.markDirty(id, { persist: true });
    }
  }

  setSeedEnabled(id: string, enabled: boolean): void {
    const it = this.items.get(id);
    if (!it) return;
    if (it.seedEnabled === enabled) return;
    it.seedEnabled = enabled;
    it.lastUpdated = Date.now();
    if (it.status === "seeding" && !enabled) {
      this.client.remove(id);
      this.strayHits.delete(id);
      this.startedAt.delete(id);
      it.uploadSpeed = 0;
      it.peers = 0;
      this.setStatus(it, "completed");
    }
    this.markDirty(id, { persist: true });
    this.changed();
  }

  toggleSeeding(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    if (it.status === "seeding") {
      this.setSeedEnabled(id, false);
    } else if (it.status === "completed" || it.status === "stopped") {
      this.setSeedEnabled(id, true);
      this.resumeSeeding(id);
    }
  }

  /**
   * Restrict a torrent to the given file paths (relative torrent paths). Files
   * not listed stop downloading immediately; a torrent that is still resolving
   * metadata applies the selection the moment files are known. Passing an empty
   * list clears the selection and downloads the whole torrent.
   */
  setFileSelection(id: string, paths: string[]): void {
    const it = this.items.get(id);
    if (!it) return;
    const cleaned = [...new Set(paths.filter((p) => p.trim().length > 0))];
    const known = it.fileList ?? [];
    if (known.length > 0 && cleaned.length > 0) {
      const matched = known.filter((f) => cleaned.includes(f.path));
      if (matched.length === 0) {
        it.error = "No selected files match this torrent's file list — selection kept as-is.";
        this.changed();
        return;
      }
    }
    if (cleaned.length === 0) {
      // Clearing a selection re-selects the whole torrent (also restarts the
      // download for a READY item that had been waiting for the file pick).
      this.client.selectFiles(id, []);
    } else {
      this.client.selectFiles(id, cleaned);
    }
    it.selectedFiles = cleaned.length > 0 ? cleaned : null;
    it.lastUpdated = Date.now();
    this.markDirty(id, { persist: true });
    this.changed();
  }

  pauseSeeding(id: string): void {
    const it = this.items.get(id);
    if (!it || it.status !== "seeding") return;
    this.client.remove(id);
    this.strayHits.delete(id);
    this.startedAt.delete(id);
    it.uploadSpeed = 0;
    it.peers = 0;
    this.setStatus(it, "completed");
  }

  resumeSeeding(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    if (it.status !== "completed" && it.status !== "stopped") return;
    if (!it.seedEnabled) {
      it.seedEnabled = true;
    }
    const was = it.status;
    this.setStatus(it, "seeding");
    this.strayHits.set(id, 0);
    this.startedAt.set(id, Date.now());
    const cached = this.store.loadCache(id);
    const source: string | Uint8Array = cached ? cached : it.magnet;
    const startDeselected = (it.selectedFiles?.length ?? 0) > 0;
    try {
      this.client.add(
        {
          id: it.id,
          source,
          destination: it.destination,
          announce: [...PUBLIC_TRACKERS],
          startDeselected,
        },
        this.handlersFor(it.id),
      );
    } catch (e) {
      it.status = was;
      it.error = e instanceof Error ? e.message : String(e);
      this.markDirty(it.id, { persist: true });
      this.changed();
      return;
    }
    this.markDirty(it.id, { persist: true });
    this.emit("statusChanged", it, was, "seeding");
    this.changed();
  }

  // --- cancel / delete / open location ---------------------------------------

  /**
   * Cancel a download: stop the engine, keep the item and its progress in the
   * queue as "stopped". Nothing is deleted; the user can resume or remove it.
   */
  cancel(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    if (it.status === "completed" || it.status === "stopped" || it.status === "error") return;
    const was = it.status;
    this.client.remove(id);
    this.strayHits.delete(id);
    this.startedAt.delete(id);
    this.stalledSince.delete(id);
    it.status = "stopped";
    it.downloadSpeed = 0;
    it.uploadSpeed = 0;
    it.peers = 0;
    it.timeRemaining = Infinity;
    it.lastUpdated = Date.now();
    this.emit("statusChanged", it, was, "stopped");
    this.markDirty(it.id, { persist: true });
    this.changed();
    this.schedule();
  }

  /**
   * Permanently delete the downloaded files for an item. The torrent entry
   * itself stays (status becomes "stopped" with progress reset) so the user
   * can re-download or remove it — deleting user files is always explicit.
   */
  async deleteFiles(id: string): Promise<void> {
    const it = this.items.get(id);
    if (!it) return;
    this.client.remove(id);
    this.strayHits.delete(id);
    this.startedAt.delete(id);
    this.stalledSince.delete(id);
    await removeDataSafe(it.destination, it.name);
    it.status = "stopped";
    it.progress = 0;
    it.downloaded = 0;
    it.downloadSpeed = 0;
    it.uploadSpeed = 0;
    it.peers = 0;
    it.timeRemaining = Infinity;
    it.lastUpdated = Date.now();
    this.markDirty(it.id, { persist: true });
    this.changed();
    this.schedule();
  }

  /** Open the download location in the OS file manager. Returns true when launched. */
  openLocation(id: string): boolean {
    const it = this.items.get(id);
    if (!it || !it.destination) return false;
    const platform = process.platform;
    let cmd: string;
    let args: string[];
    if (platform === "win32") {
      cmd = "explorer";
      args = [it.destination];
    } else if (platform === "darwin") {
      cmd = "open";
      args = [it.destination];
    } else {
      cmd = "xdg-open";
      args = [it.destination];
    }
    try {
      const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
      child.on("error", () => {
        /* the caller falls back to showing the path */
      });
      child.unref();
      return true;
    } catch {
      return false;
    }
  }

  // --- restore ----------------------------------------------------------------

  private restore(): void {
    const cfg = this.getConfig();
    const max = cfg.maxActiveDownloads <= 0 ? Infinity : cfg.maxActiveDownloads;
    let active = 0;
    for (const it of this.items.values()) {
switch (it.status) {
        case "downloading":
        case "starting":
        case "waiting_metadata":
        case "ready":
        case "stalled":
        case "checking":
          if (active < max) {
            this.startItem(it);
            active++;
          } else {
            this.setStatus(it, "queued");
          }
          break;
        case "seeding":
          // Restore live seeds; verification happens inside the engine.
          this.restoreSeed(it);
          break;
        case "queued":
        case "paused":
        case "completed":
        case "error":
        case "stopped":
          break;
        default:
          break;
      }
    }
    if (active < max) this.schedule();
    this.changed();
  }

  private restoreSeed(it: TorrentItem): void {
    const cached = this.store.loadCache(it.id);
    const source: string | Uint8Array = cached ? cached : it.magnet;
    this.strayHits.set(it.id, 0);
    this.startedAt.set(it.id, Date.now());
    // A subset seed must stay a subset: start deselected so the engine never
    // fetches files that were intentionally not downloaded (and since removed
    // from disk). The persisted selection is re-applied once metadata arrives.
    const startDeselected = (it.selectedFiles?.length ?? 0) > 0;
    try {
      this.client.add(
        {
          id: it.id,
          source,
          destination: it.destination,
          announce: [...PUBLIC_TRACKERS],
          startDeselected,
        },
        this.handlersFor(it.id),
      );
    } catch (e) {
      it.status = "completed";
      it.error = e instanceof Error ? e.message : String(e);
      this.markDirty(it.id, { persist: true });
    }
  }

  // --- polling ----------------------------------------------------------------

  private tick(): void {
    const now = Date.now();
    for (const it of this.items.values()) {
if (it.status === "seeding") {
        this.tickSeed(it, now);
      } else if (
        it.status === "downloading" ||
        it.status === "starting" ||
        it.status === "waiting_metadata" ||
        it.status === "ready" ||
        it.status === "stalled" ||
        it.status === "checking"
      ) {
        this.tickActive(it, now);
      }
    }
  }

private tickActive(it: TorrentItem, now: number): void {
    const s = this.client.get(it.id);
    if (it.status === "starting" || it.status === "waiting_metadata") {
      const started = this.startedAt.get(it.id) ?? it.startedAt ?? now;
      if (s) {
        // Metadata/store are ready: promote RESOLVING_METADATA -> READY. Actual
        // byte transfer (below) promotes READY -> DOWNLOADING.
        if (s.ready || s.total > 0 || s.progress > 0) this.setStatus(it, "ready");
      }
      const retryAt = it.diagnostics?.nextRetry ?? started + METADATA_RETRY_BASE_MS;
      if (now >= retryAt) {
        const attempts = (this.metadataRetries.get(it.id) ?? 0) + 1;
        this.metadataRetries.set(it.id, attempts);
        const delay = Math.min(METADATA_RETRY_BASE_MS * 2 ** attempts, METADATA_RETRY_MAX_MS);
        it.diagnostics = {
          ...it.diagnostics!,
          metadata: "timeout",
          metadataRetries: attempts,
          nextRetry: now + delay,
          lastEvent: "METADATA TIMEOUT; discovery retry scheduled",
        };
        this.client.retryMetadata(it.id);
        this.changed();
      }
    }
    if (!s) return;
    it.progress = Math.min(1, s.progress || 0);
    it.downloaded = s.downloaded;
    it.uploaded = s.uploaded;
    if (s.total) {
      it.torrentSize = s.total;
      it.size = s.total;
    }
    it.downloadSpeed = s.downloadSpeed;
    it.uploadSpeed = s.uploadSpeed;
    it.peers = s.peers;
    it.seeds = s.seeds;
    it.timeRemaining = s.timeRemaining;
    if (s.name && !it.name) it.name = s.name;
    it.lastUpdated = now;
    this.markDirty(it.id);

    // READY -> DOWNLOADING: metadata known and the first bytes/peers arrive.
    if (it.status === "ready" && (s.progress > 0 || s.downloadSpeed > 0)) {
      this.setStatus(it, "downloading");
    }

    // STALLED detection: metadata is known but discovery/progress has dried up.
    // Any peer or transfer activity immediately reverts a stalled item to
    // downloading; a stalled item is never failed automatically.
    if (it.status === "downloading") {
      const hasActivity = s.peers > 0 || s.downloadSpeed > 0 || s.progress > 0;
      if (hasActivity) {
        this.stalledSince.delete(it.id);
      } else {
        const since = this.stalledSince.get(it.id) ?? now;
        this.stalledSince.set(it.id, since);
        if (now - since >= STALL_THRESHOLD_MS) {
          this.setStatus(it, "stalled");
          if (it.diagnostics) {
            it.diagnostics = { ...it.diagnostics, lastEvent: "no peers or progress; marked stalled (still retrying)" };
          }
          this.changed();
        }
      }
    } else if (it.status === "stalled") {
      const hasActivity = s.peers > 0 || s.downloadSpeed > 0 || s.progress > 0;
      if (hasActivity) {
        this.stalledSince.delete(it.id);
        this.setStatus(it, "downloading");
        if (it.diagnostics) {
          it.diagnostics = { ...it.diagnostics, lastEvent: "activity resumed; no longer stalled" };
        }
        this.changed();
      }
    }
  }

  private tickSeed(it: TorrentItem, now: number): void {
    const s = this.client.get(it.id);
    if (!s) {
      return;
    }
    // Safety net: a seed pulling data has lost its files on disk. After a grace
    // period, stop it rather than re-downloading the whole thing.
    const started = this.startedAt.get(it.id) ?? 0;
    if (now - started > SEED_GRACE_MS && s.progress < 1 && s.downloadSpeed > 0) {
      const hits = (this.strayHits.get(it.id) ?? 0) + 1;
      this.strayHits.set(it.id, hits);
      if (hits >= STRAY_TICKS) {
        this.client.remove(it.id);
        this.strayHits.delete(it.id);
        this.startedAt.delete(it.id);
        it.uploadSpeed = 0;
        it.peers = 0;
        it.downloadSpeed = 0;
        it.error = "Data missing on disk";
        this.setStatus(it, "completed");
        this.markDirty(it.id, { persist: true });
      }
      return;
    }
    this.strayHits.set(it.id, 0);
    it.uploadSpeed = s.uploadSpeed;
    it.uploaded = s.uploaded;
    it.peers = s.peers;
    it.lastUpdated = now;
    this.markDirty(it.id);
  }

  // --- status helpers ----------------------------------------------------------

  private setStatus(it: TorrentItem, status: TorrentStatus): void {
    if (it.status === status) return;
    const from = it.status;
    it.status = status;
    it.lastUpdated = Date.now();
    this.emit("statusChanged", it, from, status);
  }

  private changed(): void {
    this.emit("update");
  }

  private markDirty(id: string, opts?: { persist?: boolean }): void {
    this.dirty.add(id);
    if (opts?.persist) this.flushPersist();
  }

  private flushPersist(): void {
    if (this.dirty.size === 0) return;
    const ids = [...this.dirty];
    this.dirty.clear();
    try {
      this.store.transaction(() => {
        for (const id of ids) {
          const item = this.items.get(id);
          if (item) this.store.upsert(item);
        }
      });
    } catch {
      // A single bad row must not lose the batch: fall back to per-item writes.
      for (const id of ids) {
        const item = this.items.get(id);
        if (item) {
          try {
            this.store.upsert(item);
          } catch {
            /* noop */
          }
        }
      }
    }
  }

  // --- config / shutdown ------------------------------------------------------

  applyConfig(): void {
    const cfg = this.getConfig();
    this.client.setSpeedLimits({
      download: cfg.maxDownloadSpeed,
      upload: cfg.maxUploadSpeed,
    });
    this.schedule();
    this.changed();
  }

  persistSync(): void {
    this.flushPersist();
    for (const item of this.items.values()) {
      if (
        item.status === "downloading" ||
        item.status === "starting" ||
        item.status === "waiting_metadata" ||
        item.status === "ready" ||
        item.status === "stalled" ||
        item.status === "checking"
      ) {
        item.downloadSpeed = 0;
        item.uploadSpeed = 0;
        item.timeRemaining = Infinity;
      }
      this.store.upsert(item);
    }
  }

  async suspend(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.stopTimers();
    this.persistSync();
    this.client.destroy();
    // Clean shutdown: clear the crash marker so the next start knows it was
    // not interrupted.
    try {
      this.store.clearRunMarker();
    } catch {
      /* noop */
    }
  }

  destroy(): Promise<void> {
    return this.suspend();
  }
}

function initialDiagnostics(magnet: string, infohash: string): TorrentDiagnostics {
  const parsed = parseInput(magnet);
  const trackerUrls = mergeTrackers(parsed?.trackers ?? [], PUBLIC_TRACKERS);
  return {
    magnetValid: Boolean(parsed),
    infohashPresent: parsed?.infoHash === infohash,
    magnetUri: magnet,
    displayName: parsed?.name ?? infohash,
    trackerUrls,
    trackerTotal: trackerUrls.length,
    trackerHealthy: 0,
    dht: "starting",
    dhtEnabled: true,
    dhtListening: false,
    dhtBootstrapped: false,
    dhtPort: null,
    dhtAddress: null,
    dhtFamily: null,
    dhtRoutingTable: "initializing",
    dhtRoutingNodes: 0,
    dhtQueries: 0,
    dhtResponses: 0,
    dhtLastQuery: null,
    peersDiscovered: 0,
    ipv4Peers: 0,
    ipv6Peers: 0,
    metadata: "waiting",
    metadataRequests: 0,
    metadataResponses: 0,
    lastMetadataAttempt: null,
    nextRetry: null,
    metadataRetries: 0,
    connection: "idle",
    engineState: "created",
    lastEvent: "magnet parsed",
  };
}

/**
 * Best-effort deletion of an item's data without trusting any remote paths.
 * Only the top-level entry named after the torrent is touched.
 */
async function removeDataSafe(destination: string, name: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  const path = await import("node:path");
  const safe = sanitizeSegment(name);
  if (!safe) return;
  const target = path.join(destination, safe);
  try {
    await rm(target, { recursive: true, force: true });
  } catch {
    /* noop */
  }
}

/**
 * Delete the placeholder files a subset download never fetched, leaving only
 * the files the user actually selected. WebTorrent creates an empty file on
 * disk for every entry in the torrent, so without this a single-file pick
 * still leaves the whole release visible (and an installer broken) on disk.
 * Relative paths are resolved against `destination` and guarded so nothing
 * outside the download directory can ever be touched; parent directories left
 * behind by the deletions are removed while empty.
 */
async function removeUnselectedFiles(
  destination: string,
  fileList: readonly { path: string; length: number }[],
  selected: readonly string[],
): Promise<void> {
  const { rm, readdir } = await import("node:fs/promises");
  const path = await import("node:path");
  const destRoot = path.resolve(destination);
  const wanted = new Set(selected);
  const dirs = new Set<string>();
  for (const f of fileList) {
    if (!f.path || wanted.has(f.path)) continue;
    const target = path.resolve(destRoot, f.path);
    if (target !== destRoot && !target.startsWith(destRoot + path.sep)) continue;
    try {
      await rm(target, { force: true });
    } catch {
      /* best effort */
    }
    let dir = path.dirname(target);
    while (dir !== destRoot && dir.startsWith(destRoot + path.sep)) {
      dirs.add(dir);
      dir = path.dirname(dir);
    }
  }
  // Remove now-empty directories, deepest first. `rm` refuses directories
  // without `recursive`, so verify emptiness (re-read) and only then remove —
  // a directory that still holds files is left alone.
  for (const d of [...dirs].sort((a, b) => b.length - a.length)) {
    try {
      if ((await readdir(d)).length === 0) {
        await rm(d, { recursive: true, force: true });
      }
    } catch {
      /* non-empty, in use, or already gone — keep it */
    }
  }
}

function sanitizeSegment(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned.slice(0, 200) : "";
}

/** Create a directory (and parents); never throws on an existing one. */
function ensureDirectory(dir: string): void {
  try {
    mkdirSync(dir, { recursive: true });
  } catch {
    /* surface per-item below; a missing dir must not kill startup */
  }
}

/** Turn raw engine errors into actionable user-facing messages. */
function translateError(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes("no space left") || lower.includes("enospc")) {
    return "No space left on device — free up disk space and retry";
  }
  if (lower.includes("eacces") || lower.includes("permission denied")) {
    return "Permission denied — check the download directory permissions";
  }
  if (lower.includes("eexist") || lower.includes("already exists")) {
    return "File already exists in the download directory";
  }
  if (lower.includes("invalid") && lower.includes("magnet")) {
    return "Invalid magnet — the torrent could not be resolved";
  }
  if (lower.includes("eisdir")) {
    return "Path conflict — a directory occupies the expected file location";
  }
  return message;
}
