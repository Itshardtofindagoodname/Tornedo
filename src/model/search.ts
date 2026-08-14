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