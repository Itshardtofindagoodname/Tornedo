/**
 * Domain models for the streaming ("Watch") mode. These describe catalog /
 * metadata / stream-releases / playback sources independently of any provider,
 * mirroring the normalized models MovieBox-Tui uses. Provider adapters map
 * their own wire formats into these types, so the UI never sees provider
 * specifics.
 */

export type StreamProviderId =
  | "moviebox"
  | "fourkhdhub"
  | "bdix_circleftp"
  | "bdix_dhakaflix"
  | "addons"
  | "tv"
  | "torrent";

export const STREAM_PROVIDERS: readonly StreamProviderId[] = [
  "moviebox",
  "fourkhdhub",
  "bdix_circleftp",
  "bdix_dhakaflix",
  "torrent",
];

export function isStreamProviderId(value: string): value is StreamProviderId {
  return (STREAM_PROVIDERS as readonly string[]).includes(value) || value === "addons" || value === "tv";
}

export function providerLabel(id: StreamProviderId): string {
  switch (id) {
    case "moviebox":
      return "MovieBox";
    case "fourkhdhub":
      return "4KHDHub";
    case "bdix_circleftp":
      return "CircleFTP (BDIX)";
    case "bdix_dhakaflix":
      return "DhakaFlix (BDIX)";
    case "addons":
      return "Addons";
    case "tv":
      return "TV";
    case "torrent":
      return "Torrent";
  }
}

export type StreamMediaType = "movie" | "series" | "tv" | "unknown";

export interface StreamCatalogItem {
  /** Provider this item came from ("moviebox", "addons", ...). */
  provider: StreamProviderId;
  /** Provider-local subject id. */
  id: string;
  title: string;
  mediaType: StreamMediaType;
  year?: string;
  posterUrl?: string;
  seasonCount?: number;
  /** Provider-specific bits (e.g. 4KHDHub detail path). */
  extra?: Record<string, unknown>;
}

export interface StreamEpisode {
  season: number;
  number: number;
  title?: string;
}

export interface StreamSeason {
  number: number;
  episodes: StreamEpisode[];
}

export interface StreamDetails {
  provider: StreamProviderId;
  id: string;
  title: string;
  mediaType: StreamMediaType;
  year?: string;
  description?: string;
  tagline?: string;
  imdbRating?: string;
  director?: string;
  stars?: string;
  prints?: string;
  audios?: string;
  duration?: string;
  genres: string[];
  posterUrl?: string;
  seasons: StreamSeason[];
}

/** A resolvable playable candidate found on a details/release page. */
export interface StreamMirror {
  label: string;
  resolverUrl: string;
  headers: Record<string, string>;
  directFile: boolean;
}

export interface StreamSubtitleOption {
  name: string;
  url: string;
}

export interface StreamRelease {
  /** Provider label (display name) that produced this stream. */
  provider: string;
  filename: string;
  quality?: string;
  codec?: string;
  language?: string;
  sizeBytes?: number;
  season?: number;
  episode?: number;
  mirrors: StreamMirror[];
  /** MovieBox resource id, used for subtitle ("ext captions") lookups. */
  resourceId?: string;
  /** Subject id this release belongs to (MovieBox). */
  subjectId?: string;
}

export interface SourceHeader {
  name: string;
  value: string;
}

/** What the player actually consumes. */
export interface PlaybackSource {
  provider: StreamProviderId;
  url: string;
  headers: Record<string, string>;
  subtitle?: string;
  sourceLabel: string;
}

export interface TvChannel {
  id: string;
  name: string;
  logo?: string;
  group?: string;
  streamUrl: string;
  tvgId?: string;
}

/** Graded stream quality tiers used for ranking (higher is better). */
export function qualityScore(quality: string | undefined): number {
  const q = (quality ?? "").toLowerCase();
  if (q.includes("2160p") || q.includes("4k") || q.includes("uhd")) return 40;
  if (q.includes("1080p") || q.includes("fhd")) return 30;
  if (q.includes("720p")) return 20;
  if (q.includes("480p") || q.includes("sd")) return 10;
  return 0;
}

export type StreamErrorKind = "network" | "rateLimited" | "notFound" | "parsing" | "unavailable";

export class StreamError extends Error {
  readonly kind: StreamErrorKind;
  readonly provider?: StreamProviderId;
  /** When rate-limited: suggested backoff before retrying. */
  readonly retryAfterMs?: number;

  constructor(kind: StreamErrorKind, message: string, opts?: { provider?: StreamProviderId; retryAfterMs?: number }) {
    super(message);
    this.name = "StreamError";
    this.kind = kind;
    this.provider = opts?.provider;
    this.retryAfterMs = opts?.retryAfterMs;
  }
}