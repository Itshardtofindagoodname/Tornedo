/**
 * CLI rendering: JSON serialization (used with --json, stdout JSON only) and a
 * compact human table for interactive use.
 */
import type { Release, ReleaseGroup } from "../model/search.js";
import type { TorrentItem } from "../model/torrent.js";
import type { SearchSummary, SourceFailure } from "../model/source.js";
import type { SourceReport } from "../app/search-service.js";
import { formatAudio } from "../media/audio.js";
import { formatBytes } from "../utils/bytes.js";
import { formatDuration, pad, truncate } from "../utils/duration.js";

export type { SourceReport };

export interface SearchJson {
  query: string;
  results: ReleaseJson[];
  groups: number;
  sources: Record<string, SourceReport>;
  summary: SearchSummary;
}

export interface ReleaseJson {
  infohash: string;
  title: string;
  rawTitle: string;
  category: string;
  size: number | null;
  seeders: number | null;
  leechers: number | null;
  files: number | null;
  quality: string | null;
  resolution: string | null;
  codec: string | null;
  audio: string | null;
  languages: string[] | null;
  subtitles: string[] | null;
  year: number | null;
  season: number | null;
  episode: number | null;
  source: string | null;
  group: string | null;
  sources: string[];
  magnet: string;
  score: number;
  added: number | null;
}

export function releaseToJson(r: Release): ReleaseJson {
  const m = r.metadata;
  return {
    infohash: r.infohash,
    title: r.title,
    rawTitle: r.rawTitle,
    category: r.category,
    size: r.size ?? null,
    seeders: r.seeders ?? null,
    leechers: r.leechers ?? null,
    files: r.files ?? null,
    quality: m.quality ?? null,
    resolution: m.resolution ?? null,
    codec: m.codec ?? null,
    audio: formatAudio(m.audio) || null,
    languages: m.languages ?? null,
    subtitles: m.subtitles ?? null,
    year: m.year ?? null,
    season: m.season ?? null,
    episode: m.episode ?? null,
    source: m.source ?? null,
    group: m.group ?? null,
    sources: r.sources,
    magnet: r.magnet,
    score: Math.round(r.score * 1000) / 1000,
    added: r.added ?? null,
  };
}

export function searchToJson(
  query: string,
  releases: readonly Release[],
  reports: Record<string, SourceReport>,
  summary: SearchSummary,
): SearchJson {
  return {
    query,
    results: releases.map(releaseToJson),
    groups: 0,
    sources: reports,
    summary,
  };
}

export function torrentToJson(it: TorrentItem): Record<string, unknown> {
  return {
    infohash: it.infohash,
    name: it.name,
    category: it.category,
    status: it.status,
    progress: Math.round(it.progress * 1000) / 1000,
    downloaded: it.downloaded,
    size: it.size,
    downloadSpeed: it.downloadSpeed,
    uploadSpeed: it.uploadSpeed,
    uploaded: it.uploaded,
    peers: it.peers,
    seeds: it.seeds,
    eta: Number.isFinite(it.timeRemaining) ? it.timeRemaining : null,
    priority: it.priority,
    seedEnabled: it.seedEnabled,
    destination: it.destination,
    sourceId: it.sourceId,
    error: it.error,
    addedAt: it.queuedAt,
  };
}

// --- human table rendering ---------------------------------------------------

export function renderReleaseRow(r: Release, width: number): string {
  const cat = r.category.slice(0, 4).toUpperCase().padEnd(4);
  const seeds = r.seeders === undefined ? "   -" : String(r.seeders).padStart(4);
  const size = formatBytes(r.size);
  const quality = r.metadata.quality ? r.metadata.quality.padEnd(5) : "     ";
  const title = truncate(r.title, Math.max(10, width - 40));
  const flags: string[] = [];
  if (r.metadata.codec) flags.push(r.metadata.codec);
  if (r.metadata.source) flags.push(r.metadata.source);
  const flagStr = flags.join("/");
  return `${cat} ${seeds} ${size.padStart(10)} ${quality} ${title}`;
}

export interface TableOptions {
  width?: number;
  limit?: number;
}

export function renderSearchTable(releases: readonly Release[], opts: TableOptions = {}): string {
  const width = opts.width ?? 100;
  const limit = opts.limit ?? releases.length;
  const lines: string[] = [];
  const header = `CAT  SEED       SIZE QUAL  TITLE`;
  lines.push(header);
  for (const r of releases.slice(0, limit)) {
    lines.push(renderReleaseRow(r, width));
  }
  return lines.join("\n");
}

export function renderTorrentRow(it: TorrentItem): string {
  const status = it.status.toUpperCase().padEnd(11);
  const pct = `${Math.round(it.progress * 100)}%`.padStart(4);
  const size = formatBytes(it.size);
  const speed = it.downloadSpeed > 0 ? `${formatBytes(it.downloadSpeed)}/s` : "-";
  const eta = Number.isFinite(it.timeRemaining) ? formatDuration(it.timeRemaining) : "--";
  const peers = `${it.peers}/${it.seeds}`;
  const name = truncate(it.name, 60);
  return `${status} ${pct} ${size.padStart(10)} ${speed.padStart(10)} ${eta.padStart(8)} ${peers.padStart(8)} ${name}`;
}

export function renderDownloadsTable(items: readonly TorrentItem[]): string {
  const lines: string[] = [];
  for (const it of items) lines.push(renderTorrentRow(it));
  return lines.join("\n");
}

export { pad, truncate };
