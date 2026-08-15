/**
 * Deduplication: merge multiple source reports of the same infohash into one
 * Release. Identity is infohash-based; genuinely different releases keep
 * separate rows.
 */
import type { NormalizedResult, Release, ReleaseMetadata } from "../model/search.js";

export function emptyRelease(r: NormalizedResult): Release {
  return {
    infohash: r.infohash,
    title: r.title,
    rawTitle: r.rawTitle,
    category: r.category,
    size: r.size,
    seeders: r.seeders,
    leechers: r.leechers,
    files: r.files,
    metadata: { ...r.metadata },
    magnet: r.magnet,
    torrentUrls: [...r.torrentUrls],
    sources: [...r.sources],
    added: r.added,
    score: 0,
    sourceMetadata: r.sourceMetadata,
  };
}

function preferTitle(a: string, b: string): string {
  if (a.length >= b.length) return a;
  return b;
}

export function mergeRelease(base: Release, r: NormalizedResult): Release {
  const seeders = Math.max(base.seeders ?? 0, r.seeders ?? 0);
  const leechers = Math.max(base.leechers ?? 0, r.leechers ?? 0);
  const size = base.size ? base.size : r.size;
  const files = Math.max(base.files ?? 0, r.files ?? 0) || undefined;
  const added = base.added === undefined ? r.added : Math.min(base.added, r.added ?? Number.MAX_SAFE_INTEGER);
  const category =
    base.category === "Other" ? r.category : base.category === r.category ? base.category : base.category;

  return {
    infohash: base.infohash,
    title: preferTitle(base.title, r.title),
    rawTitle: base.rawTitle,
    category,
    size,
    seeders: seeders || undefined,
    leechers: leechers || undefined,
    files,
    metadata: mergeMetadata(base.metadata, r.metadata),
    magnet: base.magnet || r.magnet,
    torrentUrls: dedupeStrings([...base.torrentUrls, ...r.torrentUrls]),
    sources: dedupeStrings([...base.sources, ...r.sources]),
    added,
    score: base.score,
    sourceMetadata: base.sourceMetadata ?? r.sourceMetadata,
  };
}

function dedupeStrings(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of list) {
    if (s && !seen.has(s)) {
      seen.add(s);
      out.push(s);
    }
  }
  return out;
}

function mergeMetadata(a: ReleaseMetadata, b: ReleaseMetadata): ReleaseMetadata {
  const out: ReleaseMetadata = {
    title: a.title ?? b.title,
    year: a.year ?? b.year,
    season: a.season ?? b.season,
    episode: a.episode ?? b.episode,
    quality: a.quality ?? b.quality,
    resolution: a.resolution ?? b.resolution,
    codec: a.codec ?? b.codec,
    container: a.container ?? b.container,
    source: a.source ?? b.source,
    group: a.group ?? b.group,
    edition: dedupeStrings([...(a.edition ?? []), ...(b.edition ?? [])]),
    languages: dedupeStrings([...(a.languages ?? []), ...(b.languages ?? [])]),
    subtitles: dedupeStrings([...(a.subtitles ?? []), ...(b.subtitles ?? [])]),
    audio: a.audio?.codec ? a.audio : b.audio,
    is3d: a.is3d || b.is3d || undefined,
    hdr: a.hdr || b.hdr || undefined,
    artist: a.artist ?? b.artist,
    album: a.album ?? b.album,
    track: a.track ?? b.track,
  };
  return out;
}

/**
 * Merge a batch of normalized results by infohash. Returns a Map keyed by
 * infohash for the pipeline; ordering is preserved on first-seen.
 */
export function dedupeByInfohash(results: readonly NormalizedResult[]): Map<string, Release> {
  const map = new Map<string, Release>();
  for (const r of results) {
    if (!r.infohash) continue;
    const existing = map.get(r.infohash);
    if (existing) {
      map.set(r.infohash, mergeRelease(existing, r));
    } else {
      map.set(r.infohash, emptyRelease(r));
    }
  }
  return map;
}