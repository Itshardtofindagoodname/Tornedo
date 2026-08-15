/**
 * Federated search engine. Runs enabled sources concurrently (bounded by a
 * worker pool), each with its own timeout and cancellation, and streams
 * per-source outcomes through a SearchEmitter. A failing or slow source can
 * never stop the others or the whole search.
 */
import type {
  SearchContext,
  SearchEmitter,
  SearchRequest,
  SearchSummary,
  SourceAdapter,
  SourceFailure,
} from "../model/source.js";
import type { MediaCategory, SearchResult } from "../model/search.js";
import { CancelledError, ParseError, UnsupportedError } from "../sources/net.js";

export interface SearchEngineOptions {
  sources: readonly SourceAdapter[];
  isEnabled(id: string): boolean;
  defaultTimeoutMs: number;
  /** Max sources searched at once. */
  maxConcurrentSources: number;
}

interface SourceOutcome {
  sourceId: string;
  results?: SearchResult[];
  failure?: SourceFailure;
}

export class SearchEngine {
  private readonly opts: SearchEngineOptions;

  constructor(opts: SearchEngineOptions) {
    this.opts = opts;
  }

  private pool<T>(tasks: (() => Promise<T>)[], limit: number): Promise<void> {
    return new Promise((resolve) => {
      let next = 0;
      let active = 0;
      if (tasks.length === 0) {
        resolve();
        return;
      }
      const runNext = (): void => {
        while (active < limit && next < tasks.length) {
          const task = tasks[next++];
          active++;
          Promise.resolve()
            .then(task)
            .catch(() => {}) // outcomes are captured inside runSource; never throw here
            .finally(() => {
              active--;
              if (next >= tasks.length && active === 0) resolve();
              else runNext();
            });
        }
      };
      runNext();
    });
  }

  private runSource(source: SourceAdapter, query: string, signal: AbortSignal): Promise<SourceOutcome> {
    const timeoutMs = source.timeoutMs > 0 ? source.timeoutMs : this.opts.defaultTimeoutMs;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onOuterAbort = (): void => controller.abort();
    if (signal.aborted) controller.abort();
    signal.addEventListener("abort", onOuterAbort, { once: true });

    const ctx: SearchContext = { signal: controller.signal, timeoutMs };
    return Promise.resolve()
      .then(() => source.search(query, ctx))
      .then(
        (results): SourceOutcome => {
          if (controller.signal.aborted && !signal.aborted) {
            return { sourceId: source.id, failure: { kind: "timeout", message: `Timed out after ${timeoutMs}ms` } };
          }
          return { sourceId: source.id, results: Array.isArray(results) ? results : [] };
        },
        (err): SourceOutcome => {
          if (signal.aborted) {
            return { sourceId: source.id, failure: { kind: "cancelled", message: "Search cancelled" } };
          }
          if (controller.signal.aborted) {
            return { sourceId: source.id, failure: { kind: "timeout", message: `Timed out after ${timeoutMs}ms` } };
          }
          if (err instanceof CancelledError) {
            return { sourceId: source.id, failure: { kind: "cancelled", message: err.message } };
          }
          if (err instanceof ParseError) {
            return { sourceId: source.id, failure: { kind: "parse", message: err.message } };
          }
          if (err instanceof UnsupportedError) {
            return { sourceId: source.id, failure: { kind: "unsupported", message: err.message } };
          }
          const status = (err as { status?: number })?.status;
          const kind = typeof status === "number" && status >= 400 ? "http" : "unavailable";
          return {
            sourceId: source.id,
            failure: { kind, message: err instanceof Error ? err.message : String(err) },
          };
        },
      )
      .finally(() => {
        clearTimeout(timer);
        signal.removeEventListener("abort", onOuterAbort);
      });
  }

  /**
   * Run a federated search. Emitter callbacks fire as sources settle; the
   * returned promise resolves with a summary once every enabled source has
   * settled, or rejects with CancelledError if the request is aborted.
   */
  search(req: SearchRequest, emitter: SearchEmitter): Promise<SearchSummary> {
    const started = Date.now();
    const query = req.query.trim();
    const requested = req.sourceIds ? new Set(req.sourceIds) : null;
    const candidates = this.opts.sources.filter((s) => {
      if (!this.opts.isEnabled(s.id)) return false;
      if (requested && !requested.has(s.id)) return false;
      if (req.category) {
        if (!s.categories.includes(req.category) && !s.groups.some((g) => groupSupportsCategory(g, req.category!))) {
          return false;
        }
      }
      return true;
    });

    const controller = new AbortController();
    if (req.signal?.aborted) controller.abort();
    req.signal?.addEventListener("abort", () => controller.abort(), { once: true });

    return new Promise<SearchSummary>((resolve, reject) => {
      const outcomes: SourceOutcome[] = [];
      let failed = 0;
      let succeeded = 0;
      let totalResults = 0;
      let settled = 0;

      if (candidates.length === 0) {
        resolve({
          totalResults: 0,
          sourcesSucceeded: 0,
          sourcesFailed: 0,
          elapsedMs: Date.now() - started,
        });
        return;
      }

      const report = (outcome: SourceOutcome): void => {
        outcomes.push(outcome);
        settled++;
        if (outcome.failure) {
          failed++;
          emitter.onSourceError(outcome.sourceId, outcome.failure);
        } else {
          succeeded++;
          const results = outcome.results ?? [];
          totalResults += results.length;
          emitter.onSourceResults(outcome.sourceId, results);
        }
      };

      const tasks = candidates.map((source) => () =>
        this.runSource(source, query, controller.signal).then((outcome) => report(outcome)),
      );

      void this.pool(tasks, Math.max(1, this.opts.maxConcurrentSources)).then(() => {
        if (controller.signal.aborted) {
          reject(new CancelledError("Search cancelled"));
          return;
        }
        emitter.onComplete({
          totalResults,
          sourcesSucceeded: succeeded,
          sourcesFailed: failed,
          elapsedMs: Date.now() - started,
        });
        resolve({
          totalResults,
          sourcesSucceeded: succeeded,
          sourcesFailed: failed,
          elapsedMs: Date.now() - started,
        });
      });
    });
  }
}

/** Whether a source group can plausibly produce a media category. */
function groupSupportsCategory(group: string, category: MediaCategory): boolean {
  switch (group) {
    case "Movies":
      return category === "Movie";
    case "TV":
      return category === "TV" || category === "Anime";
    case "Anime":
      return category === "Anime";
    case "Games":
      return category === "Game";
    case "Music":
      return category === "Music" || category === "Podcast" || category === "Audiobook";
    case "General":
      return true;
    default:
      return false;
  }
}