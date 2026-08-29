/**
 * Audio metadata extraction from release titles. Audio is a first-class field:
 * codec, channels, bitrate, sample rate, bit depth, lossless-ness.
 */
import type { AudioMetadata } from "../model/search.js";

export type { AudioMetadata };

export const LOSSLESS_CODECS: ReadonlySet<string> = new Set([
  "flac",
  "alac",
  "wav",
  "wave",
  "ape",
  "wavpack",
  "lpcm",
  "pcm",
  "dts-hd ma",
  "dts-hd-master-audio",
  "dolby truehd",
  "truehd",
]);

export const LOSSLESS_AUDIO: ReadonlySet<string> = new Set(["lossless", "hi-res", "hires"]);

interface ParsedAudio {
  metadata: AudioMetadata;
  /** Substrings consumed from the title, to be stripped by the title parser. */
  consumed: string[];
}

const CODEC_PATTERNS: { re: RegExp; codec: string }[] = [
  { re: /dts[-._ ]?hd[-._ ]?ma(?:st(?:er)?)?/i, codec: "DTS-HD MA" },
  { re: /dts[-._ ]?hd[-._ ]?hr/i, codec: "DTS-HD HR" },
  { re: /dolby[-._ ]?atmos|atmos/i, codec: "Atmos" },
  { re: /dolby[-._ ]?true[-._ ]?hd|truehd/i, codec: "TrueHD" },
  { re: /dts[-._ ]?x(?!\d)/i, codec: "DTS:X" },
  { re: /\bdts\b/i, codec: "DTS" },
  { re: /e[-._ ]?ac[-._ ]?3|ddp/i, codec: "EAC3" },
  { re: /\bac3\b|\bdd[-._ ]?5\b/i, codec: "AC3" },
  { re: /\balac\b/i, codec: "ALAC" },
  { re: /\bflac\b/i, codec: "FLAC" },
  { re: /\baac(?:\b|-)/i, codec: "AAC" },
  { re: /\bopus\b/i, codec: "Opus" },
  { re: /\bvorbis\b/i, codec: "Vorbis" },
  { re: /\blpcm\b|\buncompressed pcm\b/i, codec: "LPCM" },
  { re: /\bmp3\b/i, codec: "MP3" },
  { re: /\bwav(?!pack)\b/i, codec: "WAV" },
  { re: /\bwavpack\b/i, codec: "WavPack" },
  { re: /\bape\b/i, codec: "APE" },
];

const CHANNEL_PATTERNS: { re: RegExp; label: string; channels: number }[] = [
  { re: /7\.1/i, label: "7.1", channels: 8 },
  { re: /6\.1/i, label: "6.1", channels: 7 },
  { re: /5\.1/i, label: "5.1", channels: 6 },
  { re: /4\.0/i, label: "4.0", channels: 4 },
  { re: /2\.1/i, label: "2.1", channels: 3 },
  { re: /2\.0/i, label: "2.0", channels: 2 },
  { re: /mono/i, label: "1.0", channels: 1 },
];

export function parseAudio(title: string): ParsedAudio {
  const metadata: AudioMetadata = {};
  const consumed: string[] = [];

  let work = title;
  const lowered = work.toLowerCase();

  // Codec family.
  for (const { re, codec } of CODEC_PATTERNS) {
    const m = re.exec(lowered);
    if (m && m.index >= 0) {
      metadata.codec = codec;
      metadata.lossless = LOSSLESS_CODECS.has(codec.toLowerCase());
      consumed.push(m[0]);
      break;
    }
  }

  // Channel layout.
  for (const { re, label, channels } of CHANNEL_PATTERNS) {
    const m = re.exec(work);
    if (m) {
      metadata.channelsLabel = label;
      metadata.channels = channels;
      consumed.push(m[0]);
      break;
    }
  }
  const chMatch = /\b(\d{1,2})\s*(?:ch|channel)/i.exec(work);
  if (chMatch) {
    const channels = Number(chMatch[1]);
    if (channels >= 1 && channels <= 12) {
      metadata.channels = channels;
      consumed.push(chMatch[0]);
    }
  }

  // Bit depth.
  const depthMatch = /\b(16|20|24|32)\s*-?\s*bit\b/i.exec(work);
  if (depthMatch) {
    metadata.bitDepth = Number(depthMatch[1]);
    consumed.push(depthMatch[0]);
  }

  // Sample rate.
  const rateMatch = /\b(\d{1,3}(?:\.\d)?)\s*(?:k?hz)\b/i.exec(work);
  if (rateMatch) {
    const value = Number(rateMatch[1]);
    if (rateMatch[0].toLowerCase().includes("khz")) metadata.sampleRate = Math.round(value * 1000);
    else if (value > 1000) metadata.sampleRate = Math.round(value);
    consumed.push(rateMatch[0]);
  }

  // Bitrate (kbps).
  const bitrateMatch = /\b(\d{3,4})\s*(?:kbps|kbit)\b/i.exec(work);
  if (bitrateMatch) {
    metadata.bitrate = Number(bitrateMatch[1]);
    consumed.push(bitrateMatch[0]);
  }

  // Explicit lossless marker.
  const losslessMatch = /(lossless|hi[-_ ]?res)/i.exec(lowered);
  if (losslessMatch && metadata.lossless === undefined) {
    metadata.lossless = true;
    consumed.push(losslessMatch[0]);
  }

  return { metadata, consumed };
}

/** Format audio info into a compact human string like "DTS-HD MA 5.1". */
export function formatAudio(metadata: AudioMetadata | undefined): string {
  if (!metadata) return "";
  const parts: string[] = [];
  if (metadata.codec) parts.push(metadata.codec);
  if (metadata.channelsLabel) parts.push(metadata.channelsLabel);
  else if (metadata.channels) parts.push(`${metadata.channels}ch`);
  if (metadata.bitDepth) parts.push(`${metadata.bitDepth}bit`);
  if (metadata.sampleRate) {
    const khz = metadata.sampleRate / 1000;
    parts.push(`${Number.isInteger(khz) ? khz : khz.toFixed(1)}kHz`);
  }
  if (metadata.bitrate) parts.push(`${metadata.bitrate}kbps`);
  return parts.join(" ");
}