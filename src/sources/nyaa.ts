/**
 * Nyaa (nyaa.si) anime RSS adapter.
 * RSS: GET /?page=rss&q=<query>&c=0_0&f=0
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { fetchText } from "./net.js";
import { extractTag, parseSize, unescapeEntities } from "./rss.js";
import { buildMagnet, normalizeInfoHash } from "../torrent/parse.js";

const BASE = "https://nyaa.si/";
const CATEGORY: MediaCategory = "Anime";

export async function search(query: string, ctx: SearchContext): Promise<SearchResult[]> {
  const params = new URLSearchParams({ page: "rss", q: query.trim(), c: "0_0", f: "0" });
  const xml = await fetchText(`${BASE}?${params.toString()}`, {
    signal: ctx.signal,
    timeoutMs: ctx.timeoutMs,
    retries: 1,
  });

  const out: SearchResult[] = [];
  for (const item of xml.split("<item>").slice(1)) {
    const rawHash = extractTag(item, "nyaa:infoHash");
    const infoHash = normalizeInfoHash(rawHash);
    const title = unescapeEntities(extractTag(item, "title"));
    if (!infoHash || !title) continue;
    const seeders = Number(extractTag(item, "nyaa:seeders"));
    const leechers = Number(extractTag(item, "nyaa:leechers"));
    const dateStr = extractTag(item, "pubDate");
    out.push({
      infohash: infoHash,
      title,
      size: parseSize(extractTag(item, "nyaa:size")) || undefined,
      seeders: Number.isFinite(seeders) ? seeders : undefined,
      leechers: Number.isFinite(leechers) ? leechers : undefined,
      sourceId: "nyaa",
      category: CATEGORY,
      magnet: buildMagnet(infoHash, title),
      added: dateStr ? Math.floor(new Date(dateStr).getTime() / 1000) : undefined,
    });
  }
  return out;
}

export const nyaa: SourceAdapter = {
  id: "nyaa",
  name: "Nyaa",
  groups: ["Anime"],
  categories: ["Anime"],
  homepage: BASE,
  timeoutMs: 15_000,
  concurrency: 1,
  reportsHealth: true,
  search,
};