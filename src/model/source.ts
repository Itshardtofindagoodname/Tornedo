/**
 * Search source (adapter) contract. Every source adapter implements this
 * interface; the federated search engine is the only thing that drives them.
 */
import type { MediaCategory, SearchResult } from "./search.js";

export type SourceGroup = "Movies" | "TV" | "Anime" | "Games" | "Music" | "General";

export const SOURCE_GROUPS: readonly SourceGroup[] = [
  "Movies",
  "TV",
  "Anime",
  "Games",
  "Music",
  "General",
];

export interface SearchContext {
  signal: AbortSignal;
  /** Per-source timeout in ms. */
  timeoutMs: number;
}

/** Failure modes the engine surfaces per source. */
export type SourceErrorKind =
  | "timeout"
  | "http"
  | "parse"
  | "unavailable"
  | "cancelled"
  | "unsupported";

export const SOURCE_ERROR_KINDS: readonly SourceErrorKind[] = [
  "timeout",
  "http",
  "parse",
  "unavailable",
  "cancelled",
  "unsupported",
];

export interface SourceFailure {
  kind: SourceErrorKind;
  message: string;
}

export interface SourceAdapter {
  id: string;
  name: string;
  groups: readonly SourceGroup[];
  /** Categories this source plausibly returns. */
  categories: readonly MediaCategory[];
  homepage: string;
  /** Default per-request timeout in ms. */
  timeoutMs: number;
  /** Max parallel requests this source may make at once. */
  concurrency: number;
  /** False when the source reports no real swarm counts (seeders: 0 = unknown). */
  reportsHealth: boolean;
  /** Run a search. Must reject on abort; should never throw raw, but the engine
   *  guards regardless. */
  search(query: string, ctx: SearchContext): Promise<SearchResult[]>;
}

export interface SearchSourceState {
  adapter: SourceAdapter;
  enabled: boolean;
}

/** Progressive federated-search result channel. */
export interface SearchEmitter {
  /** Called as each source finishes, with its results. */
  onSourceResults(sourceId: string, results: SearchResult[]): void;
  /** Called when a source finishes with an error. */
  onSourceError(sourceId: string, failure: SourceFailure): void;
  /** Called once all enabled sources have settled. */
  onComplete(summary: SearchSummary): void;
}

export interface SearchSummary {
  totalResults: number;
  sourcesSucceeded: number;
  sourcesFailed: number;
  elapsedMs: number;
}

export interface SearchRequest {
  query: string;
  /** Override the globally enabled set; defaults to all enabled sources. */
  sourceIds?: string[];
  /** Restrict to sources that can produce this media category (e.g. "Music"). */
  category?: MediaCategory;
  /** Cancel the whole search. */
  signal?: AbortSignal;
}