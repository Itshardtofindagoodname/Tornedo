/**
 * BitTorrented (bittorrented.com) API adapter. A general video index with real
 * swarm counts. Requires queries of at least 3 characters.
 * API: GET /api/search/torrents?q=...&type=video&limit=50&sortBy=seeders
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { fetchJson, HttpError } from "./net.js";
import { buildMagnet, normalizeInfoHash } from "../torrent/parse.js";

const BASE = "https://bittorrented.com";
const MIN_QUERY = 3;
const CATEGORY: MediaCategory = "Movie";

interface BtResult {
  torrent_infohash?: string;
  torrent_name?: string;
  torrent_total_size?: number;
  torrent_seeders?: number | null;
  torrent_leechers?: number | null;
  torrent_file_count?: number;
  torrent_created_at?: string;
}

interface BtResponse {
  results?: BtResult[];
}

export function toUnixSeconds(iso: string | undefined): number | undefined {
  if (!iso) return undefined;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

/** Pure mapping, exported for unit tests without a live request. */
export function mapBittorrentedResults(results: BtResult[], sourceId: string): SearchResult[] {
  const out: SearchResult[] = [];
  for (const r of results) {
    const infoHash = normalizeInfoHash(r.torrent_infohash ?? "");
    if (!infoHash) continue;
    const name = r.torrent_name || infoHash;
    out.push({
      infohash: infoHash,
      title: name,
      size: r.torrent_total_size ?? undefined,
      seeders: r.torrent_seeders ?? undefined,
      leechers: r.torrent_leechers ?? undefined,
      files: r.torrent_file_count,
      sourceId,
      category: CATEGORY,
      magnet: buildMagnet(infoHash, name),
      added: toUnixSeconds(r.torrent_created_at),
    });
  }
  return out;
}

export async function search(query: string, ctx: SearchContext): Promise<SearchResult[]> {
  const q = query.trim();
  if (q.length < MIN_QUERY) return [];

  const params = new URLSearchParams({
    q,
    type: "video",
    limit: "50",
    sortBy: "seeders",
    sortOrder: "desc",
  });
  const json = await fetchJson<BtResponse>(`${BASE}/api/search/torrents?${params.toString()}`, {
    signal: ctx.signal,
    timeoutMs: ctx.timeoutMs,
    retries: 1,
  });
  if (!json || !Array.isArray(json.results)) throw new HttpError(0, "BitTorrented returned an invalid response");
  return mapBittorrentedResults(json.results, "bittorrented");
}

export const bittorrented: SourceAdapter = {
  id: "bittorrented",
  name: "BitTorrented",
  groups: ["Movies", "TV"],
  categories: ["Movie", "TV"],
  homepage: BASE,
  timeoutMs: 15_000,
  concurrency: 1,
  reportsHealth: true,
  search,
};