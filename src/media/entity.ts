/**
 * Media intelligence: turns normalized release metadata into a structured
 * MediaEntity (movie / tv / music / game / ...) that grouping, ranking,
 * filtering and the UI can reason about without re-parsing titles.
 */
import type { MediaCategory, MediaEntity, ReleaseMetadata } from "../model/search.js";

export interface EntityInput {
  title: string;
  category: MediaCategory;
  size?: number;
  seeders?: number;
  metadata: ReleaseMetadata;
}

const KIND_BY_CATEGORY: Record<MediaCategory, MediaEntity["kind"]> = {
  Movie: "movie",
  TV: "tv",
  Anime: "anime",
  Music: "music",
  Podcast: "podcast",
  Audiobook: "audiobook",
  Game: "game",
  Other: "other",
};

/** Build a structured media entity from a release's parsed metadata. */
export function toMediaEntity(input: EntityInput): MediaEntity {
  const { category, metadata } = input;
  const kind = KIND_BY_CATEGORY[category] ?? "other";

  const entity: MediaEntity = {
    kind,
    title: metadata.title ?? input.title,
    year: metadata.year,
    resolution: metadata.resolution,
    quality: metadata.quality,
    codec: metadata.codec,
    container: metadata.container,
    source: metadata.source,
    size: input.size,
    seeds: input.seeders,
  };

  switch (kind) {
    case "music":
    case "podcast":
    case "audiobook": {
      entity.artist = metadata.artist;
      entity.album = metadata.album;
      entity.track = metadata.track;
      entity.bitrate = metadata.audio?.bitrate;
      entity.sampleRate = metadata.audio?.sampleRate;
      entity.lossless = metadata.audio?.lossless;
      if (metadata.audio?.codec) entity.audio = metadata.audio.codec;
      break;
    }
    case "tv":
    case "anime": {
      entity.season = metadata.season;
      entity.episode = metadata.episode;
      entity.episodeRange = metadata.episodeRange;
      if (metadata.audio?.codec) entity.audio = metadata.audio.codec;
      break;
    }
    case "game": {
      entity.platform = metadata.game?.platform;
      entity.version = metadata.game?.version;
      break;
    }
    default: {
      if (metadata.audio?.codec) entity.audio = metadata.audio.codec;
      break;
    }
  }

  return entity;
}

/** Compact single-line human description of an entity, for tables/details. */
export function formatEntity(entity: MediaEntity | undefined): string {
  if (!entity) return "";
  const parts: string[] = [];
  if (entity.year) parts.push(String(entity.year));
  if (entity.quality) parts.push(entity.quality);
  if (entity.resolution) parts.push(entity.resolution);
  if (entity.codec) parts.push(entity.codec);
  if (entity.audio) parts.push(entity.audio);
  if (entity.platform) parts.push(entity.platform);
  if (entity.version) parts.push(entity.version);
  if (entity.season) parts.push(`S${String(entity.season).padStart(2, "0")}`);
  if (entity.episode) parts.push(`E${String(entity.episode).padStart(2, "0")}`);
  if (entity.episodeRange) parts.push(`(E${entity.episodeRange})`);
  if (entity.album) parts.push(entity.album);
  if (entity.artist) parts.push(entity.artist);
  if (entity.track) parts.push(entity.track);
  return parts.join(" | ");
}