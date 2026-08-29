/**
 * Optional Internet Archive provider for publicly downloadable audio/music.
 *
 * This is not a torrent scraper: it uses the Archive's public JSON APIs
 * (advancedsearch.php + metadata) and normalizes downloadable items into
 * Tornedo's SearchResult model. Every emitted item is confirmed to have at
 * least one downloadable audio file.
 *
 * Download caveat: the Archive serves plain HTTP files, not BitTorrent swarms.
 * Tornedo's engine is torrent-only, so these results carry an `ia://` magnet
 * identifier and the item's download URL; the UI refuses to queue them into the
 * torrent engine and explains why.
 */
import { createHash } from "node:crypto";
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import type { InternetArchiveConfig } from "../config/config.js";
import { fetchJson, HttpError } from "./net.js";

const SEARCH_API = "https://archive.org/advancedsearch.php";
const METADATA_API = "https://archive.org/metadata";

/** Audio formats considered downloadable (excludes tiles, covers, metadata...). */
const AUDIO_FORMATS = new Set(["MP3", "VBR MP3", "FLAC", "OGG VORBIS", "OGG", "M4A", "WAV", "AAC", "OPUS", "WMA", "MIDI"]);

interface IaDoc {
  identifier?: string;
  title?: string;
  creator?: string[] | string;
  date?: string;
  downloads?: number;
  mediatype?: string;
}

interface IaSearchResponse {
  response?: {
    numFound?: number;
    docs?: IaDoc[];
  };
}

interface IaFile {
  name?: string;
  format?: string;
  size?: number;
}

interface IaMetadataResponse {
  metadata?: {
    identifier?: string;
    title?: string;
    creator?: string[] | string;
    collection?: string[] | string;
    date?: string;
    mediatype?: string;
    licenseurl?: string;
  };
  files?: IaFile[];
}

const DOWNLOADABLE = new Set([...AUDIO_FORMATS]);

/** Stable 40-hex identifier for a non-torrent source item (IA item). */
export function deriveSourceInfoHash(namespace: string, key: string): string {
  return createHash("sha1").update(`${namespace}:${key}`).digest("hex");
}

export function internetArchiveSource(config: InternetArchiveConfig): SourceAdapter {
  const sourceId = "internet-archive";
  return {
    id: sourceId,
    name: "Internet Archive",
    groups: ["Music"],
    categories: ["Music", "Podcast", "Audiobook"],
    homepage: "https://archive.org",
    timeoutMs: config.timeoutMs,
    concurrency: 3,
    reportsHealth: false,
    search: (query, ctx) => searchArchive(query, config, ctx),
  };
}

function searchUrl(query: string, maxResults: number): string {
  const url = new URL(SEARCH_API);
  url.searchParams.set("q", `mediatype:audio AND (${escapeQuery(query)})`);
  url.searchParams.set("rows", String(maxResults));
  url.searchParams.set("page", "1");
  url.searchParams.set("output", "json");
  url.searchParams.set("sort[]", "downloads desc");
  for (const field of ["identifier", "title", "creator", "date", "downloads", "mediatype"]) {
    url.searchParams.append("fl[]", field);
  }
  return url.toString();
}

/** Escape a free-text query for the Archive's Lucene-style syntax. */
function escapeQuery(query: string): string {
  const clean = query.trim();
  if (/\s/.test(clean)) return `"${clean.replace(/"/g, "")}"`;
  return clean.replace(/[():"]/g, "");
}

async function searchArchive(query: string, config: InternetArchiveConfig, ctx: SearchContext): Promise<SearchResult[]> {
  const data = await fetchJson<IaSearchResponse>(searchUrl(query, config.maxResults), {
    signal: ctx.signal,
    timeoutMs: config.timeoutMs,
    retries: 1,
  });
  const docs = data.response?.docs ?? [];
  if (!Array.isArray(docs) || docs.length === 0) return [];

  const out: SearchResult[] = [];
  const seen = new Set<string>();
  const results = await Promise.all(
    docs.map(async (doc) => {
      if (!doc.identifier || seen.has(doc.identifier)) return null;
      seen.add(doc.identifier);
      const title = doc.title || doc.identifier;
      const item = await fetchItemMetadata(doc.identifier, config, ctx).catch(() => null);
      if (!item) return null;
      const downloadables = (item.files ?? []).filter(
        (f) => DOWNLOADABLE.has((f.format ?? "").toUpperCase()) && Number(f.size) > 0,
      );
      if (downloadables.length === 0) return null;
      const totalSize = downloadables.reduce((acc, f) => acc + Number(f.size), 0);
      const meta = item.metadata ?? {};
      const creators = asList(meta.creator ?? doc.creator);
      const collections = asList(meta.collection);
      const added = meta.date ? toUnixSeconds(meta.date) : undefined;
      return {
        infohash: deriveSourceInfoHash("ia", doc.identifier),
        title,
        size: totalSize || undefined,
        files: downloadables.length,
        sourceId: "internet-archive",
        category: "Music" as MediaCategory,
        magnet: `ia://${doc.identifier}`,
        torrentUrl: `https://archive.org/download/${doc.identifier}/`,
        added,
        sourceMetadata: {
          source: "Internet Archive",
          identifier: doc.identifier,
          itemUrl: `https://archive.org/details/${doc.identifier}`,
          creators,
          collection: collections,
          date: meta.date ?? doc.date,
          downloads: doc.downloads,
          licenseurl: meta.licenseurl,
          mediatype: meta.mediatype ?? doc.mediatype,
          formats: [...new Set(downloadables.map((f) => f.format).filter(Boolean))],
        },
      };
    }),
  );
  for (const r of results) {
    if (r) out.push(r);
  }
  return out;
}

async function fetchItemMetadata(identifier: string, config: InternetArchiveConfig, ctx: SearchContext): Promise<IaMetadataResponse | null> {
  const url = `${METADATA_API}/${encodeURIComponent(identifier)}`;
  try {
    return await fetchJson<IaMetadataResponse>(url, {
      signal: ctx.signal,
      timeoutMs: Math.min(config.timeoutMs, 10_000),
      retries: 0,
    });
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) return null;
    throw e;
  }
}

function asList(v: string[] | string | undefined): string[] {
  if (Array.isArray(v)) return v.filter(Boolean);
  if (typeof v === "string" && v.trim()) return [v.trim()];
  return [];
}

function toUnixSeconds(date: string): number | undefined {
  const t = Date.parse(date);
  if (Number.isNaN(t)) return undefined;
  const secs = Math.floor(t / 1000);
  return secs > 0 ? secs : undefined;
}

export { HttpError };