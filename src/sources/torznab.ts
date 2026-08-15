/**
 * Generic Torznab-compatible provider.
 *
 * A Torznab endpoint is a self-describing indexer API (`?t=caps` advertises
 * which query modes it supports). Tornedo never assumes a particular tracker:
 * the user points a provider at any local Torznab/Newznab server (Prowlarr,
 * Jackett, nZEDb, …) and this adapter discovers what it can actually do.
 *
 * Architecture:
 *
 *   Torznab XML  ->  Torznab adapter  ->  normalized SearchResult  ->  existing
 *   search pipeline
 *
 * The rest of Tornedo never touches the XML; it consumes the same
 * `SearchResult` model every other source emits.
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { fetchText, HttpError, ParseError, UnsupportedError } from "./net.js";
import { extractTag, splitItems, unescapeEntities } from "./rss.js";
import { normalizeInfoHash } from "../torrent/parse.js";
import type { TorznabProviderConfig } from "../config/config.js";

export type TorznabMode = "search" | "music" | "movie" | "tv";

export interface TorznabCapabilities {
  /** Plain `t=search`. */
  search: boolean;
  /** `t=music`. */
  music: boolean;
  /** `t=movie`. */
  movie: boolean;
  /** `t=tvsearch`. */
  tv: boolean;
  /** Top-level Newznab category ids advertised by the endpoint. */
  categories: string[];
}

const CAPS_TTL_MS = 10 * 60_000;

const MODE_KEYS: Record<TorznabMode, keyof TorznabCapabilities> = {
  search: "search",
  music: "music",
  movie: "movie",
  tv: "tv",
};

/** Torznab API `t` parameter per mode. */
export function torznabModeParam(mode: TorznabMode): string {
  switch (mode) {
    case "search":
      return "search";
    case "music":
      return "music";
    case "movie":
      return "movie";
    case "tv":
      return "tvsearch";
  }
}

export function torznabModeForCategory(category: MediaCategory): TorznabMode {
  switch (category) {
    case "Movie":
      return "movie";
    case "TV":
    case "Anime":
      return "tv";
    case "Music":
    case "Podcast":
    case "Audiobook":
      return "music";
    default:
      return "search";
  }
}

// --- capabilities ----------------------------------------------------------

function modeAvailable(searching: string, tag: string): boolean {
  const el = searching.match(new RegExp(`<${tag}\\b[^>]*>`, "i"))?.[0];
  if (!el) return false;
  return /available\s*=\s*["']yes["']/i.test(el);
}

/**
 * Parse a Torznab `<caps>` document into structured capability flags.
 * `available="yes"` on a mode means the endpoint accepts that `t` value;
 * an absent element means the mode is unsupported.
 */
export function parseTorznabCapabilities(xml: string): TorznabCapabilities {
  if (!/<\s*caps[\s>]/i.test(xml)) {
    throw new ParseError("Torznab: expected a <caps> capabilities document");
  }
  const searching = extractTag(xml, "searching");
  const categoryIds: string[] = [];
  for (const m of xml.matchAll(/<category\b[^>]*>/gi)) {
    const id = m[0].match(/\bid\s*=\s*["']([^"']+)["']/i)?.[1];
    if (id) categoryIds.push(id);
  }
  if (!searching) {
    // No <searching> block at all: be lenient and assume every mode works
    // rather than guessing from an unknown document shape.
    return { search: true, music: true, movie: true, tv: true, categories: categoryIds };
  }
  return {
    search: modeAvailable(searching, "search"),
    music: modeAvailable(searching, "audio-search") || modeAvailable(searching, "music-search"),
    movie: modeAvailable(searching, "movie-search"),
    tv: modeAvailable(searching, "tv-search"),
    categories: categoryIds,
  };
}

// --- query mapping ---------------------------------------------------------

export interface MusicQuery {
  q: string;
  artist?: string;
  album?: string;
  track?: string;
  year?: string;
}

/** Map a free-text Tornedo query onto Torznab music parameters. */
export function parseMusicQuery(query: string): MusicQuery {
  const clean = query.trim();
  const out: MusicQuery = { q: clean };
  const year = clean.match(/\b(19|20)\d{2}\b/)?.[0];
  if (year) out.year = year;
  // A numbered track ("01 - In the Air") is a track, not an artist/album pair.
  const track = clean.match(/^\d{1,3}\s*[-–]\s*(.+)$/);
  if (track && track[1]) {
    out.track = track[1]!.trim();
    out.album = clean;
    return out;
  }
  const split = clean.split(/\s+[-–]\s+/);
  if (split.length >= 2 && split[0]!.trim()) {
    out.artist = split[0]!.trim();
    out.album = split.slice(1).join(" - ").trim();
  }
  return out;
}

export interface TvQuery {
  q: string;
  season?: number;
  episode?: number;
}

/** Parse `Show.S01E02`-style queries into Torznab tvsearch parameters. */
export function parseTvQuery(query: string): TvQuery {
  const clean = query.trim();
  const out: TvQuery = { q: clean };
  const combo = clean.match(/\bs(\d{1,2})e(\d{1,3})\b/i);
  if (combo) {
    const s = Number(combo[1]);
    const e = Number(combo[2]);
    if (Number.isFinite(s) && s > 0) out.season = s;
    if (Number.isFinite(e) && e > 0) out.episode = e;
    return out;
  }
  const season = clean.match(/\bs(\d{1,2})\b/i);
  const episode = clean.match(/\be(\d{1,3})\b/i);
  if (season) {
    const n = Number(season[1]);
    if (Number.isFinite(n) && n > 0) out.season = n;
  }
  if (episode) {
    const n = Number(episode[1]);
    if (Number.isFinite(n) && n > 0) out.episode = n;
  }
  return out;
}

export function buildTorznabUrl(
  provider: Pick<TorznabProviderConfig, "baseUrl" | "apiKey">,
  t: string,
  params: Record<string, string | number | undefined>,
): string {
  const url = new URL(provider.baseUrl);
  if (provider.apiKey?.trim()) url.searchParams.set("apikey", provider.apiKey.trim());
  url.searchParams.set("t", t);
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === "") continue;
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

// --- feed parsing ----------------------------------------------------------

export interface TorznabItem {
  title: string;
  link: string;
  pubDate?: number;
  size?: number;
  seeders?: number;
  leechers?: number;
  infohash: string;
  magnet?: string;
  torrentUrl?: string;
  category?: MediaCategory;
  attrs: Record<string, string>;
}

function attrMap(item: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const m of item.matchAll(/<(?:torznab:)?attr\b[^>]*>/gi)) {
    const name = m[0].match(/\bname\s*=\s*["']([^"']+)["']/i)?.[1];
    const value = m[0].match(/\bvalue\s*=\s*["']([^"']*)["']/i)?.[1];
    if (name) out[name.toLowerCase()] = unescapeEntities(value ?? "");
  }
  return out;
}

function newznabCategory(category: string): MediaCategory | undefined {
  const id = Number.parseInt(category, 10);
  if (Number.isNaN(id)) {
    const lower = category.toLowerCase();
    if (lower.includes("movie")) return "Movie";
    if (lower.includes("audio") || lower.includes("music")) return "Music";
    if (lower.includes("tv")) return "TV";
    if (lower.includes("anime")) return "Anime";
    return undefined;
  }
  if (id >= 2000 && id < 3000) return "Movie";
  if (id >= 3000 && id < 4000) return "Music";
  if (id >= 5000 && id < 6000) return "TV";
  if (id >= 1000 && id < 2000) return "Game";
  return undefined;
}

/** Parse a Torznab `<rss>` search response into normalized SearchResults. */
export function parseTorznabFeed(
  xml: string,
  opts: { sourceId: string; defaultCategory?: MediaCategory },
): { results: SearchResult[]; skipped: number } {
  if (!xml.trim()) throw new ParseError("Torznab: empty response");
  if (/<!DOCTYPE html|<html\b/i.test(xml)) {
    throw new ParseError("Torznab: expected an RSS feed, received HTML");
  }
  if (!/<rss\b/i.test(xml) && !/<items\b/i.test(xml)) {
    throw new ParseError("Torznab: expected an RSS feed document");
  }

  const fragments = splitItems(xml, "item");
  const results: SearchResult[] = [];
  let skipped = 0;
  for (const frag of fragments) {
    const parsed = parseTorznabItem(frag);
    if (!parsed) {
      skipped++;
      continue;
    }
    const category = parsed.category ?? opts.defaultCategory;
    results.push({
      infohash: parsed.infohash,
      title: parsed.title,
      size: parsed.size,
      seeders: parsed.seeders,
      leechers: parsed.leechers,
      files: parsed.attrs.files ? Number(parsed.attrs.files) || undefined : undefined,
      sourceId: opts.sourceId,
      category,
      magnet: parsed.magnet ?? "",
      torrentUrl: (parsed.torrentUrl ?? (parsed.link.startsWith("magnet:") ? undefined : parsed.link)) || undefined,
      added: parsed.pubDate,
      sourceMetadata: sourceMetadataOf(parsed.attrs),
    });
  }
  return { results, skipped };
}

function sourceMetadataOf(attrs: Record<string, string>): Record<string, unknown> | undefined {
  const keep: Record<string, unknown> = {};
  for (const key of [
    "uploader",
    "group",
    "imdbid",
    "tmdbid",
    "tvdbid",
    "genre",
    "year",
    "resolution",
    "codec",
    "container",
    "source",
    "category",
  ]) {
    const v = attrs[key];
    if (v !== undefined && v !== "") keep[key] = v;
  }
  return Object.keys(keep).length > 0 ? keep : undefined;
}

function parseTorznabItem(item: string): TorznabItem | null {
  const title = unescapeEntities(extractTag(item, "title")).trim();
  if (!title) return null;
  const link = unescapeEntities(extractTag(item, "link")).trim();
  const attrs = attrMap(item);

  let magnet = attrs.magneturl?.trim();
  if (!magnet && /^magnet:/i.test(link)) magnet = link;

  const enclosure = item.match(/<enclosure\b[^>]*>/i)?.[0] ?? "";
  const enclosureUrl = enclosure.match(/\burl\s*=\s*["']([^"']+)["']/i)?.[1];
  const enclosureLength = enclosure.match(/\blength\s*=\s*["']([^"']+)["']/i)?.[1];
  const torrentUrl = enclosureUrl ? unescapeEntities(enclosureUrl) : undefined;

  const sizeRaw = attrs.size || enclosureLength || undefined;
  const size = sizeRaw ? Number(sizeRaw) : undefined;

  let seeders = attrs.seeders ? Number(attrs.seeders) : undefined;
  let leechers = attrs.leechers ? Number(attrs.leechers) : undefined;
  const peers = attrs.peers ? Number(attrs.peers) : undefined;
  if (seeders === undefined && peers !== undefined) seeders = peers;
  if (leechers === undefined && seeders !== undefined && peers !== undefined) {
    leechers = Math.max(0, peers - seeders);
  }
  if (seeders !== undefined && !Number.isFinite(seeders)) seeders = undefined;
  if (leechers !== undefined && !Number.isFinite(leechers)) leechers = undefined;

  const infoHash =
    normalizeInfoHash(attrs.infohash ?? "") ??
    (magnet ? normalizeInfoHash(magnet.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1] ?? "") : null);
  if (!infoHash) return null;

  const pubDateRaw = extractTag(item, "pubDate");
  let added: number | undefined;
  if (pubDateRaw) {
    const t = new Date(pubDateRaw).getTime();
    if (Number.isFinite(t)) added = Math.floor(t / 1000);
  }

  const category = newznabCategory(attrs.category ?? "");

  return {
    title,
    link,
    pubDate: added,
    size: size !== undefined && Number.isFinite(size) && size > 0 ? size : undefined,
    seeders,
    leechers,
    infohash: infoHash,
    magnet,
    torrentUrl,
    category,
    attrs,
  };
}

// --- provider --------------------------------------------------------------

const ALL_CATEGORIES: readonly MediaCategory[] = ["Movie", "TV", "Music", "Other"];

export function torznabCategories(config: TorznabProviderConfig): readonly MediaCategory[] {
  const fromConfig = (config.categories ?? []).map(categoryFromConfigString);
  const known = fromConfig.filter((c): c is MediaCategory => c !== undefined);
  return known.length > 0 ? known : ALL_CATEGORIES;
}

function categoryFromConfigString(raw: string): MediaCategory | undefined {
  const s = raw.trim().toLowerCase();
  if (s === "movie" || s === "movies") return "Movie";
  if (s === "tv" || s === "television") return "TV";
  if (s === "music" || s === "audio") return "Music";
  if (s === "anime") return "Anime";
  if (s === "game" || s === "games") return "Game";
  return undefined;
}

export class TorznabProvider {
  readonly config: TorznabProviderConfig;
  readonly sourceId: string;
  private caps: TorznabCapabilities | null = null;
  private capsAt = 0;
  capsError: string | null = null;

  constructor(config: TorznabProviderConfig, sourceId: string) {
    this.config = config;
    this.sourceId = sourceId;
  }

  /** Endpoint URL for a given `t` value. */
  url(t: string, params: Record<string, string | number | undefined> = {}): string {
    return buildTorznabUrl(this.config, t, params);
  }

  /**
   * Fetch (and cache) the endpoint's advertised capabilities. A network/timeout
   * failure returns null so a search is still attempted — an unreachable caps
   * endpoint is not proof the search endpoint is down too. An explicit
   * `available="no"` (or absent mode) is authoritative.
   */
  async fetchCapabilities(ctx: SearchContext): Promise<TorznabCapabilities | null> {
    if (this.caps && Date.now() - this.capsAt < CAPS_TTL_MS) return this.caps;
    const url = this.url("caps");
    try {
      const xml = await fetchText(url, { signal: ctx.signal, timeoutMs: ctx.timeoutMs, retries: 1 });
      this.caps = parseTorznabCapabilities(xml);
      this.capsAt = Date.now();
      this.capsError = null;
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      this.caps = null;
      this.capsError = e instanceof Error ? e.message : String(e);
    }
    return this.caps;
  }

  /** Capabilities without a network round-trip (diagnostics). */
  cachedCapabilities(): TorznabCapabilities | null {
    return this.caps;
  }

  async search(query: string, ctx: SearchContext, category?: MediaCategory): Promise<SearchResult[]> {
    const mode = category ? torznabModeForCategory(category) : "search";
    const caps = await this.fetchCapabilities(ctx);
    if (caps && !caps[MODE_KEYS[mode]]) {
      throw new UnsupportedError(
        `Torznab ${this.sourceId}: ${mode} not supported by the configured provider`,
      );
    }

    const params: Record<string, string | number | undefined> = {};
    if (mode === "music") {
      const mq = parseMusicQuery(query);
      params.q = mq.q;
      if (mq.artist) params.artist = mq.artist;
      if (mq.album) params.album = mq.album;
      if (mq.track) params.track = mq.track;
      if (mq.year) params.year = mq.year;
    } else if (mode === "tv") {
      const tq = parseTvQuery(query);
      params.q = tq.q;
      if (tq.season !== undefined) params.season = tq.season;
      if (tq.episode !== undefined) params.ep = tq.episode;
    } else {
      params.q = query.trim();
    }

    const url = this.url(torznabModeParam(mode), params);
    const xml = await fetchText(url, { signal: ctx.signal, timeoutMs: ctx.timeoutMs, retries: 1 });
    const { results, skipped } = parseTorznabFeed(xml, {
      sourceId: this.sourceId,
      defaultCategory: mode === "music" ? "Music" : mode === "movie" ? "Movie" : mode === "tv" ? "TV" : undefined,
    });

    if (results.length === 0 && skipped > 0) {
      throw new ParseError(
        `Torznab ${this.sourceId}: ${skipped} item(s) had no usable magnet/infohash; parser structure may have changed`,
      );
    }
    return results;
  }
}

export function torznabSource(config: TorznabProviderConfig, index: number): SourceAdapter {
  const id = config.id?.trim() || `torznab:${index}`;
  const name = config.name?.trim() || `Torznab ${index + 1}`;
  const provider = new TorznabProvider(config, id);
  const categories = torznabCategories(config);
  return {
    id,
    name,
    groups: ["Movies", "TV", "Music", "General"],
    categories,
    homepage: config.baseUrl,
    timeoutMs: config.timeoutMs ?? 15_000,
    concurrency: 2,
    reportsHealth: true,
    search: (query: string, ctx: SearchContext) => provider.search(query, ctx),
    /** Exposed for diagnostics; not part of the SourceAdapter contract. */
    provider,
  } as SourceAdapter & { provider: TorznabProvider };
}

/** Type guard for the diagnostics surface (see `tornedo sources --check`). */
export function isTorznabSource(s: SourceAdapter): s is SourceAdapter & { provider: TorznabProvider } {
  return (s as { provider?: unknown }).provider instanceof TorznabProvider;
}

export { HttpError };