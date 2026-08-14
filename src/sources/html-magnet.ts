/**
 * Shared adapter for index sites whose search pages link to a detail page that
 * exposes a magnet URI.  A result is emitted only after its magnet (and hence
 * canonical infohash) has been verified.
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { normalizeInfoHash } from "../torrent/parse.js";
import { fetchText, HttpError } from "./net.js";
import { unescapeEntities } from "./rss.js";

export interface HtmlMagnetSite {
  id: string;
  name: string;
  homepage: string;
  searchUrl(query: string): string;
  /** Restricts result links to the site's torrent-detail route. */
  detailPath: RegExp;
}

interface Candidate { title: string; path: string }

function absoluteUrl(base: string, path: string): string {
  return new URL(unescapeEntities(path), base).toString();
}

/** Exported for fixture tests; it intentionally accepts both quoted attribute orders. */
export function parseDetailCandidates(html: string, detailPath: RegExp): Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const path = unescapeEntities(match[1]!.trim());
    detailPath.lastIndex = 0;
    if (!detailPath.test(path) || seen.has(path)) continue;
    const title = unescapeEntities(match[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!title) continue;
    seen.add(path);
    out.push({ title, path });
    if (out.length === 6) break;
  }
  return out;
}

export function magnetFromHtml(html: string): string | null {
  const raw = html.match(/magnet:\?xt=urn:btih:[a-zA-Z0-9]+[^"'<>\s]*/i)?.[0];
  return raw ? unescapeEntities(raw) : null;
}

export function htmlMagnetMusicSource(site: HtmlMagnetSite): SourceAdapter {
  return {
    id: site.id,
    name: site.name,
    groups: ["Music"],
    categories: ["Music"],
    homepage: site.homepage,
    timeoutMs: 15_000,
    concurrency: 3,
    reportsHealth: false,
    async search(query: string, ctx: SearchContext): Promise<SearchResult[]> {
      const q = query.trim();
      if (!q) return [];
      const listing = await fetchText(site.searchUrl(q), { signal: ctx.signal, timeoutMs: ctx.timeoutMs, retries: 1 });
      const candidates = parseDetailCandidates(listing, site.detailPath);
      const results = await Promise.all(candidates.map(async ({ title, path }): Promise<SearchResult | null> => {
        try {
          const detail = await fetchText(absoluteUrl(site.homepage, path), { signal: ctx.signal, timeoutMs: ctx.timeoutMs, retries: 0 });
          const magnet = magnetFromHtml(detail);
          const infohash = normalizeInfoHash(magnet?.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1] ?? "");
          return magnet && infohash ? { infohash, title, magnet, sourceId: site.id, category: "Music" as MediaCategory } : null;
        } catch {
          return null;
        }
      }));
      if (ctx.signal.aborted) throw new HttpError(0, "Search cancelled");
      return results.filter((result): result is SearchResult => result !== null);
    },
  };
}
