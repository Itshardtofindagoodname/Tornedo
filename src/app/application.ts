/**
 * Application wiring: config, database, torrent client, manager and search
 * engine composed into one lifecycle-owned object. UI and CLI code depend on
 * this, never on the underlying subsystems' internals.
 */
import type { TornedoConfig } from "../config/config.js";
import { defaultConfig, ensureConfigMigrated, loadConfig, saveConfig } from "../config/config.js";
import { openDatabase, openInMemoryHandle, type DatabaseHandle } from "../database/db.js";
import { TorrentStore } from "../database/store.js";
import { TorrentManager } from "../downloads/manager.js";
import type { SourceAdapter } from "../model/source.js";
import { SearchEngine } from "../search/engine.js";
import { dynamicSources } from "../sources/dynamic.js";
import { SOURCES } from "../sources/registry.js";
import type { TorrentClient } from "../torrent/client.js";
import { LazyTorrentClient } from "../torrent/lazy.js";
import { PUBLIC_TRACKERS } from "../torrent/parse.js";
import { SearchService } from "./search-service.js";

/** How many recent search queries are remembered (persisted across runs). */
export const MAX_RECENT_SEARCHES = 8;

const RECENT_SEARCHES_KEY = "search:recent";

export interface ApplicationOptions {
  /** Skip loading persisted config (used by tests / `config init`). */
  freshConfig?: boolean;
  /** In-memory database (tests). */
  memoryDb?: boolean;
  /** Custom torrent client (tests). */
  client?: TorrentClient;
}

export class Application {
  readonly db: DatabaseHandle;
  readonly store: TorrentStore;
  readonly manager: TorrentManager;
  sources: readonly SourceAdapter[];
  healthSources: ReadonlySet<string>;
  searchEngine!: SearchEngine;
  searchService!: SearchService;

  private configState: TornedoConfig;
  private client: TorrentClient;
  private suspended = false;

  private constructor(opts: ApplicationOptions) {
    this.db = opts.memoryDb ? openMemoryHandle() : openDatabase();
    this.store = new TorrentStore(this.db.db);
    // The torrent engine (WebTorrent: DHT, ports, NAT, trackers) costs seconds
    // to construct and its module import alone is ~200ms. Build it lazily on
    // first use (dynamic import included) so a search-only session starts
    // instantly — the engine materializes the moment a torrent is queued.
    this.client =
      opts.client ??
      new LazyTorrentClient(async () => {
        const { WebTorrentClient } = await import("../torrent/webtorrent.js");
        return new WebTorrentClient({ announce: [...PUBLIC_TRACKERS] });
      });
    this.configState = defaultConfig();
    this.sources = SOURCES;
    this.healthSources = new Set(SOURCES.filter((s) => s.reportsHealth).map((s) => s.id));

    this.manager = new TorrentManager({
      client: this.client,
      store: this.store,
      getConfig: () => this.configState,
    });

    this.rebuildSources();
  }

  static async create(opts: ApplicationOptions = {}): Promise<Application> {
    const app = new Application(opts);
    await app.manager.init();
    if (!opts.freshConfig) {
      app.configState = await ensureConfigMigrated();
      app.rebuildSources();
      app.manager.applyConfig();
    }
    return app;
  }

  /**
   * Rebuild the source set from the current config. Called once config is
   * loaded (and again on `config set` / reload) so user-configured Torznab and
   * Internet Archive providers take effect immediately.
   */
  private rebuildSources(): void {
    this.sources = [...SOURCES, ...dynamicSources(this.configState)];
    this.healthSources = new Set(this.sources.filter((s) => s.reportsHealth).map((s) => s.id));
    this.searchEngine = new SearchEngine({
      sources: this.sources,
      isEnabled: (id) => this.isSourceEnabled(id),
      defaultTimeoutMs: 15_000,
      maxConcurrentSources: 8,
    });
    this.searchService = new SearchService({
      engine: this.searchEngine,
      healthSources: this.healthSources,
      getRank: () => this.configState.ranking,
      getSources: () => this.sources,
    });
  }

  getConfig(): TornedoConfig {
    return this.configState;
  }

  /** The torrent engine client (used by diagnostics/doctor). */
  getClient(): TorrentClient {
    return this.client;
  }

  isSourceEnabled(id: string): boolean {
    const state = this.configState.sources[id];
    return state !== false;
  }

  setSourceEnabled(id: string, enabled: boolean): void {
    this.configState.sources[id] = enabled;
    void this.persistConfig();
  }

  async updateConfig(patch: Partial<TornedoConfig>): Promise<void> {
    this.configState = { ...this.configState, ...patch };
    await this.persistConfig();
    this.rebuildSources();
    this.manager.applyConfig();
  }

  private async persistConfig(): Promise<void> {
    try {
      await saveConfig(this.configState);
    } catch {
      /* config persistence is best-effort */
    }
  }

  /** Load config fresh (e.g. after the `config` command edits the file). */
  async reloadConfig(): Promise<void> {
    this.configState = await loadConfig();
    this.rebuildSources();
    this.manager.applyConfig();
  }

  // --- recent search history (persisted across sessions) ----------------------

  private recentSearchesCache: readonly string[] | null = null;

  /** Recent search queries, most recent first. Survives restarts (DB-backed). */
  recentSearches(): readonly string[] {
    if (this.recentSearchesCache !== null) return this.recentSearchesCache;
    let list: string[] = [];
    const raw = this.store.metaGet(RECENT_SEARCHES_KEY);
    if (raw) {
      try {
        const parsed = JSON.parse(raw) as unknown;
        if (Array.isArray(parsed)) {
          list = parsed
            .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
            .slice(0, MAX_RECENT_SEARCHES);
        }
      } catch {
        /* corrupted history — start fresh */
      }
    }
    this.recentSearchesCache = list;
    return this.recentSearchesCache;
  }

  /** Record a search query at the front of the persisted history. */
  addRecentSearch(query: string): void {
    const text = query.trim();
    if (!text) return;
    const next = [text, ...this.recentSearches().filter((x) => x !== text)].slice(0, MAX_RECENT_SEARCHES);
    this.recentSearchesCache = next;
    this.store.metaSet(RECENT_SEARCHES_KEY, JSON.stringify(next));
  }

  /** Close everything, preserving download state. Safe to call once. */
  async suspend(): Promise<void> {
    if (this.suspended) return;
    this.suspended = true;
    await this.manager.suspend();
    this.db.close();
  }
}

function openMemoryHandle(): DatabaseHandle {
  return openInMemoryHandle();
}