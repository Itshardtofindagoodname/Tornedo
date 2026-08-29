/**
 * Release grouping: related releases (same title/year/season) become one group,
 * with each quality as a variant. Genuinely different releases never merge.
 */
import type { MediaCategory, Release, ReleaseGroup } from "../model/search.js";

function normalizeKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function groupKeyFor(r: Release): string {
  const title = normalizeKey(r.metadata.title ?? r.title);
  if (r.category === "Music") {
    const artist = normalizeKey(r.metadata.artist ?? "");
    const album = normalizeKey(r.metadata.album ?? "");
    return `music:${artist}|${album}`;
  }
  if (r.category === "TV" || r.category === "Anime") {
    return `${r.category.toLowerCase()}:${title}:${r.metadata.season ?? ""}`;
  }
  return `${r.category.toLowerCase()}:${title}:${r.metadata.year ?? ""}`;
}

export interface GroupReleaseOptions {
  /** Sort variants within a group by quality then seeders. */
  sortVariants?: boolean;
}

/** Group releases by related identity. Deterministic given the input order. */
export function groupReleases(
  releases: readonly Release[],
  opts: GroupReleaseOptions = {},
): ReleaseGroup[] {
  const groups = new Map<string, ReleaseGroup>();
  const order: string[] = [];

  for (const release of releases) {
    const key = groupKeyFor(release);
    let group = groups.get(key);
    if (!group) {
      group = {
        key,
        title: release.title,
        category: release.category,
        year: release.metadata.year,
        season: release.metadata.season,
        releases: [],
        score: 0,
      };
      groups.set(key, group);
      order.push(key);
    }
    group.releases.push(release);
    if (release.title.length > group.title.length) group.title = release.title;
    if (group.year === undefined) group.year = release.metadata.year;
    if (group.season === undefined) group.season = release.metadata.season;
  }

  const out = order.map((key) => {
    const group = groups.get(key)!;
    let releases = group.releases;
    if (opts.sortVariants) {
      releases = [...releases].sort((a, b) => {
        const ta = qualityOrdinal(a.metadata.quality);
        const tb = qualityOrdinal(b.metadata.quality);
        if (tb !== ta) return tb - ta;
        return (b.seeders ?? 0) - (a.seeders ?? 0);
      });
    }
    const score = releases.reduce((max, r) => Math.max(max, r.score), 0);
    return { ...group, releases, score };
  });

  out.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const cat = CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category];
    if (cat !== 0) return cat;
    return a.title.localeCompare(b.title);
  });
  return out;
}

const CATEGORY_ORDER: Record<MediaCategory, number> = {
  Movie: 0,
  TV: 1,
  Anime: 2,
  Music: 3,
  Podcast: 4,
  Audiobook: 5,
  Game: 6,
  Other: 7,
};

function qualityOrdinal(quality?: string): number {
  switch (quality) {
    case "2160p":
      return 3;
    case "1080p":
      return 2;
    case "720p":
      return 1;
    default:
      return 0;
  }
}