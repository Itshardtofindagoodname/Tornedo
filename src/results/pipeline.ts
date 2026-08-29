/**
 * Results pipeline: raw source output -> normalized -> de-duplicated -> ranked
 * -> grouped. The search consumers call this once per batch of new results.
 */
import type { InferredQuery, Release, ReleaseGroup, SearchResult } from "../model/search.js";
import { normalizeResult } from "../media/normalize.js";
import { dedupeByInfohash } from "./dedupe.js";
import { filterGroups, filterReleases, type ReleaseFilter } from "./filter.js";
import { groupReleases } from "./group.js";
import { defaultRankContext, rankReleases, type RankContext } from "./rank.js";
import { sortReleases, type SortSpec } from "./filter.js";

export interface PipelineOptions {
  healthSources: ReadonlySet<string>;
  rank?: Partial<RankContext>;
  /** Analyzed user query; matching releases get a ranking boost. */
  inferred?: InferredQuery;
  /** Source ids that line up with the inferred media type. */
  preferredSources?: ReadonlySet<string>;
}

export function buildReleases(results: readonly SearchResult[], opts: PipelineOptions): Release[] {
  const ctx: RankContext = {
    ...defaultRankContext(opts.healthSources),
    ...(opts.rank ?? {}),
    inferred: opts.inferred,
    preferredSources: opts.preferredSources,
  };
  const normalized = results.map(normalizeResult);
  const map = dedupeByInfohash(normalized);
  return rankReleases([...map.values()], ctx);
}

export function buildGroups(releases: readonly Release[], opts: PipelineOptions): ReleaseGroup[] {
  return groupReleases(releases, { sortVariants: true });
}

export function applyFilter(releases: readonly Release[], groups: readonly ReleaseGroup[], f: ReleaseFilter): {
  releases: Release[];
  groups: ReleaseGroup[];
} {
  return {
    releases: filterReleases(releases, f),
    groups: filterGroups(groups, f),
  };
}

export function sortBySpec(releases: readonly Release[], spec: SortSpec): Release[] {
  return sortReleases(releases, spec);
}

export { defaultRankContext };
export type { ReleaseFilter, RankContext, SortSpec };