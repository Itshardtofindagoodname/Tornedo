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
import { WebTorrentClient } from "../torrent/webtorrent.js";
import { PUBLIC_TRACKERS } from "../torrent/parse.js";
import { SearchService } from "./search-service.js";

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
    this.client = opts.client ?? new WebTorrentClient({ announce: [...PUBLIC_TRACKERS] });
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