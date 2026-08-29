/**
 * Media category classification. Uses the adapter's category hint when present,
 * but applies strong domain signals (games, music, audiobooks, podcasts) that
 * override the generic video buckets.
 */
import type { MediaCategory } from "../model/search.js";
import type { ParsedTitle } from "./title.js";

const MUSIC_CODECS: ReadonlySet<string> = new Set([
  "flac",
  "alac",
  "mp3",
  "ape",
  "wav",
  "wavpack",
  "opus",
  "vorbis",
]);

const GAME_RE = /repack|fitgirl|codex|gog|iso|steam|switch|ps4|ps5|xbox|nintendo|game[-_. ]of[-_. ]the[-_. ]year|deluxe edition|multiplayer|ripped|elamigos|dodi/i;
const AUDIOBOOK_RE = /audiobook|unabridged|abridged/i;
const PODCAST_RE = /\bpodcast\b/i;
const MUSIC_RE = /discography|soundtrack|\bost\b|lossless|hires|hi[-_. ]?res/i;

export interface ClassifyInput {
  /** Raw title as reported by the source. */
  title: string;
  parsed: ParsedTitle;
  /** Category hint from the source adapter, when any. */
  hint?: MediaCategory;
}

export function classifyMedia(input: ClassifyInput): MediaCategory {
  const { title, parsed, hint } = input;

  if (AUDIOBOOK_RE.test(title)) return "Audiobook";
  if (PODCAST_RE.test(title)) return "Podcast";
  if (GAME_RE.test(title)) return "Game";

  const musicCodec = parsed.audio.codec ? MUSIC_CODECS.has(parsed.audio.codec.toLowerCase()) : false;
  const hasAudioDepth = parsed.audio.bitDepth !== undefined || parsed.audio.sampleRate !== undefined;
  const musicSignal = musicCodec || (MUSIC_RE.test(title) && parsed.year !== undefined);
  if (musicSignal && !hasSeasonEpisode(parsed)) return "Music";

  if (hint === "Movie" || hint === "TV" || hint === "Anime" || hint === "Game" || hint === "Music") {
    return hint;
  }

  if (hasSeasonEpisode(parsed)) return "TV";
  if (parsed.year !== undefined) return "Movie";
  return "Other";
}

function hasSeasonEpisode(parsed: ParsedTitle): boolean {
  return parsed.season !== undefined || parsed.episode !== undefined;
}