/**
 * Normalization: turns a raw SearchResult into a NormalizedResult with a parsed
 * title, media category and structured metadata.
 */
import type { NormalizedResult, ReleaseMetadata, SearchResult } from "../model/search.js";
import { classifyMedia } from "./classify.js";
import { parseTitle } from "./title.js";

export function normalizeResult(result: SearchResult): NormalizedResult {
  const parsed = parseTitle(result.title);
  const category = classifyMedia({ title: result.title, parsed, hint: result.category });

  const metadata: ReleaseMetadata = {
    title: parsed.title || undefined,
    year: parsed.year,
    season: parsed.season,
    episode: parsed.episode,
    quality: parsed.quality,
    resolution: parsed.resolution,
    codec: parsed.codec,
    container: parsed.container,
    source: parsed.source,
    group: parsed.group,
    edition: parsed.edition.length > 0 ? parsed.edition : undefined,
    languages: parsed.languages.length > 0 ? parsed.languages : undefined,
    subtitles: parsed.subtitles.length > 0 ? parsed.subtitles : undefined,
    audio: parsed.audio,
    is3d: parsed.is3d || undefined,
    hdr: parsed.hdr || undefined,
  };

  if (category === "Music") {
    applyMusicMetadata(metadata, parsed.title);
  }

  return {
    infohash: result.infohash,
    title: parsed.title || result.title,
    rawTitle: result.title,
    category,
    size: result.size,
    seeders: result.seeders,
    leechers: result.leechers,
    files: result.files,
    metadata,
    magnet: result.magnet,
    torrentUrls: result.torrentUrl ? [result.torrentUrl] : [],
    sources: [result.sourceId],
    added: result.added,
  };
}

function applyMusicMetadata(metadata: ReleaseMetadata, title: string): void {
  const split = title.split(/\s+[-–]\s+/);
  if (split.length >= 2) {
    metadata.artist = split[0]!.trim();
    metadata.album = split.slice(1).join(" - ").trim();
    return;
  }
  const track = title.match(/^\d{1,3}[.\s]*[-–]?\s*(.+)$/);
  if (track) {
    metadata.track = track[1]!.trim();
    metadata.album = title;
  } else {
    metadata.album = title;
  }
}