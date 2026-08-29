/**
 * Core search domain model. Results flow from raw source output (SearchResult)
 * through normalization/metadata parsing (NormalizedResult) into ranked,
 * de-duplicated, grouped release sets (ReleaseGroup).
 */

export type MediaCategory =
  | "Movie"
  | "TV"
  | "Anime"
  | "Music"
  | "Podcast"
  | "Audiobook"
  | "Game"
  | "Other";

export const MEDIA_CATEGORIES: readonly MediaCategory[] = [
  "Movie",
  "TV",
  "Anime",
  "Music",
  "Podcast",
  "Audiobook",
  "Game",
  "Other",
];

export const CATEGORY_SORT_ORDER: Readonly<Record<MediaCategory, number>> = {
  Movie: 0,
  TV: 1,
  Anime: 2,
  Music: 3,
  Podcast: 4,
  Audiobook: 5,
  Game: 6,
  Other: 7,
};

/**
 * What Tornedo thinks the user meant by a search query. Produced by query
 * analysis (src/media/query.ts); never asserted with false confidence - every
 * field carries the evidence that produced it and an overall confidence.
 */
export interface InferredQuery {
  /** Best-guess media type, when the evidence is strong enough. */
  mediaType?: MediaCategory;
  /** Cleaned title of the thing the user is looking for. */
  title?: string;
  /** Music: the artist part of an "artist - album" query. */
  artist?: string;
  /** Music: the album part of an "artist - album" query. */
  album?: string;
  /** Movie title, when classified as a movie. */
  movie?: string;
  /** TV show title, when classified as TV. */
  tvShow?: string;
  /** Anime title, when classified as anime. */
  anime?: string;
  /** Game title, when classified as a game. */
  game?: string;
  year?: number;
  season?: number;
  episode?: number;
  /** "1080p", "2160p", ... */
  quality?: string;
  /** "3840x2160", ... */
  resolution?: string;
  /** h264, h265, xvid, ... */
  codec?: string;
  language?: string;
  /** Games: platform (PS5, Switch, PC, ...). */
  platform?: string;
  /** Human-readable list of what was detected, for display. */
  signals: string[];
  /** 0..1 - how sure the analyzer is about the whole parse. */
  confidence: number;
}

/** Video game release facts (platform, version) parsed from game titles. */
export interface GameMetadata {
  /** Platform: PC, PS4, PS5, Xbox, Switch, Nintendo, VR, ... */
  platform?: string;
  /** Version/update/build markers, e.g. "v1.2.3", "Update 2". */
  version?: string;
  /** Repack/deluxe/goty style release modifiers. */
  edition?: string;
}

/** Structured "media intelligence": a release as a normalized media entity. */
export interface MediaEntity {
  kind: "movie" | "tv" | "anime" | "music" | "game" | "audiobook" | "podcast" | "other";
  title: string;
  year?: number;
  resolution?: string;
  quality?: string;
  codec?: string;
  container?: string;
  source?: string;
  audio?: string;
  size?: number;
  seeds?: number;
  /** Music. */
  artist?: string;
  album?: string;
  track?: string;
  bitrate?: number;
  sampleRate?: number;
  lossless?: boolean;
  /** TV / anime. */
  season?: number;
  episode?: number;
  episodeRange?: string;
  /** Games. */
  platform?: string;
  version?: string;
}

/** Audio metadata recognized from release titles. Audio is a first-class field. */
export interface AudioMetadata {
  /** Codec family, e.g. "AAC", "AC3", "DTS", "FLAC", "MP3", "Opus". */
  codec?: string;
  /** Channel count when numeric (2, 6, 8...). */
  channels?: number;
  /** Channel layout label, e.g. "5.1", "7.1", "2.0". */
  channelsLabel?: string;
  /** Bitrate in kbps when present. */
  bitrate?: number;
  /** Sample rate in Hz. */
  sampleRate?: number;
  /** Bit depth (16, 24, 32). */
  bitDepth?: number;
  /** True for lossless codecs (FLAC, ALAC, WAV, APE, DTS-HD MA...). */
  lossless?: boolean;
}

/** Structured metadata parsed out of a release title. */
export interface ReleaseMetadata {
  /** Cleaned media title. */
  title?: string;
  year?: number;
  season?: number;
  episode?: number;
  /** "2160p", "1080p", "720p", "480p"... */
  quality?: string;
  /** Numeric resolution, e.g. "3840x2160". */
  resolution?: string;
  /** Video codec, e.g. "h264", "h265", "xvid", "av1", "vp9". */
  codec?: string;
  /** Container, e.g. "mkv", "mp4". */
  container?: string;
  /** Release source, e.g. "WEB-DL", "BluRay", "HDRip", "CAM". */
  source?: string;
  /** Release group, e.g. "RARBG", "YIFY", "SubsPlease". */
  group?: string;
  /** Edition tags, e.g. "Extended", "Theatrical", "Remastered". */
  edition?: string[];
  /** Spoken languages, e.g. ["English", "Japanese"]. */
  languages?: string[];
  /** Subtitle languages, e.g. ["English", "Multi"]. */
  subtitles?: string[];
  audio?: AudioMetadata;
  /** True when the release is 3D. */
  is3d?: boolean;
  /** True when the release has HDR metadata. */
  hdr?: boolean;
  /** For music: artist. */
  artist?: string;
  /** For music: album. */
  album?: string;
  /** For music: track title. */
  track?: string;
  /** For TV/anime: episode range ("1-24", "Complete"). */
  episodeRange?: string;
  /** For games: platform, version, edition. */
  game?: GameMetadata;
}

/** A single result as reported by one source, before normalization. */
export interface SearchResult {
  /** Canonical hex info hash (40 lowercase hex chars). */
  infohash: string;
  /** Display title as the source reported it. */
  title: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  files?: number;
  sourceId: string;
  magnet: string;
  torrentUrl?: string;
  category?: MediaCategory;
  /** Unix seconds. */
  added?: number;
  /**
   * Provider-specific metadata to preserve through normalization (e.g. an
   * Internet Archive item's license/identifier, a Torznab uploader). Never
   * used for ranking; purely informational.
   */
  sourceMetadata?: Record<string, unknown>;
}

/** A result after normalization, metadata parsing and source de-duplication. */
export interface NormalizedResult {
  /** Canonical infohash. */
  infohash: string;
  /** Clean media title. */
  title: string;
  /** The raw title as first observed. */
  rawTitle: string;
  category: MediaCategory;
  size?: number;
  seeders?: number;
  leechers?: number;
  files?: number;
  metadata: ReleaseMetadata;
  magnet: string;
  /** Torrent page URLs observed from any reporting source. */
  torrentUrls: string[];
  /** Source ids that reported this exact infohash. */
  sources: string[];
  /** Unix seconds, earliest observed. */
  added?: number;
  /** Media intelligence entity (see src/media/entity.ts). */
  entity?: MediaEntity;
  /** Preserved provider-specific metadata (see SearchResult.sourceMetadata). */
  sourceMetadata?: Record<string, unknown>;
}

/** One release: multiple source reports merged into a single row. */
export interface Release {
  infohash: string;
  title: string;
  rawTitle: string;
  category: MediaCategory;
  size?: number;
  seeders?: number;
  leechers?: number;
  files?: number;
  metadata: ReleaseMetadata;
  magnet: string;
  torrentUrls: string[];
  sources: string[];
  added?: number;
  /** Aggregate ranking score (higher = better). */
  score: number;
  /** Media intelligence entity (see src/media/entity.ts), set by the pipeline. */
  entity?: MediaEntity;
  /** Preserved provider-specific metadata (see SearchResult.sourceMetadata). */
  sourceMetadata?: Record<string, unknown>;
}

/** Related releases (same title/year/season) grouped across qualities. */
export interface ReleaseGroup {
  key: string;
  title: string;
  category: MediaCategory;
  year?: number;
  season?: number;
  releases: Release[];
  /** Best score among the contained releases. */
  score: number;
}