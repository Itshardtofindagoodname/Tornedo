/**
 * WebTorrent-backed TorrentClient. Owns exactly one WebTorrent instance and maps
 * Tornedo ids to live Torrent handles. All stats reads are guarded because
 * WebTorrent getters can throw before metadata parses.
 *
 * Discovery design:
 * - The manager supplies the fallback public-tracker list on every add; this
 *   client also appends its own configured `announce` list. WebTorrent merges
 *   those with trackers already embedded in the magnet and de-duplicates, so
 *   embedded trackers are preserved and only augmented.
 * - DHT telemetry uses only the public bittorrent-dht surface (`listening`,
 *   `ready`, `nodes`, `address()`, and the public events). "DHT ready" is only
 *   reported when the library's own bootstrap-complete event fires — a bound
 *   UDP socket alone is reported as "listening"/"bootstrapping".
 * - Metadata retry re-announces discovery through the public tracker-client and
 *   DHT APIs (`tracker.update()`, `dht.lookup()`, `dht.announce()`); no private
 *   WebTorrent internals are used.
 */
import WebTorrent from "webtorrent";
import type { File, Torrent } from "webtorrent";
import type { TorrentDiagnostics, TorrentMeta, TorrentStats } from "../model/torrent.js";
import type {
  ClientStats,
  SpeedLimits,
  TorrentClient,
  TorrentClientAdd,
  TorrentClientHandlers,
} from "./client.js";
import { mergeTrackers, parseInput } from "./parse.js";

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Public bittorrent-tracker Client surface used for re-announcing. */
type TrackerLike = {
  start?(opts?: unknown): void;
  update?(opts?: unknown): void;
};

/** Public bittorrent-dht surface used for retries and telemetry. */
type DhtLike = {
  listening: boolean;
  ready: boolean;
  destroyed: boolean;
  nodes?: { toArray(): unknown[] };
  address?(): { port: number; address: string; family: string } | null;
  lookup?(infoHash: string, cb?: (err?: Error) => void): unknown;
  announce?(infoHash: string, port: number, cb?: (err?: Error) => void): unknown;
  on?(event: string, listener: (...args: any[]) => void): unknown;
};

/** Public torrent-discovery surface (property is not underscore-private). */
type DiscoveryLike = {
  tracker?: TrackerLike | null;
  dht?: DhtLike | null;
};

type EngineTorrent = Torrent & {
  announce?: string[];
  discovery?: DiscoveryLike | null;
  wires?: Array<{ remoteAddress?: string }>;
};

interface DhtSnapshot {
  enabled: boolean;
  listening: boolean;
  bootstrapped: boolean;
  failed: boolean;
  port: number | null;
  address: string | null;
  family: string | null;
  nodes: number;
  responses: number;
}

export interface WebTorrentClientOptions {
  /** Extra announce URLs appended to every add. */
  announce?: string[];
  /** Set false to disable the DHT entirely. */
  dht?: boolean;
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
  private metadataRequestCounts = new Map<string, number>();
  private announce: string[];
  private limits: SpeedLimits;
  private dht: DhtLike | null;
  private dhtState: DhtSnapshot;
  /** Per-torrent subset of file paths the user chose (relative torrent paths). */
  private selectedPaths = new Map<string, Set<string>>();
  /** Torrents whose selected subset already fired onDone (guard against repeats). */
  private selectedDone = new Set<string>();

  constructor(opts: WebTorrentClientOptions = {}) {
    this.announce = opts.announce ?? [];
    this.limits = opts.limits ?? { download: 0, upload: 0 };
    // On macOS, mDNSResponder permanently occupies UDP 5350 (NAT-PMP client).
    // Binding fails asynchronously with EADDRINUSE and, being a raw EventEmitter
    // with no error listener, surfaces as an uncaughtException. Disable PMP and
    // let UPnP handle NAT traversal instead.
    const clientOpts = process.platform === "darwin" ? { natPmp: false } : {};
    if (opts.dht === false) (clientOpts as { dht?: boolean }).dht = false;
    if (opts.maxConns !== undefined) (clientOpts as { maxConns?: number }).maxConns = opts.maxConns;
    this.client = new WebTorrent(clientOpts);
    this.client.on("error", () => {
      // Client-level errors (e.g. tracker socket failures) are non-fatal; the
      // per-torrent error handler is the source of truth for item failure.
    });

    this.dht = (this.client as unknown as { dht?: DhtLike }).dht ?? null;
    this.dhtState = {
      enabled: Boolean(this.dht),
      listening: false,
      bootstrapped: false,
      failed: false,
      port: null,
      address: null,
      family: null,
      nodes: 0,
      responses: 0,
    };
    this.refreshDhtState();
    this.wireDht();

    this.applyLimits(this.limits);
  }

  // --- DHT telemetry (public bittorrent-dht surface only) ---------------------

  private refreshDhtState(): void {
    const d = this.dht;
    if (!d) {
      this.dhtState.enabled = false;
      return;
    }
    this.dhtState.listening = Boolean(d.listening);
    this.dhtState.bootstrapped = Boolean(d.ready);
    this.dhtState.nodes = d.nodes?.toArray?.().length ?? 0;
    try {
      const addr = d.address?.() ?? null;
      this.dhtState.port = addr?.port ?? null;
      this.dhtState.address = addr?.address ?? null;
      this.dhtState.family = addr?.family ?? null;
    } catch {
      this.dhtState.port = null;
      this.dhtState.address = null;
      this.dhtState.family = null;
    }
  }

  private wireDht(): void {
    const d = this.dht;
    if (!d?.on) return;
    d.on("listening", () => {
      this.refreshDhtState();
      this.emitDhtEvent("DHT UDP socket listening");
    });
    d.on("ready", () => {
      this.refreshDhtState();
      this.emitDhtEvent("DHT bootstrap complete");
    });
    d.on("node", () => {
      this.dhtState.responses++;
      this.refreshDhtState();
      this.emitDhtEvent("DHT routing node learned (response received)");
    });
    d.on("peer", () => {
      this.refreshDhtState();
      this.emitDhtEvent("DHT peer discovered");
    });
    d.on("error", (err: unknown) => {
      this.dhtState.failed = true;
      this.refreshDhtState();
      this.emitDhtEvent(`DHT error: ${message(err)}`);
    });
    d.on("warning", (err: unknown) => {
      this.refreshDhtState();
      this.emitDhtEvent(`DHT warning: ${message(err)}`);
    });
  }

  private dhtStatusPatch(): Partial<TorrentDiagnostics> {
    const s = this.dhtState;
    const dhtLabel: TorrentDiagnostics["dht"] = !s.enabled
      ? "disabled"
      : s.failed
        ? "failed"
        : !s.listening
          ? "starting"
          : !s.bootstrapped
            ? "bootstrapping"
            : "ready";
    return {
      dht: dhtLabel,
      dhtEnabled: s.enabled,
      dhtListening: s.listening,
      dhtBootstrapped: s.bootstrapped,
      dhtPort: s.port,
      dhtAddress: s.address,
      dhtFamily: s.family,
      dhtRoutingNodes: s.nodes,
      dhtRoutingTable: !s.enabled ? "empty" : s.nodes > 0 ? "ready" : "initializing",
      dhtResponses: s.responses,
    };
  }

  private emitDhtEvent(lastEvent: string): void {
    for (const [id, handlers] of this.handlers) {
      handlers.onDiagnostics?.(id, { ...this.dhtStatusPatch(), lastEvent });
    }
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

    const opts: { path: string; announce?: string[]; deselect?: boolean } = { path: input.destination };
    const announce = mergeTrackers(input.announce ?? [], this.announce);
    if (announce.length > 0) opts.announce = announce;
    if (input.startDeselected) opts.deselect = true;
    this.selectedDone.delete(input.id);

    let torrent: Torrent;
    try {
      torrent = this.client.add(input.source, opts);
    } catch (e) {
      handlers.onError(input.id, message(e));
      return;
    }
    this.torrents.set(input.id, torrent);
    this.handlers.set(input.id, handlers);
    const engine = torrent as EngineTorrent;
    let trackerHealthy = 0;
    let ipv4Peers = 0;
    let ipv6Peers = 0;
    let peersDiscovered = 0;
    let dhtQueries = 0;
    this.metadataRequestCounts.set(input.id, 0);
    let lastEvent = "engine handle created; discovery started";
    const report = (patch: Partial<TorrentDiagnostics>): void => {
      if (process.env.TORNEDO_DIAGNOSTICS === "1") {
        process.stderr.write(`[tornedo:diagnostics] ${input.id} ${JSON.stringify(patch)}\n`);
      }
      if (patch.lastEvent) lastEvent = patch.lastEvent;
      handlers.onDiagnostics?.(input.id, {
        ...this.dhtStatusPatch(),
        ...patch,
        lastEvent: patch.lastEvent ?? lastEvent,
      });
    };
    const parsedMagnet = typeof input.source === "string" ? parseInput(input.source) : null;

    report({
      magnetValid: Boolean(parsedMagnet),
      infohashPresent: Boolean(parsedMagnet?.infoHash),
      magnetUri: typeof input.source === "string" ? input.source : "<torrent bytes>",
      displayName: parsedMagnet?.name ?? "",
      trackerUrls: [...announce],
      trackerTotal: announce.length,
      trackerHealthy: 0,
      metadata: "waiting",
      connection: "discovering",
      engineState: "discovering",
      dhtQueries,
      peersDiscovered,
    });

    // Trackers are only resolved once parse-torrent processes the magnet; read
    // the merged list from the `infoHash` event rather than immediately.
    torrent.on("infoHash", () => {
      const merged = engine.announce ?? announce;
      report({
        trackerUrls: merged,
        trackerTotal: merged.length,
        connection: "discovering",
        lastEvent: "torrent identity parsed; discovery started",
      });
    });

    torrent.on("metadata", () => {
      report({
        metadata: "received",
        metadataResponses: 1,
        connection: "downloading",
        engineState: "metadata_received",
        nextRetry: null,
        lastEvent: "torrent metadata received",
      });
      const fileList = torrent.files?.map((f) => ({ path: f.path, length: f.length })) ?? [];
      handlers.onMetadata(input.id, {
        name: torrent.name,
        total: torrent.length,
        files: torrent.files?.length ?? 0,
        fileList,
        torrentFile: torrent.torrentFile,
      });
      // A selection may have been requested before metadata resolved: apply it
      // now that the file list is known (keeps the engine from downloading the
      // deselected files).
      const pending = this.selectedPaths.get(input.id);
      if (pending && pending.size > 0) this.applySelection(input.id, torrent, pending);
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
      report({ lastEvent: `engine warning: ${message(err)}` });
      handlers.onWarning(input.id, message(err));
    });
    torrent.on("trackerAnnounce", () => {
      report({ trackerHealthy: ++trackerHealthy, lastEvent: "tracker announce completed" });
    });
    torrent.on("dhtAnnounce", () => {
      report({
        dhtQueries: ++dhtQueries,
        dhtLastQuery: Date.now(),
        lastEvent: "DHT announce cycle completed",
      });
    });
    torrent.on("peer", () => {
      report({ peersDiscovered: ++peersDiscovered, lastEvent: "peer discovered via DHT/tracker/LSD/PEX" });
    });
    torrent.on("wire", (wire: { remoteAddress?: string }) => {
      const ipv6 = (wire.remoteAddress ?? "").includes(":");
      if (ipv6) ipv6Peers++; else ipv4Peers++;
      report({
        peersDiscovered: engine.wires?.length ?? peersDiscovered,
        metadataRequests: this.metadataRequestCounts.get(input.id) ?? 0,
        connection: "connected",
        ipv4Peers,
        ipv6Peers,
        lastEvent: `peer connected (${ipv6 ? "IPv6" : "IPv4"}); ut_metadata fetch issued`,
      });
    });
    torrent.on("noPeers", (source: string) => {
      report({ lastEvent: `no peers from ${source} in the last announce interval` });
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
    this.selectedPaths.delete(id);
    this.selectedDone.delete(id);
    if (t) {
      try {
        t.destroy();
      } catch {
        /* noop */
      }
    }
  }

  selectFiles(id: string, paths: string[]): void {
    const wanted = new Set(paths.filter((p) => p.length > 0));
    if (wanted.size === 0) {
      // Empty selection = download the whole torrent.
      this.selectedPaths.delete(id);
      this.selectedDone.delete(id);
      const torrent = this.torrents.get(id);
      if (torrent?.files && torrent.files.length > 0) {
        for (const f of torrent.files as File[]) {
          if (f.length === 0) continue;
          try {
            f.select();
          } catch {
            /* noop */
          }
        }
      }
      return;
    }
    this.selectedPaths.set(id, wanted);
    this.selectedDone.delete(id);
    const torrent = this.torrents.get(id);
    if (torrent?.files && torrent.files.length > 0) {
      this.applySelection(id, torrent, wanted);
    }
  }

  /**
   * Select only `wanted` files and deselect everything else. Zero matches falls
   * back to the default (select all) so a typo can never leave a torrent that
   * downloads nothing and never completes.
   */
  private applySelection(id: string, torrent: Torrent, wanted: ReadonlySet<string>): void {
    const files = torrent.files as File[];
    if (files.length === 0) return;
    const matches = files.filter((f) => wanted.has(f.path));
    if (matches.length === 0) {
      this.selectedPaths.delete(id);
      this.handlers.get(id)?.onWarning(id, `no files matched the selection — downloading the whole torrent`);
      return;
    }
    const selected = new Set(matches.map((f) => f.path));
    for (const f of files) {
      if (f.length === 0) continue;
      try {
        if (selected.has(f.path)) f.select();
        else f.deselect();
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
    // With a file subset selected, report progress over the chosen files only:
    // the whole-torrent numbers never reach 1 for a partial download.
    const wanted = this.selectedPaths.get(id);
    const files = t.files as File[] | undefined;
    if (wanted && wanted.size > 0 && files && files.length > 0) {
      const subset = files.filter((f) => wanted.has(f.path));
      if (subset.length > 0) {
        let total = 0;
        let downloaded = 0;
        for (const f of subset) {
          total += f.length;
          downloaded += Math.round((f.progress || 0) * f.length);
        }
        s.total = total;
        s.downloaded = downloaded;
        s.progress = total > 0 ? Math.min(1, downloaded / total) : 1;
        if (s.progress >= 1) this.fireSelectedDone(id);
      }
    }
    return s;
  }

  /**
   * WebTorrent only emits the torrent-level `done` event when *every* file is
   * done, so a partial (deselected) download would never complete on its own.
   * Detect completion of the selected subset from the polled per-file state.
   */
  private fireSelectedDone(id: string): void {
    if (this.selectedDone.has(id)) return;
    const t = this.torrents.get(id);
    const wanted = this.selectedPaths.get(id);
    if (!t || !wanted || wanted.size === 0) return;
    const files = t.files as File[] | undefined;
    if (!files || files.length === 0) return;
    const subset = files.filter((f) => wanted.has(f.path));
    if (subset.length === 0) return;
    if (subset.every((f) => f.done)) {
      this.selectedDone.add(id);
      this.handlers.get(id)?.onDone(id);
    }
  }

  retryMetadata(id: string): void {
    const torrent = this.torrents.get(id) as EngineTorrent | undefined;
    if (!torrent || torrent.ready) return;
    const disc = torrent.discovery;
    const requestCount = (this.metadataRequestCounts.get(id) ?? 0) + 1;
    this.metadataRequestCounts.set(id, requestCount);

    // Public bittorrent-tracker client API: trigger an announce now.
    const tracker = disc?.tracker;
    if (tracker) {
      try {
        if (typeof tracker.update === "function") tracker.update();
        else if (typeof tracker.start === "function") tracker.start();
      } catch {
        /* best effort */
      }
    }

    // Public bittorrent-dht API: re-query peers for this infohash and
    // re-announce our presence. Both methods are part of the library's
    // supported surface (unlike the removed _dhtAnnounce internal).
    const dht = disc?.dht;
    if (dht) {
      try {
        if (typeof dht.lookup === "function") {
          dht.lookup(torrent.infoHash, (err?: Error) => {
            if (err && !torrent.ready) {
              this.handlers.get(id)?.onDiagnostics?.(id, {
                ...this.dhtStatusPatch(),
                lastEvent: `DHT lookup for metadata failed: ${message(err)}`,
              });
            }
          });
        }
        if (typeof dht.announce === "function") {
          dht.announce(torrent.infoHash, this.listenPort() ?? 0, () => {
            /* announce is fire-and-forget for metadata discovery */
          });
        }
      } catch {
        /* best effort */
      }
    }

    this.handlers.get(id)?.onDiagnostics?.(id, {
      ...this.dhtStatusPatch(),
      metadataRequests: requestCount,
      connection: "discovering",
      lastMetadataAttempt: Date.now(),
      lastEvent: "metadata discovery re-announced (trackers + DHT) without restarting torrent",
    });
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
    this.selectedPaths.clear();
    this.selectedDone.clear();
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