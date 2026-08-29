/**
 * Magnet URI / infohash / .torrent file parsing. Pure functions, no I/O.
 */
import parseTorrent from "parse-torrent";
import type { ParsedTorrent } from "parse-torrent";

/**
 * Fallback public trackers. These are appended (never replacing trackers that
 * are already embedded in a magnet) to every torrent the download pipeline
 * starts, so discovery works even on a cold DHT.
 */
export const PUBLIC_TRACKERS: readonly string[] = [
  "udp://tracker.opentrackr.org:1337/announce",
  "udp://open.demonii.com:1337/announce",
  "udp://tracker.openbittorrent.com:6969/announce",
  "udp://tracker.torrent.eu.org:451/announce",
  "udp://exodus.desync.com:6969/announce",
  "udp://open.stealth.si:80/announce",
  "udp://tracker.dler.org:6969/announce",
  "http://tracker.opentrackr.org:1337/announce",
  "http://tracker.openbittorrent.com:80/announce",
  "https://tracker.tamersunion.org:443/announce",
];

/**
 * Merge a torrent's own trackers with the fallback list, preserving order and
 * de-duplicating. Existing trackers are kept first and never replaced.
 */
export function mergeTrackers(existing: readonly string[], fallback: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of [...existing, ...fallback]) {
    const s = t.trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

export const INFOHASH_HEX_RE = /^[a-f0-9]{40}$/i;
export const INFOHASH_BASE32_RE = /^[a-z2-7]{32}$/i;

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function base32ToHex(b32: string): string | null {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const c of b32.toUpperCase()) {
    const idx = BASE32_ALPHABET.indexOf(c);
    if (idx === -1) return null;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      out += ((value >>> bits) & 0xff).toString(16).padStart(2, "0");
      value &= (1 << bits) - 1;
    }
  }
  return out.length === 40 ? out : null;
}

/** Normalize a raw hash to canonical lowercase hex (40 chars), or null. */
export function normalizeInfoHash(raw: string): string | null {
  const s = raw.trim();
  if (INFOHASH_HEX_RE.test(s)) return s.toLowerCase();
  if (INFOHASH_BASE32_RE.test(s)) {
    const hex = base32ToHex(s);
    if (hex) return hex;
  }
  return null;
}

export interface ParsedMagnet {
  /** Canonical lowercase hex infohash. */
  infoHash: string;
  /** Display name from the magnet's dn param, or the infohash. */
  name: string;
  /** The magnet URI. */
  magnet: string;
  /** Trackers embedded in the magnet. */
  trackers: string[];
  /** Raw infohash as found (hex or base32). */
  rawHash: string;
}

const MAGNET_URI_RE = /^magnet:\?(.*)$/i;
const XT_BTIH_RE = /xt=urn:btih:([^&]+)/i;

/** Build a magnet URI from a canonical infohash and name. */
export function buildMagnet(infoHash: string, name: string, trackers: readonly string[] = PUBLIC_TRACKERS): string {
  const dn = encodeURIComponent(name);
  const seen = new Set<string>();
  const tr = trackers
    .map((t) => t.trim())
    .filter((t) => {
      if (!t || seen.has(t)) return false;
      seen.add(t);
      return true;
    })
    .map((t) => `&tr=${encodeURIComponent(t)}`)
    .join("");
  return `magnet:?xt=urn:btih:${infoHash}&dn=${dn}${tr}`;
}

/** Parse a magnet URI into its parts. Returns null for non-magnets. */
export function parseMagnet(input: string): ParsedMagnet | null {
  const s = input.trim();
  const m = MAGNET_URI_RE.exec(s);
  if (!m) return null;
  const query = m[1]!;
  const xt = XT_BTIH_RE.exec(query);
  if (!xt) return null;
  const rawHash = xt[1]!;
  const infoHash = normalizeInfoHash(rawHash);
  if (!infoHash) return null;

  let name = infoHash;
  let trackers: string[] = [];
  try {
    const params = new URLSearchParams(query);
    const dn = params.get("dn");
    if (dn) name = dn;
    trackers = params.getAll("tr");
  } catch {
    /* name/trackers stay empty */
  }
  return { infoHash, name, magnet: s, trackers, rawHash };
}

/** True when the input is nothing but a bare infohash (hex or base32). */
export function isInfoHash(input: string): boolean {
  const s = input.trim();
  return INFOHASH_HEX_RE.test(s) || INFOHASH_BASE32_RE.test(s);
}

/**
 * Accept a magnet URI or a bare infohash. Bare hashes are wrapped with the
 * default public trackers so they resolve over trackers + DHT like any magnet.
 * Returns null for anything that is neither.
 */
export function parseInput(input: string): ParsedMagnet | null {
  const s = input.trim();
  const magnet = parseMagnet(s);
  if (magnet) return magnet;
  if (!isInfoHash(s)) return null;
  const infoHash = normalizeInfoHash(s)!;
  return {
    infoHash,
    name: infoHash,
    magnet: buildMagnet(infoHash, infoHash),
    trackers: [],
    rawHash: s,
  };
}

export interface TorrentFileInfo {
  infoHash: string;
  name: string;
  announce: string[];
  length: number;
  files: { name: string; path: string; length: number }[];
  private: boolean;
}

/** Parse a raw .torrent buffer into torrent identity. */
export async function parseTorrentBuffer(data: Uint8Array): Promise<TorrentFileInfo | null> {
  let parsed: ParsedTorrent;
  try {
    const result = await parseTorrent(data);
    if (!result || !result.infoHash) return null;
    parsed = result;
  } catch {
    return null;
  }
  const infoHash = normalizeInfoHash(parsed.infoHash);
  if (!infoHash) return null;
  return {
    infoHash,
    name: parsed.name ?? infoHash,
    announce: parsed.announce ?? [],
    length: parsed.length ?? 0,
    files:
      parsed.files?.map((f) => ({
        name: f.name ?? "",
        path: f.path ?? "",
        length: f.length ?? 0,
      })) ?? [],
    private: parsed.private ?? false,
  };
}

/** Parse a .torrent file's bytes and build a magnet from it. */
export async function torrentFileToMagnet(data: Uint8Array): Promise<ParsedMagnet | null> {
  const info = await parseTorrentBuffer(data);
  if (!info) return null;
  return {
    infoHash: info.infoHash,
    name: info.name,
    magnet: buildMagnet(info.infoHash, info.name, info.announce.length > 0 ? info.announce : PUBLIC_TRACKERS),
    trackers: info.announce,
    rawHash: info.infoHash,
  };
}