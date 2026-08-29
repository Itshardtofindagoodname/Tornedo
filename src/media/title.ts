/**
 * Release title parser: turns messy torrent names into structured metadata.
 * Pure and deterministic. The parser strips recognized tokens from the title
 * so whatever remains is the clean media title.
 */
import { parseAudio, type AudioMetadata } from "./audio.js";

export interface ParsedTitle {
  /** Clean media title (tokens that weren't recognized as metadata). */
  title: string;
  year?: number;
  season?: number;
  episode?: number;
  /** Episode range for multi-episode packs, e.g. "1-24". */
  episodeRange?: string;
  quality?: string;
  resolution?: string;
  codec?: string;
  container?: string;
  source?: string;
  edition: string[];
  group?: string;
  audio: AudioMetadata;
  languages: string[];
  subtitles: string[];
  hdr: boolean;
  is3d: boolean;
  /** Games: platform (PC, PS5, Switch, ...). */
  platform?: string;
  /** Games: version / update marker. */
  version?: string;
  /** Lowercase alphanumeric key for grouping. */
  normalizedKey: string;
}

const KNOWN_GROUPS: ReadonlySet<string> = new Set([
  "yify", "yts", "yts.mx", "rarbg", "ettv", "ion10", "evo", "sparks", "ntb", "dimension",
  "fum", "lol", "galaxy", "mkcage", "terra", "utr", "xclusive", "cakes", "nogrp", "pb",
  "c0ke", "immerse", "amiable", "elite", "fgt", "qxr", "flux", "dracula", "orpheus",
  "rell", "honey", "sa89", "bae", "cocain", "kogi", "mzabi", "tbb", "smdtb", "akg",
  "myeas", "0sec", "bee", "dusc", "sbc", "teeh", "betv", "mrd", "bajskorv", "ijk", "msd",
  "kirjo", "grim", "titan", "dotb", "devise", "fico", "pixelhd", "ebp", "arsenal",
  "kralimarko", "sva", "rovers", "ftw", "spectre", "turbo", "zaza", "aus", "cinefile",
  "d-z0n3", "compulsion", "tastethepain", "encounters", "haste", "rtn", "team", "fyd",
  "mrx", "otl", "mhd", "sys", "wec", "blackpearl", "subsplease", "tgx", "playnow", "mt",
  "brrip", "mimic", "crocodile", "brd", "fc7", "fraps", "saints", "vision", "alith",
  "amiable", "meik", "zmu", "mgb", "hax", "cr", "bob", "wittys", "2rebel", "tomcat12",
  "rarbg.to", "ctrlhd", "internethulk", "paradise", "abnormal", "ghost", "trix", "hdb",
  "hdbits", "frame", "cined", "cinefil", "dum", "duco", "jtn", "p2p", "kfh", "kam",
  "greek", "low", "hq", "hdmv", "0day", "scene", "proper", "repack", "cpg", "mkv",
  "x265", "silence", "aoc", "bose", "cn", "ybn", "xs", "kiNGDOM", "guitar", "playlist",
]);

const LANGUAGES: Readonly<Record<string, string>> = {
  english: "English", eng: "English",
  french: "French", fren: "French",
  spanish: "Spanish", span: "Spanish",
  german: "German", ger: "German",
  italian: "Italian", ital: "Italian",
  portuguese: "Portuguese",
  japanese: "Japanese", jap: "Japanese", jpn: "Japanese",
  korean: "Korean", kor: "Korean",
  chinese: "Chinese", mandarin: "Chinese",
  russian: "Russian",
  turkish: "Turkish",
  dutch: "Dutch",
  swedish: "Swedish",
  polish: "Polish",
  danish: "Danish",
  norwegian: "Norwegian", norsk: "Norwegian",
  finnish: "Finnish",
  czech: "Czech",
  hindi: "Hindi",
  tamil: "Tamil",
  telugu: "Telugu",
  arabic: "Arabic",
  thai: "Thai",
  hungarian: "Hungarian",
  romanian: "Romanian",
  greek: "Greek",
  hebrew: "Hebrew",
  ukrainian: "Ukrainian",
  vietnamese: "Vietnamese",
  indonesian: "Indonesian",
  malay: "Malay",
};

const LANG_RE = new RegExp(
  `\\b(${Object.keys(LANGUAGES).join("|")})\\b`,
  "i",
);

const EDITION_PATTERNS: { re: RegExp; tag: string }[] = [
  { re: /\bdirectors?[-_. ]?cut\b/i, tag: "Director's Cut" },
  { re: /\bcollectors?[-_. ]?edition\b/i, tag: "Collector's Edition" },
  { re: /\bextended\b/i, tag: "Extended" },
  { re: /\btheatrical\b/i, tag: "Theatrical" },
  { re: /\bunrated\b/i, tag: "Unrated" },
  { re: /\bremastered\b/i, tag: "Remastered" },
  { re: /\bremaster\b/i, tag: "Remastered" },
  { re: /\bimax\b/i, tag: "IMAX" },
  { re: /\buncut\b/i, tag: "Uncut" },
  { re: /\bproper\b/i, tag: "Proper" },
  { re: /\brepack(?:ed)?\b/i, tag: "Repack" },
  { re: /\bcriterion\b/i, tag: "Criterion" },
  { re: /\bopen[-_. ]?matte\b/i, tag: "Open Matte" },
];

function normalizeSeparators(raw: string): string {
  return raw
    .replace(/[._~,|]/g, " ")
    .replace(/[()[\]]/g, " $& ")
    .replace(/\s+/g, " ")
    .trim();
}

function blankOut(work: string, start: number, len: number): string {
  return work.slice(0, start) + " ".repeat(len) + work.slice(start + len);
}

function matchWork(work: string, re: RegExp): { m: RegExpExecArray; work: string } | null {
  const m = re.exec(work);
  if (!m || m[0].length === 0) return null;
  return { m, work: blankOut(work, m.index, m[0].length) };
}

function cleanRemainder(work: string): string {
  return work
    .replace(/[()[\]\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Strip an optional trailing-known-group token from remaining text. */
function detectGroup(work: string): { group?: string; work: string } {
  const trimmed = work.trim();
  const words = trimmed.split(/\s+/);
  for (let i = words.length - 1; i >= 0; i--) {
    const word = words[i]!.replace(/[()[\]\-]/g, "").toLowerCase();
    if (word.length < 2) continue;
    if (KNOWN_GROUPS.has(word)) {
      const startIdx = trimmed.indexOf(words[i]!);
      return { group: words[i]!.replace(/[()[\]\-]/g, ""), work: blankOut(trimmed, startIdx, words[i]!.length) };
    }
    break;
  }
  return { work };
}

const YEAR_RE = /\b(1[89]\d{2}|20\d{2})\b/;
const SEASON_EPISODE_RE = /\bs(\d{1,2})\s*e(\d{1,3})\b/i;
const SEASON_RE = /\bs(\d{1,2})\b/i;
const SEASON_WORD_RE = /\bseason\s+(\d{1,2})\b/i;
const EPISODE_WORD_RE = /\b(?:episode|ep)\.?\s+(\d{1,3})\b/i;
/** Combined "S02E01-E03" range (season + start/end episode). */
const SEASON_EPISODE_RANGE_RE = /\bs(\d{1,2})\s*e(\d{1,3})\s*[-\u2013]\s*e(\d{1,3})\b/i;
/** Standalone "E01-E24" / "Eps 1-24" range. */
const EPISODE_RANGE_RE = /\be(?:p?\.?)?\s*(\d{1,3})\s*[-\u2013]\s*(\d{1,3})\b/i;
const ANIME_EPISODE_RE = /[-\u2013]\s*(\d{1,3})(?=\s*\(?\s*\d{3,4}p)/i;
const RESOLUTION_RE = /\b(\d{3,4})[x×](\d{3,4})\b/;
const QUALITY_RE = /\b(4320p|2160p|1440p|1080p|720p|540p|480p|360p)\b/i;
const UHD_RE = /\b(8k|4k|uhd)\b/i;
const HDR_RE = /\b(hdr10\+?|dolby\s?vision|dvhd|dvsdr|do?vi|sdr)\b/i;
const HDR_LOOSE_RE = /\b(hdr)\b/i;
const THEE_DEE_RE = /\b3d\b/i;
const CODEC_RE = /\b(h\.?264|x264|avc|h\.?265|x265|hevc|av1|vp9|xvid|divx|mpeg2|mpeg4|wmv)\b/i;
const CONTAINER_RE = /\b(mkv|mp4|avi|m2ts|webm|ogm|mov)\b/i;
const SOURCE_RE =
  /\b(web[-_. ]?dl|web[-_. ]?rip|blu[-_. ]?ray|bdr|br[-_. ]?rip|bd[-_. ]?rip|hdrip|dvd[-_. ]?rip|hdtv|hdtv[-_. ]?rip|sat[-_. ]?rip|pdtv|telesync|cam[-_. ]?rip|hdts|remux|ppv|hmax|amzn|netflix|disney[-_. ]?plus|itunes)\b/i;
const SUBTITLE_RE = /\b(multi?lang|dual|multi)?\s*(?:subs?|subtitles?|subbed)\b/i;
/** Game platforms (longest first so "Xbox One" beats "Xbox", "PS Vita" beats "PS5"). */
const PLATFORM_PATTERNS: { re: RegExp; platform: string }[] = [
  { re: /\bxbox[-_. ]?series[-_. ]?x\b/i, platform: "Xbox Series X" },
  { re: /\bxbox[-_. ]?series[-_. ]?s\b/i, platform: "Xbox Series S" },
  { re: /\bxbox[-_. ]?360\b/i, platform: "Xbox 360" },
  { re: /\bxbox[-_. ]?one\b/i, platform: "Xbox One" },
  { re: /\bxbox\b/i, platform: "Xbox" },
  { re: /\bplaystation[-_. ]?5\b|\bps5\b/i, platform: "PS5" },
  { re: /\bplaystation[-_. ]?4\b|\bps4\b/i, platform: "PS4" },
  { re: /\bplaystation[-_. ]?3\b|\bps3\b/i, platform: "PS3" },
  { re: /\bplaystation[-_. ]?vita\b|\bps[-_. ]?vita\b/i, platform: "PS Vita" },
  { re: /\bplaystation\b/i, platform: "PlayStation" },
  { re: /\bnintendo[-_. ]?switch\b|\bswitch\b/i, platform: "Switch" },
  { re: /\bwii[-_. ]?u\b/i, platform: "Wii U" },
  { re: /\bwii\b/i, platform: "Wii" },
  { re: /\b3ds\b/i, platform: "3DS" },
  { re: /\bnds\b/i, platform: "DS" },
  { re: /\bgame[-_. ]?boy[-_. ]?advance\b|\bgba\b/i, platform: "GBA" },
  { re: /\bsuper[-_. ]?nintendo\b|\bsnes\b/i, platform: "SNES" },
  { re: /\bnintendo[-_. ]?64\b|\bn64\b/i, platform: "N64" },
  { re: /\bgame[-_. ]?cube\b/i, platform: "GameCube" },
  { re: /\bnes\b/i, platform: "NES" },
  { re: /\b(?:pc|steam|gog|epic|origin|vr)\b/i, platform: "PC" },
];
const VERSION_RE = /\b(?:v|ver\.?|version|update|build)\s*(\d+(?:[. ]\d+){0,3}(?:[a-z])?)\b/i;

function qualityFromUhd(u: string): string {
  if (/^8k$/i.test(u)) return "4320p";
  return "2160p";
}

function sourceLabel(raw: string): string {
  const r = raw.toLowerCase();
  if (/web[-_. ]?dl/.test(r)) return "WEB-DL";
  if (/web[-_. ]?rip/.test(r)) return "WEBRip";
  if (/blu[-_. ]?ray|br[-_. ]?rip|bd[-_. ]?rip|\bbdr\b/.test(r)) return "BluRay";
  if (/hdrip/.test(r)) return "HDRip";
  if (/dvd[-_. ]?rip/.test(r)) return "DVDRip";
  if (/hdtv/.test(r)) return "HDTV";
  if (/sat/.test(r)) return "SATRip";
  if (/pdtv/.test(r)) return "PDTV";
  if (/cam/.test(r)) return "CAM";
  if (/telesync|hdts/.test(r)) return "TC";
  if (/remux/.test(r)) return "Remux";
  if (/amzn/.test(r)) return "AMZN";
  if (/netflix/.test(r)) return "Netflix";
  if (/disney/.test(r)) return "Disney+";
  if (/hmax/.test(r)) return "HBO Max";
  if (/itunes/.test(r)) return "iTunes";
  if (/ppv/.test(r)) return "PPV";
  return raw;
}

export function parseTitle(raw: string): ParsedTitle {
  let work = normalizeSeparators(raw);
  const parsed: ParsedTitle = {
    title: "",
    edition: [],
    audio: {},
    languages: [],
    subtitles: [],
    hdr: false,
    is3d: false,
    normalizedKey: "",
  };

  // Year (including parenthesized form).
  {
    const m = /\b\((1[89]\d{2}|20\d{2})\)\b/.exec(work);
    if (m) {
      parsed.year = Number(m[1]);
      work = blankOut(work, m.index, m[0].length);
    } else {
      const res = matchWork(work, YEAR_RE);
      if (res) {
        parsed.year = Number(res.m[1]);
        work = res.work;
      }
    }
  }

  // Season / episode. Multi-episode ranges ("S02E01-E24", "Eps 1-24") are
  // detected first so the combined "S02E01-E03" form keeps its range instead of
  // only the start episode.
  {
    const mRangeCombined = SEASON_EPISODE_RANGE_RE.exec(work);
    if (mRangeCombined) {
      parsed.season = Number(mRangeCombined[1]);
      parsed.episode = Number(mRangeCombined[2]);
      parsed.episodeRange = `${Number(mRangeCombined[2])}-${Number(mRangeCombined[3])}`;
      work = blankOut(work, mRangeCombined.index, mRangeCombined[0].length);
    }
    const mRange = EPISODE_RANGE_RE.exec(work);
    if (mRange) {
      parsed.episode = Number(mRange[1]);
      parsed.episodeRange = `${Number(mRange[1])}-${Number(mRange[2])}`;
      work = blankOut(work, mRange.index, mRange[0].length);
    }
    const m = SEASON_EPISODE_RE.exec(work);
    if (m) {
      parsed.season = Number(m[1]);
      if (parsed.episode === undefined) parsed.episode = Number(m[2]);
      work = blankOut(work, m.index, m[0].length);
    } else if (parsed.episode === undefined) {
      const m2 = SEASON_WORD_RE.exec(work) ?? SEASON_RE.exec(work);
      if (m2 && parsed.season === undefined) {
        parsed.season = Number(m2[1]);
        work = blankOut(work, m2.index, m2[0].length);
      }
      const m3 = EPISODE_WORD_RE.exec(work);
      if (m3) {
        parsed.episode = Number(m3[1]);
        work = blankOut(work, m3.index, m3[0].length);
      }
    }
    // Anime-style trailing episode before a quality marker.
    if (parsed.episode === undefined && parsed.season === undefined) {
      const m4 = ANIME_EPISODE_RE.exec(work);
      if (m4) {
        parsed.episode = Number(m4[1]);
        work = blankOut(work, m4.index, m4[0].length);
      }
    }
  }

  // Resolution.
  {
    const res = matchWork(work, RESOLUTION_RE);
    if (res) {
      parsed.resolution = `${res.m[1]}x${res.m[2]}`;
      work = res.work;
    }
  }

  // Quality (UHD first so 4K/8K don't double up with 2160p tags).
  {
    const uhd = matchWork(work, UHD_RE);
    if (uhd) {
      parsed.quality = qualityFromUhd(uhd.m[1]!);
      work = uhd.work;
      // The numeric token (2160p/4320p) usually accompanies the UHD tag.
      const num = matchWork(work, QUALITY_RE);
      if (num) work = num.work;
    } else {
      const res = matchWork(work, QUALITY_RE);
      if (res) {
        parsed.quality = res.m[1]!.toLowerCase();
        work = res.work;
      }
    }
  }

  // HDR / 3D.
  {
    const res = matchWork(work, HDR_RE);
    if (res) {
      parsed.hdr = true;
      work = res.work;
    } else {
      const res2 = matchWork(work, HDR_LOOSE_RE);
      if (res2) {
        parsed.hdr = true;
        work = res2.work;
      }
    }
    const res3 = matchWork(work, THEE_DEE_RE);
    if (res3) {
      parsed.is3d = true;
      work = res3.work;
    }
  }

  // Video codec.
  {
    const res = matchWork(work, CODEC_RE);
    if (res) {
      parsed.codec = res.m[1]!.toLowerCase().replace(/\./g, "").replace(/h(?=264|265)/, "h");
      work = res.work;
    }
  }

  // Container.
  {
    const res = matchWork(work, CONTAINER_RE);
    if (res) {
      parsed.container = res.m[1]!.toLowerCase();
      work = res.work;
    }
  }

  // Release source.
  {
    const res = matchWork(work, SOURCE_RE);
    if (res) {
      parsed.source = sourceLabel(res.m[1]!);
      work = res.work;
    }
  }

  // Game platform / version.
  {
    for (const { re, platform } of PLATFORM_PATTERNS) {
      const m = re.exec(work);
      if (m) {
        parsed.platform = platform;
        work = blankOut(work, m.index, m[0].length);
        break;
      }
    }
    const vm = matchWork(work, VERSION_RE);
    if (vm) {
      // Separator normalization turned "v2.1" into "v2 1" - restore the dots.
      parsed.version = vm.m[1]!.replace(/\s+/g, ".");
      work = vm.work;
    }
  }

  // Audio metadata.
  {
    const audio = parseAudio(work);
    parsed.audio = audio.metadata;
    for (const consumed of audio.consumed) {
      const idx = work.indexOf(consumed);
      if (idx >= 0) work = blankOut(work, idx, consumed.length);
    }
  }

  // Languages.
  {
    const seen = new Set<string>();
    let matched = true;
    while (matched) {
      matched = false;
      const m = LANG_RE.exec(work);
      if (m) {
        const lang = LANGUAGES[m[1]!.toLowerCase()]!;
        if (!seen.has(lang)) {
          seen.add(lang);
          parsed.languages.push(lang);
        }
        work = blankOut(work, m.index, m[0].length);
        matched = true;
      }
    }
  }

  // Subtitles.
  {
    const m = SUBTITLE_RE.exec(work);
    if (m) {
      parsed.subtitles.push(m[1] ? "Multi" : "Yes");
      work = blankOut(work, m.index, m[0].length);
    }
  }

  // Edition tags.
  {
    for (const { re, tag } of EDITION_PATTERNS) {
      const m = re.exec(work);
      if (m) {
        if (!parsed.edition.includes(tag)) parsed.edition.push(tag);
        work = blankOut(work, m.index, m[0].length);
      }
    }
  }

  // Release group (trailing token).
  {
    const group = detectGroup(work);
    if (group.group) parsed.group = group.group;
    work = group.work;
  }

  parsed.title = cleanRemainder(work);
  parsed.normalizedKey = parsed.title.toLowerCase().replace(/[^a-z0-9]+/g, "");
  return parsed;
}

/** Quality tier for ranking: higher is better. */
export function qualityTier(quality?: string): number {
  switch (quality) {
    case "4320p":
      return 8;
    case "2160p":
      return 7;
    case "1440p":
      return 6;
    case "1080p":
      return 5;
    case "720p":
      return 4;
    case "540p":
      return 3;
    case "480p":
      return 2;
    case "360p":
      return 1;
    default:
      return 0;
  }
}