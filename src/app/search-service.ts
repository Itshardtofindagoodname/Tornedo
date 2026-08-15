/**
 * SearchService: a session-based wrapper around the federated engine. As sources
 * settle, raw results are appended and the results pipeline (normalize, dedupe,
 * rank, group) rebuilds incrementally. Consumers subscribe to changes.
 */
import type { InferredQuery, MediaCategory, Release, ReleaseGroup, SearchResult } from "../model/search.js";
import type { SearchEmitter, SearchSummary, SourceAdapter, SourceFailure } from "../model/source.js";
import type { RankingConfig } from "../config/config.js";
import type { SearchEngine } from "../search/engine.js";
import { analyzeQuery } from "../media/query.js";
import { buildGroups, buildReleases, type PipelineOptions } from "../results/pipeline.js";
import { CancelledError } from "../sources/net.js";

export interface SearchServiceOptions {
  engine: SearchEngine;
  healthSources: ReadonlySet<string>;
  getRank(): RankingConfig;
  /** Current source adapters (for source preference on inferred media types). */
  getSources?(): readonly SourceAdapter[];
}

export interface SearchFailure {
  sourceId: string;
  failure: SourceFailure;
}

/** Health a source settles into, for the status strip / diagnostics. */
export type SourceHealth = "healthy" | "working" | "idle" | "degraded" | "failed" | "unsupported";

export interface SourceReport {
  status: "pending" | "ok" | "error";
  results: number;
  failure?: SourceFailure;
  /** Derived health shown in the UI status strip. */
  health: SourceHealth;
}

export class SearchSession {
  readonly query: string;
  readonly sourceIds?: string[];
  readonly category?: MediaCategory;
  /** What Tornedo inferred the user meant (see src/media/query.ts). */
  readonly inferred: InferredQuery;

  private rawResults: SearchResult[] = [];
  private releaseList: Release[] = [];
  private groupList: ReleaseGroup[] = [];
  private failures: SearchFailure[] = [];
  private sourceStats = new Map<string, SourceReport>();
  private summaryResult: SearchSummary | null = null;
  private done = false;
  private cancelled = false;
  private started = false;
  private readonly abort = new AbortController();
  private readonly listeners = new Set<(session: SearchSession) => void>();
  private readonly service: SearchServiceOptions;

  constructor(service: SearchServiceOptions, query: string, sourceIds?: string[], category?: MediaCategory) {
    this.service = service;
    this.query = query;
    this.sourceIds = sourceIds;
    this.category = category;
    this.inferred = analyzeQuery(query);
  }

  start(): void {
    if (this.started) return;
    this.started = true;
    const emitter: SearchEmitter = {
      onSourceResults: (sourceId, results) => {
        this.rawResults.push(...results);
        this.sourceStats.set(sourceId, okReport(results.length));
        this.rebuild();
        this.emit();
      },
      onSourceError: (sourceId, failure) => {
        this.failures.push({ sourceId, failure });
        this.sourceStats.set(sourceId, errorReport(failure));
        this.emit();
      },
      onComplete: (summary) => {
        this.summaryResult = summary;
        this.emit();
      },
    };

    const finish = (err?: unknown): void => {
      if (err instanceof CancelledError) {
        this.cancelled = true;
      } else if (err !== undefined) {
        this.failures.push({
          sourceId: "*",
          failure: { kind: "unavailable", message: err instanceof Error ? err.message : String(err) },
        });
      }
      this.done = true;
      this.emit();
    };

    void this.service.engine
      .search(
        { query: this.query, sourceIds: this.sourceIds, category: this.category, signal: this.abort.signal },
        emitter,
      )
      .then(() => finish())
      .catch((err: unknown) => finish(err));
  }

  cancel(): void {
    this.abort.abort();
  }

  onChange(cb: (session: SearchSession) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  onSourceError(cb: (f: SearchFailure) => void): () => void {
    const inner = (): void => {
      for (const f of this.failures) cb(f);
    };
    return this.onChange(() => inner());
  }

  private rebuild(): void {
    const preferredSources = this.preferredSourceIds();
    const opts: PipelineOptions = {
      healthSources: this.service.healthSources,
      rank: this.service.getRank(),
      inferred: this.inferred,
      preferredSources,
    };
    this.releaseList = buildReleases(this.rawResults, opts);
    this.groupList = buildGroups(this.releaseList, opts);
  }

  /** Source ids whose categories match the inferred media type. */
  private preferredSourceIds(): ReadonlySet<string> | undefined {
    const mediaType = this.inferred.mediaType;
    if (!mediaType) return undefined;
    const sources = this.service.getSources?.() ?? [];
    const ids = new Set<string>();
    for (const s of sources) {
      if (s.categories.includes(mediaType)) ids.add(s.id);
    }
    return ids.size > 0 ? ids : undefined;
  }

  private emit(): void {
    for (const cb of [...this.listeners]) cb(this);
  }

  // --- reads ----------------------------------------------------------------

  /** What Tornedo inferred about the query (see src/media/query.ts). */
  inference(): InferredQuery {
    return this.inferred;
  }

  releases(): Release[] {
    return this.releaseList;
  }

  groups(): ReleaseGroup[] {
    return this.groupList;
  }

  rawCount(): number {
    return this.rawResults.length;
  }

  failuresList(): SearchFailure[] {
    return [...this.failures];
  }

  sourceReports(): Map<string, SourceReport> {
    return new Map(this.sourceStats);
  }

  summary(): SearchSummary | null {
    return this.summaryResult;
  }

  isDone(): boolean {
    return this.done;
  }

  isCancelled(): boolean {
    return this.cancelled;
  }

  /** Resolves once every enabled source has settled (or the search aborts). */
  waitForDone(): Promise<SearchSummary> {
    return new Promise((resolve) => {
      if (this.done) {
        resolve(this.summaryResult ?? { totalResults: 0, sourcesSucceeded: 0, sourcesFailed: 0, elapsedMs: 0 });
        return;
      }
      const off = this.onChange(() => {
        if (this.done) {
          off();
          resolve(this.summaryResult ?? { totalResults: 0, sourcesSucceeded: 0, sourcesFailed: 0, elapsedMs: 0 });
        }
      });
    });
  }
}

export class SearchService {
  private readonly opts: SearchServiceOptions;

  constructor(opts: SearchServiceOptions) {
    this.opts = opts;
  }

  createSession(query: string, sourceIds?: string[], category?: MediaCategory): SearchSession {
    return new SearchSession(this.opts, query, sourceIds, category);
  }
}

function okReport(results: number): SourceReport {
  return {
    status: "ok",
    results,
    health: results > 0 ? "healthy" : "working",
  };
}

function errorReport(failure: SourceFailure): SourceReport {
  let health: SourceHealth;
  switch (failure.kind) {
    case "unsupported":
      health = "unsupported";
      break;
    case "timeout":
    case "parse":
      health = "degraded";
      break;
    case "cancelled":
      health = "idle";
      break;
    default:
      health = "failed";
      break;
  }
  return { status: "error", results: 0, failure, health };
}