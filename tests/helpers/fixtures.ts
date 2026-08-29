/**
 * Shared test fixtures: fake source adapters, fake torrent clients, and result
 * builders used by unit + integration tests.
 */
import type { SearchContext, SourceAdapter, SourceErrorKind } from "../../src/model/source.js";
import type { SearchResult, MediaCategory } from "../../src/model/search.js";
import type {
  ClientStats,
  SpeedLimits,
  TorrentClient,
  TorrentClientAdd,
  TorrentClientHandlers,
} from "../../src/torrent/client.js";
import type { TorrentStats } from "../../src/model/torrent.js";

export interface FakeSourceOptions {
  groups?: SourceAdapter["groups"];
  categories?: readonly MediaCategory[];
  timeoutMs?: number;
  concurrency?: number;
  reportsHealth?: boolean;
  delayMs?: number;
}

export function fakeSource(
  id: string,
  name: string,
  results: SearchResult[],
  opts: FakeSourceOptions = {},
): SourceAdapter {
  const o: {
    groups: SourceAdapter["groups"];
    categories: readonly MediaCategory[];
    timeoutMs: number;
    concurrency: number;
    reportsHealth: boolean;
    delayMs: number;
  } = {
    groups: ["Movies", "TV"] as SourceAdapter["groups"],
    categories: ["Movie", "TV"] as readonly MediaCategory[],
    timeoutMs: 5000,
    concurrency: 1,
    reportsHealth: true,
    delayMs: 0,
    ...opts,
  };
  return {
    id,
    name,
    groups: o.groups,
    categories: o.categories,
    homepage: `https://example.com/${id}`,
    timeoutMs: o.timeoutMs,
    concurrency: o.concurrency,
    reportsHealth: o.reportsHealth,
    async search(_query: string, ctx: SearchContext): Promise<SearchResult[]> {
      await delay(o.delayMs, ctx.signal);
      throwIfAborted(ctx.signal);
      return results;
    },
  };
}

export function failingSource(
  id: string,
  name: string,
  error: Error,
  opts: { kind?: SourceErrorKind; timeoutMs?: number } = {},
): SourceAdapter {
  return {
    id,
    name,
    groups: ["Movies"],
    categories: ["Movie"],
    homepage: `https://example.com/${id}`,
    timeoutMs: opts.timeoutMs ?? 5000,
    concurrency: 1,
    reportsHealth: true,
    async search(_query: string, ctx: SearchContext): Promise<SearchResult[]> {
      throwIfAborted(ctx.signal);
      throw error;
    },
  };
}

/** A source that never settles within its timeout (tests timeout handling). */
export function hangingSource(id: string, name: string, opts: { timeoutMs?: number } = {}): SourceAdapter {
  return {
    id,
    name,
    groups: ["General"],
    categories: ["Other"],
    homepage: `https://example.com/${id}`,
    timeoutMs: opts.timeoutMs ?? 500,
    concurrency: 1,
    reportsHealth: true,
    search(_query: string, ctx: SearchContext): Promise<SearchResult[]> {
      return new Promise((_resolve, reject) => {
        if (ctx.signal.aborted) {
          reject(new Error("aborted"));
          return;
        }
        const timer = setTimeout(() => {
          if (!ctx.signal.aborted) reject(new Error("hanging source aborted"));
        }, 60_000);
        ctx.signal.addEventListener(
          "abort",
          () => {
            clearTimeout(timer);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
    },
  };
}

export function result(partial: Partial<SearchResult> & { infohash: string }): SearchResult {
  return {
    title: partial.title ?? partial.infohash,
    magnet: `magnet:?xt=urn:btih:${partial.infohash}`,
    sourceId: partial.sourceId ?? "test",
    ...partial,
  };
}

export function makeTorrentStats(partial: Partial<TorrentStats> = {}): TorrentStats {
  return {
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
    ready: true,
    ...partial,
  };
}

/** Fake TorrentClient that completes downloads immediately. */
export class FakeClient implements TorrentClient {
  readonly kind = "fake";
  adds = new Map<string, TorrentClientAdd>();
  removed = new Set<string>();
  private handlers = new Map<string, TorrentClientHandlers>();
  private speedLimits: SpeedLimits = { download: 0, upload: 0 };

  add(input: TorrentClientAdd, handlers: TorrentClientHandlers): void {
    this.adds.set(input.id, input);
    this.handlers.set(input.id, handlers);
    queueMicrotask(() => handlers.onDone(input.id));
  }

  pause(id: string): void {
    void id;
  }

  resume(id: string): void {
    void id;
  }

  remove(id: string): void {
    this.removed.add(id);
    this.adds.delete(id);
    this.handlers.delete(id);
  }

  get(id: string): TorrentStats | null {
    return this.adds.has(id) ? makeTorrentStats({ progress: 1, downloaded: 100 }) : null;
  }

retryMetadata(_id: string): void {}

  selectFiles(_id: string, _paths: string[]): void {}

  stats(): ClientStats {
    return { downloadSpeed: 0, uploadSpeed: 0, active: this.adds.size };
  }

  setSpeedLimits(limits: SpeedLimits): void {
    this.speedLimits = limits;
  }

  getSpeedLimits(): SpeedLimits {
    return this.speedLimits;
  }

  listenPort(): number | null {
    return null;
  }

  destroy(): void {
    this.adds.clear();
    this.handlers.clear();
  }
}

/** Fake TorrentClient that completes only when told to (for pause/resume tests). */
export class ManualClient implements TorrentClient {
  readonly kind = "manual";
  adds = new Map<string, TorrentClientAdd>();
  removed = new Set<string>();
  retried = new Set<string>();
  private handlers = new Map<string, TorrentClientHandlers>();
  private statsOverrides = new Map<string, TorrentStats>();

  add(input: TorrentClientAdd, handlers: TorrentClientHandlers): void {
    this.adds.set(input.id, input);
    this.handlers.set(input.id, handlers);
  }

  setStats(id: string, stats: Partial<TorrentStats>): void {
    this.statsOverrides.set(id, makeTorrentStats({ ...this.get(id) ?? {}, ...stats }));
  }

  fireDone(id: string): void {
    this.handlers.get(id)?.onDone(id);
  }

  fireError(id: string, message: string): void {
    this.handlers.get(id)?.onError(id, message);
  }

  fireMetadata(id: string, meta: { name: string; total: number; files?: number; fileList?: { path: string; length: number }[] }): void {
    this.handlers.get(id)?.onMetadata(id, {
      name: meta.name,
      total: meta.total,
      files: meta.files ?? 1,
      fileList: meta.fileList,
    });
  }

  fireDiagnostics(id: string, patch: object): void {
    this.handlers.get(id)?.onDiagnostics?.(id, patch);
  }

  pause(id: string): void {
    void id;
  }

  resume(id: string): void {
    void id;
  }

  remove(id: string): void {
    this.removed.add(id);
    this.adds.delete(id);
    this.handlers.delete(id);
    this.statsOverrides.delete(id);
  }

  get(id: string): TorrentStats | null {
    if (!this.adds.has(id)) return null;
    return this.statsOverrides.get(id) ?? makeTorrentStats({ progress: 0.4, downloaded: 40, total: 100, ready: true });
  }

  retryMetadata(id: string): void {
    this.retried.add(id);
  }

  selectFiles(_id: string, _paths: string[]): void {}

  stats(): ClientStats {
    return { downloadSpeed: 0, uploadSpeed: 0, active: this.adds.size };
  }

  setSpeedLimits(_limits: SpeedLimits): void {}

  listenPort(): number | null {
    return null;
  }

  destroy(): void {
    this.adds.clear();
    this.handlers.clear();
    this.statsOverrides.clear();
  }
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(new Error("aborted"));
      },
      { once: true },
    );
  });
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new Error("aborted");
}
