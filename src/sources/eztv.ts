/**
 * EZTV (eztvx.to) API adapter. The API has no free-text search; it serves the
 * recent feed, so non-empty queries are filtered client-side against the latest
 * page of releases.
 * API: GET /api/get-torrents?limit=100&page=1
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { fetchJsonFromFirstMirror, HttpError } from "./net.js";
import { buildMagnet, normalizeInfoHash } from "../torrent/parse.js";

const MIRRORS = ["eztvx.to", "eztv1.xyz", "eztv.wf", "eztv.tf"];
const PAGE_SIZE = 100;

const CATEGORY: MediaCategory = "TV";

interface EztvTorrent {
  title?: string;
  filename?: string;
  hash?: string;
  magnet_url?: string;
  seeds?: number;
  peers?: number;
  size_bytes?: string | number;
  date_released_unix?: number;
}

interface EztvResponse {
  torrents?: EztvTorrent[];
}

export async function search(query: string, ctx: SearchContext): Promise<SearchResult[]> {
  // All mirrors are raced concurrently: a hanging domain can no longer consume
  // the source's whole timeout budget before a fallback is ever contacted.
  const res = await fetchJsonFromFirstMirror<EztvResponse>(
    MIRRORS.map((mirror) => `https://${mirror}/api/get-torrents?limit=${PAGE_SIZE}&page=1`),
    {
      signal: ctx.signal,
      timeoutMs: Math.min(ctx.timeoutMs, 8_000),
      retries: 0,
    },
  );
  if (!res || !Array.isArray(res.torrents)) throw new HttpError(0, "EZTV returned an invalid response");

  const q = query.trim().toLowerCase();
  const tokens = q.split(/\s+/).filter((t) => t.length > 1);

  const out: SearchResult[] = [];
  for (const t of res.torrents) {
    const rawHash = t.hash ?? "";
    const infoHash = normalizeInfoHash(rawHash);
    const title = t.title || t.filename || "";
    if (!infoHash || !title) continue;
    if (tokens.length > 0) {
      const lower = title.toLowerCase();
      if (!tokens.every((tok) => lower.includes(tok))) continue;
    }
    const magnet = t.magnet_url || buildMagnet(infoHash, title);
    out.push({
      infohash: infoHash,
      title,
      size: typeof t.size_bytes === "number" ? t.size_bytes : Number(t.size_bytes) || undefined,
      seeders: t.seeds,
      leechers: t.peers,
      sourceId: "eztv",
      category: CATEGORY,
      magnet,
      added: t.date_released_unix,
    });
  }
  return out;
}

export const eztv: SourceAdapter = {
  id: "eztv",
  name: "EZTV",
  groups: ["TV"],
  categories: ["TV"],
  homepage: "https://eztvx.to",
  timeoutMs: 15_000,
  concurrency: 1,
  reportsHealth: true,
  search,
};