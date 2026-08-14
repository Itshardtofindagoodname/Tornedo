/**
 * Deterministic ranking. The score is a weighted sum with obvious, documented
 * semantics; ties are broken by a stable comparator so the same input always
 * yields the same output.
 */
import type { Release } from "../model/search.js";
import { qualityTier } from "../media/title.js";

export interface RankContext {
  seedersWeight: number;
  qualityWeight: number;
  healthWeight: number;
  preferLarger: boolean;
  /** Source ids that report real swarm health. */
  healthSources: ReadonlySet<string>;
}

export function defaultRankContext(healthSources: ReadonlySet<string>): RankContext {
  return {
    seedersWeight: 1,
    qualityWeight: 1,
    healthWeight: 0.5,
    preferLarger: false,
    healthSources,
  };
}

/**
 * Score a release. Components:
 *  - seeders: log1p(seeders) * seedersWeight
 *  - quality: qualityTier/8 (0..1) * qualityWeight
 *  - health: +healthWeight when a health-reporting source contributed (means the
 *    seeders number is real, not an unknown 0)
 *  - size: small bonus when preferLarger and the size is known.
 */
export function rankRelease(r: Release, ctx: RankContext): number {
  const seeds = r.seeders ?? 0;
  let score = 0;
  score += ctx.seedersWeight * Math.log1p(seeds);
  const tier = qualityTier(r.metadata.quality);
  score += ctx.qualityWeight * (tier / 8);
  if (r.sources.some((s) => ctx.healthSources.has(s))) {
    score += ctx.healthWeight;
  }
  if (ctx.preferLarger) {
    const size = r.size ?? 0;
    if (size > 0) score += 0.1 * Math.log1p(size / (1 << 20));
  }
  return score;
}

/** Stable deterministic comparator for two releases. */
export function compareReleases(a: Release, b: Release): number {
  if (b.score !== a.score) return b.score - a.score;
  const as = a.seeders ?? 0;
  const bs = b.seeders ?? 0;
  if (bs !== as) return bs - as;
  const asz = a.size ?? 0;
  const bsz = b.size ?? 0;
  if (bsz !== asz) return bsz - asz;
  const t = a.title.localeCompare(b.title);
  if (t !== 0) return t;
  return a.infohash.localeCompare(b.infohash);
}

export function rankReleases(list: readonly Release[], ctx: RankContext): Release[] {
  const out = list.map((r) => ({ ...r, score: rankRelease(r, ctx) }));
  out.sort(compareReleases);
  return out;
}