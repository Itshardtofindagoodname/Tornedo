/**
 * YTS (yts.mx) movie API adapter.
 * API: GET /api/v2/list_movies.json?query_term=...&limit=50
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { fetchJsonFromFirstMirror } from "./net.js";
import { buildMagnet, normalizeInfoHash } from "../torrent/parse.js";

const HOSTS = ["yts.mx", "yts.lt", "yts.bz", "yts.am", "yts.rs"];

const CATEGORY: MediaCategory = "Movie";

interface YtsTorrent {
  hash?: string;
  quality?: string;
  type?: string;
  size_bytes?: number;
  seeds?: number;
  peers?: number;
}

interface YtsMovie {
  title_long?: string;
  title?: string;
  date_uploaded_unix?: number;
  torrents?: YtsTorrent[];
}

interface YtsResponse {
  data?: { movie_count?: number; movies?: YtsMovie[] };
}

export async function search(query: string, ctx: SearchContext): Promise<SearchResult[]> {
  const q = query.trim();
  const params = new URLSearchParams({ limit: "50" });
  if (q) params.set("query_term", q);
  else params.set("sort_by", "date_added");

  // All mirrors are raced concurrently: a hanging domain can no longer consume
  // the source's whole timeout budget before a fallback is ever contacted.
  const json = await fetchJsonFromFirstMirror<YtsResponse>(
    HOSTS.map((host) => `https://${host}/api/v2/list_movies.json?${params.toString()}`),
    {
      signal: ctx.signal,
      timeoutMs: Math.min(ctx.timeoutMs, 8_000),
      retries: 0,
    },
  );

  const out: SearchResult[] = [];
  for (const movie of json.data?.movies ?? []) {
    const base = movie.title_long || movie.title || "Unknown";
    for (const t of movie.torrents ?? []) {
      const hash = t.hash ?? "";
      const infoHash = normalizeInfoHash(hash);
      if (!infoHash) continue;
      const tag = [t.quality, t.type].filter(Boolean).join(" ");
      const title = tag ? `${base} [${tag}]` : base;
      out.push({
        infohash: infoHash,
        title,
        size: t.size_bytes,
        seeders: t.seeds,
        leechers: t.peers,
        sourceId: "yts",
        category: CATEGORY,
        magnet: buildMagnet(infoHash, title),
        added: movie.date_uploaded_unix,
      });
    }
  }
  return out;
}

export const yts: SourceAdapter = {
  id: "yts",
  name: "YTS",
  groups: ["Movies"],
  categories: ["Movie"],
  homepage: "https://yts.mx",
  timeoutMs: 15_000,
  concurrency: 1,
  reportsHealth: true,
  search,
};