/**
 * Shared adapter for index sites whose search pages link to a detail page that
 * exposes a magnet URI.  A result is emitted only after its magnet (and hence
 * canonical infohash) has been verified.
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { normalizeInfoHash } from "../torrent/parse.js";
import { fetchText, HttpError, ParseError } from "./net.js";
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

/**
 * Many indexers render the magnet URI directly on the search listing (LimeTorrents,
 * TorrentGalaxy, TorrentDownloads all do). When that happens we can emit results
 * without the second detail-page fetch — one fewer round trip and one fewer
 * fragile hop between the site and a usable result.
 */
export function parseDirectMagnets(html: string, siteId: string): SearchResult[] {
  const seen = new Set<string>();
  const out: SearchResult[] = [];
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["'](magnet:\?xt=urn:btih:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const magnet = unescapeEntities(match[1]!.trim());
    const infohash = normalizeInfoHash(magnet.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1] ?? "");
    if (!infohash || seen.has(infohash)) continue;
    const title = unescapeEntities(match[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!title) continue;
    seen.add(infohash);
    out.push({ infohash, title, magnet, sourceId: siteId, category: "Music" as MediaCategory });
    if (out.length === 6) break;
  }
  return out;
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

      // Fast path: the listing already exposes magnet URIs, so no detail-page
      // round trips are needed. This is the common case for these indexers and
      // the most robust one (nothing else can change under us but the magnet).
      const direct = parseDirectMagnets(listing, site.id);
      if (direct.length > 0) return direct;

      const candidates = parseDetailCandidates(listing, site.detailPath);

      // The page answered but nothing matched the site's detail route. If the
      // page still carries magnet links the site structure has changed — say so
      // loudly instead of returning an empty result set silently.
      if (candidates.length === 0) {
        if (/magnet:\?xt=urn:btih:/i.test(listing)) {
          throw new ParseError(`${site.id}: listing contains magnets but no links matched ${String(site.detailPath)}`);
        }
        return [];
      }

      type FetchOutcome =
        | { ok: true; result: SearchResult }
        | { ok: false; kind: "parse" | "http" };

      const fetches = await Promise.all(
        candidates.map(async ({ title, path }): Promise<FetchOutcome> => {
          try {
            const detail = await fetchText(absoluteUrl(site.homepage, path), {
              signal: ctx.signal,
              timeoutMs: ctx.timeoutMs,
              retries: 0,
            });
            const magnet = magnetFromHtml(detail);
            const infohash = normalizeInfoHash(magnet?.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1] ?? "");
            if (magnet && infohash) {
              return { ok: true, result: { infohash, title, magnet, sourceId: site.id, category: "Music" as MediaCategory } };
            }
            return { ok: false, kind: "parse" };
          } catch {
            return { ok: false, kind: "http" };
          }
        }),
      );
      if (ctx.signal.aborted) throw new HttpError(0, "Search cancelled");

      const results = fetches.filter((f): f is { ok: true; result: SearchResult } => f.ok).map((f) => f.result);
      if (results.length > 0) return results;

      // No magnet could be resolved from any detail page. A network failure on
      // every page is an availability problem, not a parsing one; reclassify it
      // so the engine reports "down" instead of blaming the parser.
      const parseCount = fetches.filter((f) => !f.ok && f.kind === "parse").length;
      if (parseCount === 0) {
        throw new HttpError(0, `${site.id}: all ${candidates.length} detail pages failed to load`);
      }
      throw new ParseError(
        `${site.id}: no magnet found in any of ${candidates.length} detail pages (${parseCount} unparsable, ${fetches.length - parseCount} http errors)`,
      );
    },
  };
}
