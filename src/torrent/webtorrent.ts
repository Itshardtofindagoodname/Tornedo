/**
 * WebTorrent-backed TorrentClient. Owns exactly one WebTorrent instance and maps
 * Tornedo ids to live Torrent handles. All stats reads are guarded because
 * WebTorrent getters can throw before metadata parses.
 */
import WebTorrent from "webtorrent";
import type { Torrent } from "webtorrent";
import type { TorrentMeta, TorrentStats } from "../model/torrent.js";
import type {
  ClientStats,
  SpeedLimits,
  TorrentClient,
  TorrentClientAdd,
  TorrentClientHandlers,
} from "./client.js";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

export interface WebTorrentClientOptions {
  /** Extra announce URLs appended to every add. */
  announce?: string[];
  /** Max concurrent connections. */
  maxConns?: number;
  /** Global speed limits in bytes/sec (0 = unlimited). */
  limits?: SpeedLimits;
}

export class WebTorrentClient implements TorrentClient {
  readonly kind = "webtorrent";
  private client: WebTorrent;
  private torrents = new Map<string, Torrent>();
  private handlers = new Map<string, TorrentClientHandlers>();
  private announce: string[];
  private limits: SpeedLimits;

  constructor(opts: WebTorrentClientOptions = {}) {
    this.announce = opts.announce ?? [];
    this.limits = opts.limits ?? { download: 0, upload: 0 };
    // On macOS, mDNSResponder permanently occupies UDP 5350 (NAT-PMP client).
    // Binding fails asynchronously with EADDRINUSE and, being a raw EventEmitter
    // with no error listener, surfaces as an uncaughtException. Disable PMP and
    // let UPnP handle NAT traversal instead.
    const clientOpts = process.platform === "darwin" ? { natPmp: false } : {};
    this.client = new WebTorrent(clientOpts);
    this.client.on("error", () => {
      // Client-level errors (e.g. tracker socket failures) are non-fatal; the
      // per-torrent error handler is the source of truth for item failure.
    });
    this.applyLimits(this.limits);
  }

  add(input: TorrentClientAdd, handlers: TorrentClientHandlers): void {
    const existing = this.torrents.get(input.id);
    if (existing) {
      this.torrents.delete(input.id);
      this.handlers.delete(input.id);
      try {
        existing.destroy();
      } catch {
        /* noop */
      }
    }

    const opts: { path: string; announce?: string[] } = { path: input.destination };
    const announce = [...input.announce ?? [], ...this.announce].filter(Boolean);
    if (announce.length > 0) opts.announce = announce;

    let torrent: Torrent;
    try {
      torrent = this.client.add(input.source, opts);
    } catch (e) {
      handlers.onError(input.id, message(e));
      return;
    }
    this.torrents.set(input.id, torrent);
    this.handlers.set(input.id, handlers);

    torrent.on("metadata", () => {
      handlers.onMetadata(input.id, {
        name: torrent.name,
        total: torrent.length,
        files: torrent.files?.length ?? 0,
        torrentFile: torrent.torrentFile,
      });
    });
    torrent.on("done", () => {
      handlers.onDone(input.id);
    });
    torrent.on("error", (err: Error) => {
      handlers.onError(input.id, message(err));
      this.torrents.delete(input.id);
      this.handlers.delete(input.id);
      try {
        torrent.destroy();
      } catch {
        /* noop */
      }
    });
    torrent.on("warning", (err: Error) => {
      handlers.onWarning(input.id, message(err));
    });
  }

  pause(id: string): void {
    const t = this.torrents.get(id);
    if (t) {
      try {
        t.pause();
      } catch {
        /* noop */
      }
    }
  }

  resume(id: string): void {
    const t = this.torrents.get(id);
    if (t) {
      try {
        t.resume();
      } catch {
        /* noop */
      }
    }
  }

  remove(id: string): void {
    const t = this.torrents.get(id);
    this.torrents.delete(id);
    this.handlers.delete(id);
    if (t) {
      try {
        t.destroy();
      } catch {
        /* noop */
      }
    }
  }

  get(id: string): TorrentStats | null {
    const t = this.torrents.get(id);
    if (!t) return null;
    const s: TorrentStats = {
      progress: 0,
      downloaded: 0,
      uploaded: 0,
      total: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      seeds: 0,
      timeRemaining: Infinity,
      name: "",
      ready: false,
    };
    try {
      s.progress = t.progress || 0;
      s.downloaded = t.downloaded || 0;
      s.uploaded = t.uploaded || 0;
      s.total = t.length || 0;
      s.downloadSpeed = t.downloadSpeed || 0;
      s.uploadSpeed = t.uploadSpeed || 0;
      s.peers = t.numPeers || 0;
      s.seeds = 0; // WebTorrent does not expose seeds separately
      s.timeRemaining =
        typeof t.timeRemaining === "number" && !Number.isNaN(t.timeRemaining) && t.timeRemaining > 0
          ? t.timeRemaining
          : Infinity;
      s.name = t.name || "";
      s.ready = t.ready || false;
    } catch {
      // Partial numbers beat a dead poller.
    }
    return s;
  }

  stats(): ClientStats {
    let downloadSpeed = 0;
    let uploadSpeed = 0;
    let active = 0;
    try {
      downloadSpeed = this.client.downloadSpeed || 0;
      uploadSpeed = this.client.uploadSpeed || 0;
      active = this.client.torrents?.length ?? 0;
    } catch {
      /* noop */
    }
    return { downloadSpeed, uploadSpeed, active };
  }

  setSpeedLimits(limits: SpeedLimits): void {
    this.limits = limits;
    this.applyLimits(limits);
  }

  private applyLimits(limits: SpeedLimits): void {
    try {
      // rate < 0 disables the throttle (unlimited); rate 0 would mean "stop".
      this.client.throttleDownload(limits.download > 0 ? limits.download : -1);
      this.client.throttleUpload(limits.upload > 0 ? limits.upload : -1);
    } catch {
      /* noop */
    }
  }

  listenPort(): number | null {
    try {
      return this.client.torrentPort ?? null;
    } catch {
      return null;
    }
  }

  destroy(): void {
    this.torrents.clear();
    this.handlers.clear();
    // Never block shutdown on webtorrent's async teardown: hand off to a later
    // tick and let the OS reclaim sockets if we exit first.
    const client = this.client;
    setImmediate(() => {
      try {
        client.destroy();
      } catch {
        /* noop */
      }
    });
  }
}