/**
 * Filtering and sorting of releases and groups. Deterministic.
 */
import type { MediaCategory, Release, ReleaseGroup } from "../model/search.js";
import { compareReleases } from "./rank.js";

export interface ReleaseFilter {
  category?: MediaCategory | null;
  /** Substring match on the clean title (case-insensitive). */
  query?: string | null;
  /** Drop releases with fewer seeders than this. 0 = any. */
  minSeeders?: number;
  /** Only this exact quality tier. */
  quality?: string | null;
  /**
   * Drop releases with seeders 0 ONLY when a health-reporting source
   * contributed (a real 0-seed result). Releases whose sources report no
   * health have seeders unknown and are never dropped.
   */
  aliveOnly?: boolean;
  healthSources?: ReadonlySet<string>;
}

export function releaseMatches(r: Release, f: ReleaseFilter): boolean {
  if (f.category && r.category !== f.category) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    const hay = `${r.title} ${r.rawTitle}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.minSeeders && (r.seeders ?? 0) < f.minSeeders) return false;
  if (f.quality && r.metadata.quality !== f.quality) return false;
  if (f.aliveOnly && (r.seeders ?? 0) === 0) {
    const healthSources = f.healthSources;
    const contributedHealth = r.sources.some((s) => healthSources?.has(s));
    if (contributedHealth) return false;
  }
  return true;
}

export function filterReleases(list: readonly Release[], f: ReleaseFilter): Release[] {
  return list.filter((r) => releaseMatches(r, f));
}

export interface SortSpec {
  by: "score" | "seeders" | "size" | "added";
  dir: "asc" | "desc";
}

export function sortReleases(list: readonly Release[], spec: SortSpec = { by: "score", dir: "desc" }): Release[] {
  const out = [...list];
  const dir = spec.dir === "asc" ? 1 : -1;
  out.sort((a, b) => {
    let cmp = 0;
    switch (spec.by) {
      case "score":
        cmp = a.score - b.score;
        break;
      case "seeders":
        cmp = (a.seeders ?? 0) - (b.seeders ?? 0);
        break;
      case "size":
        cmp = (a.size ?? 0) - (b.size ?? 0);
        break;
      case "added":
        cmp = (a.added ?? 0) - (b.added ?? 0);
        break;
    }
    if (cmp !== 0) return cmp * dir;
    // Deterministic fallback.
    return compareReleases(a, b);
  });
  return out;
}

export function filterGroups(list: readonly ReleaseGroup[], f: ReleaseFilter): ReleaseGroup[] {
  return list
    .map((g) => ({
      ...g,
      releases: filterReleases(g.releases, f),
    }))
    .filter((g) => g.releases.length > 0);
}