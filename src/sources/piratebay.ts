/**
 * The Pirate Bay (apibay.org) API adapter. Feeds Movies and TV; the API's JSON
 * rows carry real swarm counts.
 * API: GET /q.php?q=<query>  |  /precompiled/data_top100_<cat>.json
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { fetchJson, HttpError } from "./net.js";
import { buildMagnet, normalizeInfoHash } from "../torrent/parse.js";

const API = "https://apibay.org";

const MOVIE_CATS = new Set([201, 202, 207, 209]);
const TV_CATS = new Set([205, 208]);
// The API uses the Audio hierarchy: Music (101) and FLAC (104).  The 200
// range is Video, so using it silently discarded every music result.
const MUSIC_CATS = new Set([101, 104]);

const TOP_MOVIES = `${API}/precompiled/data_top100_207.json`;
const TOP_TV = `${API}/precompiled/data_top100_208.json`;
const TOP_MUSIC = `${API}/precompiled/data_top100_101.json`;

const ZERO_HASH = "0000000000000000000000000000000000000000";

interface ApibayItem {
  id?: string;
  name?: string;
  info_hash?: string;
  seeders?: string;
  leechers?: string;
  num_files?: string;
  size?: string;
  added?: string;
  category?: string;
}

function toResult(it: ApibayItem, sourceId: string, category: MediaCategory): SearchResult | null {
  const infoHash = normalizeInfoHash(it.info_hash ?? "");
  if (!infoHash || infoHash === ZERO_HASH || it.id === "0") return null;
  const name = it.name || "Unknown";
  const numFiles = Number(it.num_files);
  return {
    infohash: infoHash,
    title: name,
    size: Number(it.size) || undefined,
    seeders: Number(it.seeders) || undefined,
    leechers: Number(it.leechers) || undefined,
    files: Number.isFinite(numFiles) && numFiles > 0 ? numFiles : undefined,
    sourceId,
    category,
    magnet: buildMagnet(infoHash, name),
    added: Number(it.added) || undefined,
  };
}

async function search(
  query: string,
  cats: Set<number>,
  browseUrl: string,
  sourceId: string,
  category: MediaCategory,
  ctx: SearchContext,
): Promise<SearchResult[]> {
  const q = query.trim();
  const items = await fetchJson<ApibayItem[]>(q ? `${API}/q.php?q=${encodeURIComponent(q)}` : browseUrl, {
    signal: ctx.signal,
    timeoutMs: ctx.timeoutMs,
    retries: 1,
  });
  if (!Array.isArray(items)) throw new HttpError(0, "The Pirate Bay returned an invalid response");
  const out: SearchResult[] = [];
  for (const it of items) {
    if (q && !cats.has(Number(it.category))) continue;
    const r = toResult(it, sourceId, category);
    if (r) out.push(r);
  }
  return out;
}

export const piratebayMovies: SourceAdapter = {
  id: "tpb-movies",
  name: "The Pirate Bay",
  groups: ["Movies"],
  categories: ["Movie"],
  homepage: "https://thepiratebay.org",
  timeoutMs: 15_000,
  concurrency: 1,
  reportsHealth: true,
  search: (q, ctx) => search(q, MOVIE_CATS, TOP_MOVIES, "tpb-movies", "Movie", ctx),
};

export const piratebayTv: SourceAdapter = {
  id: "tpb-tv",
  name: "The Pirate Bay",
  groups: ["TV"],
  categories: ["TV"],
  homepage: "https://thepiratebay.org",
  timeoutMs: 15_000,
  concurrency: 1,
  reportsHealth: true,
  search: (q, ctx) => search(q, TV_CATS, TOP_TV, "tpb-tv", "TV", ctx),
};

export const piratebayMusic: SourceAdapter = {
  id: "tpb-music",
  name: "The Pirate Bay",
  groups: ["Music"],
  categories: ["Music"],
  homepage: "https://thepiratebay.org",
  timeoutMs: 15_000,
  concurrency: 1,
  reportsHealth: true,
  search: (q, ctx) => search(q, MUSIC_CATS, TOP_MUSIC, "tpb-music", "Music", ctx),
};
