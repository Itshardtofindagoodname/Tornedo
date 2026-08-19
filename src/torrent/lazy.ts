/**
 * LazyTorrentClient: defers construction of the real torrent engine until it
 * is first actually needed (a torrent is queued, doctor probes it, ...).
 * WebTorrent's startup — DHT socket, torrent-port server, NAT traversal,
 * tracker client — takes seconds, and merely importing the module costs real
 * time too. With this wrapper neither happens until the first download, so the
 * TUI renders immediately. All calls are delegated to the underlying client
 * once created; non-engine calls (pause/remove/stats on a never-built client)
 * are safe no-ops because there is nothing to act on.
 */
import type {
  ClientStats,
  SpeedLimits,
  TorrentClient,
  TorrentClientAdd,
  TorrentClientHandlers,
} from "./client.js";

export class LazyTorrentClient implements TorrentClient {
  readonly kind = "lazy-webtorrent";
  private inner: TorrentClient | null = null;
  private pending: Promise<TorrentClient> | null = null;
  private readonly create: () => TorrentClient | Promise<TorrentClient>;
  private pendingLimits: SpeedLimits | null = null;

  constructor(create: () => TorrentClient | Promise<TorrentClient>) {
    this.create = create;
  }

  /** Materialize the real client once, applying any pending speed limits. */
  private ensure(): Promise<TorrentClient> {
    if (this.inner) return Promise.resolve(this.inner);
    if (!this.pending) {
      this.pending = Promise.resolve()
        .then(() => this.create())
        .then((c) => {
          if (this.pendingLimits) {
            c.setSpeedLimits(this.pendingLimits);
            this.pendingLimits = null;
          }
          this.inner = c;
          return c;
        });
    }
    return this.pending;
  }

  /** Force the engine to materialize now (used by `tornedo doctor`). */
  load(): Promise<void> {
    return this.ensure().then(() => undefined);
  }

  /** Whether the engine has been built yet (used by diagnostics). */
  isLoaded(): boolean {
    return this.inner !== null;
  }

  async add(input: TorrentClientAdd, handlers: TorrentClientHandlers): Promise<void> {
    try {
      const c = await this.ensure();
      c.add(input, handlers);
    } catch (e) {
      handlers.onError(input.id, e instanceof Error ? e.message : String(e));
    }
  }

  pause(id: string): void {
    if (this.inner) this.inner.pause(id);
  }

  resume(id: string): void {
    if (this.inner) this.inner.resume(id);
  }

  remove(id: string): void {
    if (this.inner) this.inner.remove(id);
  }

  get(id: string): ReturnType<TorrentClient["get"]> {
    if (!this.inner) return null;
    return this.inner.get(id);
  }

  retryMetadata(id: string): void {
    if (this.inner) this.inner.retryMetadata(id);
  }

  selectFiles(id: string, paths: string[]): void {
    if (this.inner) this.inner.selectFiles(id, paths);
  }

  stats(): ClientStats {
    if (!this.inner) return { downloadSpeed: 0, uploadSpeed: 0, active: 0 };
    return this.inner.stats();
  }

  setSpeedLimits(limits: SpeedLimits): void {
    this.pendingLimits = limits;
    if (this.inner) this.inner.setSpeedLimits(limits);
  }

  listenPort(): number | null {
    if (!this.inner) return null;
    return this.inner.listenPort();
  }

  destroy(): void {
    if (this.inner) {
      this.inner.destroy();
      this.inner = null;
    }
    this.pending = null;
    this.pendingLimits = null;
  }
}