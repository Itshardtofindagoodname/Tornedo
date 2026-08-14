/**
 * TorrentManager: owns the in-memory torrent set, drives the engine client,
 * enforces the active-download cap, restores state from SQLite, and emits
 * change events for the UI / CLI. UI code never touches the client directly.
 */
import { EventEmitter } from "node:events";
import type { TornedoConfig } from "../config/config.js";
import type { TorrentStore } from "../database/store.js";
import type { AddTorrentInput, DownloadSummary, TorrentItem, TorrentStatus } from "../model/torrent.js";
import type { TorrentClient, TorrentClientHandlers } from "../torrent/client.js";
import { buildMagnet, parseInput } from "../torrent/parse.js";

const POLL_MS = 500;
/** Max time (ms) to wait for metadata before declaring the item failed. */
const METADATA_TIMEOUT_MS = 30_000;
/** Seeding grace before the stray-download detector starts watching. */
const SEED_GRACE_MS = 10_000;
const STRAY_TICKS = 3;
/** Persist progress changes at most this often. */
const PERSIST_INTERVAL_MS = 1_000;

export interface TorrentManagerOptions {
  client: TorrentClient;
  store: TorrentStore;
  getConfig(): TornedoConfig;
}

export interface TorrentManagerEvents {
  /** Any item changed. */
  update(): void;
  added(item: TorrentItem): void;
  removed(id: string): void;
  completed(item: TorrentItem): void;
  failed(id: string, message: string): void;
  statusChanged(item: TorrentItem, from: TorrentStatus, to: TorrentStatus): void;
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
  private disposed = false;

  constructor(opts: TorrentManagerOptions) {
    super();
    this.client = opts.client;
    this.store = opts.store;
    this.getConfig = opts.getConfig;
  }

  override on(event: "update", listener: () => void): this;
  override on(event: "added", listener: (item: TorrentItem) => void): this;
  override on(event: "removed", listener: (id: string) => void): this;
  override on(event: "completed", listener: (item: TorrentItem) => void): this;
  override on(event: "failed", listener: (id: string, message: string) => void): this;
  override on(event: "statusChanged", listener: (item: TorrentItem, from: TorrentStatus, to: TorrentStatus) => void): this;
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
    for (const item of this.store.list()) {
      this.items.set(item.id, item);
    }
    this.restore();
    this.startTimers();
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
      if (it.status === "downloading" || it.status === "starting" || it.status === "checking") n++;
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

    const item: TorrentItem = {
      id,
      infohash,
      magnet: input.magnet || parsed?.magnet || buildMagnet(infohash, input.name),
      name: input.name || parsed?.name || infohash,
      category: input.category ?? null,
      sourceId: input.sourceId ?? null,
      metadata: input.metadata ?? {},
      destination: input.destination ?? cfg.downloadDir,
      status: "queued",
      progress: 0,
      downloaded: 0,
      uploaded: 0,
      size: input.size ?? 0,
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
    };
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
    this.setStatus(item, "starting");
    item.error = null;
    item.startedAt = Date.now();
    this.startedAt.set(item.id, Date.now());
    const handlers = this.handlersFor(item.id);
    try {
      this.client.add(
        {
          id: item.id,
          source: item.magnet,
          destination: item.destination,
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
        if (meta.total) it.size = meta.total;
        it.files = meta.files;
        if (meta.torrentFile) this.store.saveCache(id, meta.torrentFile);
        if (it.status === "starting") this.setStatus(it, "downloading");
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
        if (it.status === "downloading" || it.status === "starting" || it.status === "checking") {
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
    it.status = "error";
    it.error = message;
    it.downloadSpeed = 0;
    it.uploadSpeed = 0;
    it.peers = 0;
    it.timeRemaining = Infinity;
    it.lastUpdated = Date.now();
    this.markDirty(it.id, { persist: true });
    this.emit("failed", it.id, message);
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
    if (it.status !== "downloading" && it.status !== "starting" && it.status !== "queued") return;
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
    this.emit("statusChanged", it, was, "paused");
    this.markDirty(it.id, { persist: true });
    this.changed();
    this.schedule();
  }

  resume(id: string): void {
    const it = this.items.get(id);
    if (!it) return;
    if (it.status === "paused") {
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
    if (it.status === "paused" || it.status === "completed") this.resume(id);
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
    try {
      this.client.add(
        {
          id: it.id,
          source,
          destination: it.destination,
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

  // --- restore ----------------------------------------------------------------

  private restore(): void {
    const cfg = this.getConfig();
    const max = cfg.maxActiveDownloads <= 0 ? Infinity : cfg.maxActiveDownloads;
    let active = 0;
    for (const it of this.items.values()) {
      switch (it.status) {
        case "downloading":
        case "starting":
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
    try {
      this.client.add(
        {
          id: it.id,
          source,
          destination: it.destination,
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
      } else if (it.status === "downloading" || it.status === "starting" || it.status === "checking") {
        this.tickActive(it, now);
      }
    }
  }

  private tickActive(it: TorrentItem, now: number): void {
    const s = this.client.get(it.id);
    if (it.status === "starting") {
      const started = this.startedAt.get(it.id) ?? it.startedAt ?? now;
      if (s) {
        if (s.ready || s.total > 0 || s.progress > 0 || s.peers > 0) {
          this.setStatus(it, "downloading");
        }
      }
      if (now - started > METADATA_TIMEOUT_MS) {
        this.fail(it, "No peers found for metadata (timeout)");
        return;
      }
    }
    if (!s) return;
    it.progress = Math.min(1, s.progress || 0);
    it.downloaded = s.downloaded;
    it.uploaded = s.uploaded;
    if (s.total) it.size = s.total;
    it.downloadSpeed = s.downloadSpeed;
    it.uploadSpeed = s.uploadSpeed;
    it.peers = s.peers;
    it.seeds = s.seeds;
    it.timeRemaining = s.timeRemaining;
    if (s.name && !it.name) it.name = s.name;
    it.lastUpdated = now;
    this.markDirty(it.id);
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
      if (item.status === "downloading" || item.status === "starting" || item.status === "checking") {
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
  }

  destroy(): Promise<void> {
    return this.suspend();
  }
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

function sanitizeSegment(name: string): string {
  const cleaned = name
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned && cleaned !== "." && cleaned !== ".." ? cleaned.slice(0, 200) : "";
}
