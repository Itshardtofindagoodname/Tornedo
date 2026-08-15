/**
 * Intelligent query analysis: Tornedo tries to understand *what* the user is
 * looking for (media type, title, artist/album, year, quality, resolution,
 * codec, language, season/episode) instead of treating every query as a bare
 * torrent search.
 *
 * The analyzer never asserts with false confidence: ambiguous queries yield a
 * low-confidence parse that the caller is free to ignore. Confidence is derived
 * from how many strong, mutually-consistent signals the query carries.
 */
import type { InferredQuery, MediaCategory } from "../model/search.js";
import { classifyMedia } from "./classify.js";
import { parseTitle } from "./title.js";

const GAME_SIGNALS = /repack|fitgirl|codex|gog|iso|steam|switch|ps4|ps5|xbox|nintendo|dodi|elamigos|deluxe edition|goty|game[-_. ]of[-_. ]the[-_. ]year/i;
const MUSIC_SIGNALS = /flac|alac|mp3|lossless|discography|hires|hi[-_. ]?res|album|soundtrack|\bost\b/i;
const AUDIOBOOK_SIGNALS = /audiobook|unabridged|abridged/i;
const PODCAST_SIGNALS = /\bpodcast\b/i;
const ANIME_SIGNALS = /anime|subsplease|nyaa|dubbed|subbed|\beat\b/i;

const STRONG_SIGNAL = 0.16;
const MEDIUM_SIGNAL = 0.1;

/**
 * Analyze a free-text search query. Returns an InferredQuery; fields are only
 * populated when the evidence supports them. Never throws.
 */
export function analyzeQuery(raw: string): InferredQuery {
  const query = raw.trim();
  const parsed = parseTitle(query);
  const signals: string[] = [];
  let confidence = 0.2;

  if (parsed.year !== undefined) {
    signals.push(`year ${parsed.year}`);
    confidence += STRONG_SIGNAL;
  }
  if (parsed.quality) {
    signals.push(`quality ${parsed.quality}`);
    confidence += STRONG_SIGNAL;
  }
  if (parsed.resolution) {
    signals.push(`resolution ${parsed.resolution}`);
    confidence += STRONG_SIGNAL;
  }
  if (parsed.codec) {
    signals.push(`codec ${parsed.codec}`);
    confidence += MEDIUM_SIGNAL;
  }
  if (parsed.season !== undefined) {
    signals.push(`season ${parsed.season}`);
    confidence += STRONG_SIGNAL;
  }
  if (parsed.episode !== undefined) {
    signals.push(`episode ${parsed.episode}`);
    confidence += STRONG_SIGNAL;
  }
  if (parsed.languages.length > 0) {
    signals.push(`language ${parsed.languages[0]}`);
    confidence += MEDIUM_SIGNAL;
  }

  // Media type signals.
  let mediaType: MediaCategory | undefined;
  const hasGame = GAME_SIGNALS.test(query);
  const hasMusic = MUSIC_SIGNALS.test(query);
  const hasAudiobook = AUDIOBOOK_SIGNALS.test(query);
  const hasPodcast = PODCAST_SIGNALS.test(query);
  const hasAnime = ANIME_SIGNALS.test(query);

  // Music "artist - album" form ("Brian Eno - Ambient 1"), a strong signal in
  // release listings. Only applied when nothing else pinned the query down.
  const rawSplit = query.split(/\s+[-–]\s+/);
  const hasDashSplit = rawSplit.length >= 2 && rawSplit[0]!.length > 0 && rawSplit[1]!.length > 0;

  if (hasAudiobook) {
    mediaType = "Audiobook";
    signals.push("audiobook");
    confidence += STRONG_SIGNAL;
  } else if (hasPodcast) {
    mediaType = "Podcast";
    signals.push("podcast");
    confidence += STRONG_SIGNAL;
  } else if (hasGame) {
    mediaType = "Game";
    signals.push("game");
    confidence += STRONG_SIGNAL;
  } else if (hasMusic) {
    mediaType = "Music";
    signals.push("music");
    confidence += MEDIUM_SIGNAL;
  } else if (hasDashSplit && parsed.year === undefined && parsed.season === undefined && parsed.episode === undefined) {
    mediaType = "Music";
    signals.push("music (artist - album)");
    confidence += STRONG_SIGNAL;
  } else if (hasAnime && (parsed.episode !== undefined || /anime/i.test(query))) {
    mediaType = "Anime";
    signals.push("anime");
    confidence += MEDIUM_SIGNAL;
  } else {
    const classified = classifyMedia({ title: query, parsed, hint: undefined });
    if (classified !== "Other") {
      mediaType = classified;
      if (classified === "Movie" && parsed.year !== undefined) {
        signals.push("movie");
        confidence += MEDIUM_SIGNAL;
      } else if (classified === "TV" && parsed.season !== undefined) {
        signals.push("tv");
        confidence += MEDIUM_SIGNAL;
      }
    }
  }

  const titleBase = parsed.title || undefined;
  if (titleBase) {
    signals.push(`title "${titleBase}"`);
    confidence += MEDIUM_SIGNAL;
  }
  let title = titleBase;

  // Music: artist / album split ("artist - album" form). The raw query keeps
  // the dash (parseTitle normalizes it away), so split the query directly.
  let artist: string | undefined;
  let album: string | undefined;
  let movie: string | undefined;
  let tvShow: string | undefined;
  let anime: string | undefined;
  let game: string | undefined;
  if (mediaType === "Music" || hasMusic || hasDashSplit) {
    if (rawSplit.length >= 2 && rawSplit[0] && rawSplit[1]) {
      artist = rawSplit[0].trim();
      album = rawSplit.slice(1).join(" - ").trim();
      title = album;
      confidence += MEDIUM_SIGNAL;
    } else if (title) {
      album = title;
    }
  }
  switch (mediaType) {
    case "Movie":
      movie = title;
      break;
    case "TV":
      tvShow = title;
      break;
    case "Anime":
      anime = title;
      break;
    case "Game":
      game = title;
      break;
    default:
      break;
  }

  confidence = Math.min(0.95, Math.max(0, confidence));

  return {
    mediaType,
    title,
    artist,
    album,
    movie,
    tvShow,
    anime,
    game,
    year: parsed.year,
    season: parsed.season,
    episode: parsed.episode,
    quality: parsed.quality,
    resolution: parsed.resolution,
    codec: parsed.codec,
    language: parsed.languages[0],
    platform: parsed.platform,
    signals,
    confidence,
  };
}

/** Whether an inferred parse is confident enough to drive UI / ranking. */
export function isConfident(inferred: InferredQuery, threshold = 0.5): boolean {
  return inferred.confidence >= threshold;
}

/** The natural-language phrase shown to the user ("I think this is a Movie"). */
export function describeInference(inferred: InferredQuery): string {
  const parts: string[] = [];
  if (inferred.title) parts.push(`"${inferred.title}"`);
  if (inferred.artist && inferred.album) parts.push(`${inferred.artist} — ${inferred.album}`);
  else if (inferred.artist) parts.push(`by ${inferred.artist}`);
  if (inferred.mediaType) parts.push(inferred.mediaType);
  if (inferred.platform) parts.push(inferred.platform);
  if (inferred.quality) parts.push(inferred.quality);
  if (inferred.resolution) parts.push(inferred.resolution);
  if (inferred.year) parts.push(String(inferred.year));
  if (inferred.season !== undefined) parts.push(`S${inferred.season}`);
  if (inferred.episode !== undefined) parts.push(`E${inferred.episode}`);
  if (inferred.language) parts.push(inferred.language);
  return parts.join(" · ") || "generic search";
}