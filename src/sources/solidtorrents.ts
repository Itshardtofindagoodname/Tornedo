/**
 * SolidTorrents / BitSearch adapter. A DHT-based meta-search engine that
 * exposes magnets directly on its search listing pages. The original
 * solidtorrents.net domain is parked; the service now runs on bitsearch.to
 * with legacy domains as fallbacks. The JSON API is defunct — HTML scraping
 * of the search listing is the only viable integration.
 *
 * Search URL: /search?q={query}&sortBy=seeders&order=desc&page=1
 * HTML structure exposes magnet URIs directly, so no detail-page round trips.
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { normalizeInfoHash } from "../torrent/parse.js";
import { fetchTextFromFirstMirror, HttpError, ParseError } from "./net.js";
import { unescapeEntities } from "./rss.js";

const HOSTS = ["bitsearch.to", "solidtorrents.to", "solidtorrents.eu"];

const GROUPS = ["Movies", "TV", "Music", "General"] as const;
const CATEGORIES: MediaCategory[] = ["Movie", "TV", "Music", "Other"];

interface SolidResult {
  infohash: string;
  title: string;
  magnet: string;
  size?: number;
  seeders?: number;
  leechers?: number;
  category?: MediaCategory;
}

function parseSize(raw: string): number {
  const s = raw.trim().toLowerCase();
  const m = s.match(/^([\d.]+)\s*(b|kb|mb|gb|tb)$/);
  if (!m) return 0;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return 0;
  const mult: Record<string, number> = {
    b: 1,
    kb: 1e3,
    mb: 1e6,
    gb: 1e9,
    tb: 1e12,
  };
  return Math.round(value * (mult[m[2]!] ?? 1));
}

function guessCategory(text: string): MediaCategory | undefined {
  const lower = text.toLowerCase();
  if (/\b(movie|film|bluray|brrip|webrip|hdrip|cam|ts)\b/.test(lower)) return "Movie";
  if (/\b(tv|season|episode|s\d{2}e\d{2}|complete series)\b/.test(lower)) return "TV";
  if (/\b(mp3|flac|album|artist|track|aac|ogg)\b/.test(lower)) return "Music";
  return undefined;
}

/**
 * Parse search results from the BitSearch/SolidTorrents HTML listing.
 * The site renders magnets directly on the search page, which is the
 * most reliable integration path — nothing depends on detail page structure.
 */
export function parseResults(html: string): SolidResult[] {
  const seen = new Set<string>();
  const out: SolidResult[] = [];

  // Match magnet links with their surrounding context to extract title/size/seeds.
  // The site uses <a href="magnet:?xt=urn:btih:..."> within result cards.
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["'](magnet:\?xt=urn:btih:[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const magnet = unescapeEntities(match[1]!.trim());
    const infohash = normalizeInfoHash(magnet.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1] ?? "");
    if (!infohash || seen.has(infohash)) continue;

    // Extract title from the anchor text, stripping inner HTML
    const title = unescapeEntities(match[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    if (!title) continue;

    seen.add(infohash);

    // Try to find size, seeders, leechers in surrounding context (±500 chars)
    const anchorIdx = match.index ?? 0;
    const context = html.slice(Math.max(0, anchorIdx - 200), anchorIdx + match[0].length + 500);

    const sizeMatch = context.match(/([\d.]+)\s*(GB|MB|TB|KB|B)\b/i);
    const seedsMatch = context.match(/(\d[\d,]*)\s*(?:seeders?|seeds)/i)
      ?? context.match(/text-green[^>]*>[^<]*<[^>]*>(\d[\d,]*)/i);
    const leechMatch = context.match(/(\d[\d,]*)\s*(?:leechers?|leeches)/i)
      ?? context.match(/text-red[^>]*>[^<]*<[^>]*>(\d[\d,]*)/i);

    out.push({
      infohash,
      title,
      magnet,
      size: sizeMatch ? parseSize(`${sizeMatch[1]} ${sizeMatch[2]}`) : undefined,
      seeders: seedsMatch ? Number(seedsMatch[1]!.replace(/,/g, "")) || undefined : undefined,
      leechers: leechMatch ? Number(leechMatch[1]!.replace(/,/g, "")) || undefined : undefined,
      category: guessCategory(title),
    });

    if (out.length >= 20) break;
  }

  return out;
}

async function search(query: string, ctx: SearchContext): Promise<SearchResult[]> {
  const q = query.trim();
  if (!q) return [];

  // All mirrors are raced concurrently: a hanging or blocked domain can no
  // longer consume the source's whole timeout budget before a fallback is
  // ever contacted.
  const html = await fetchTextFromFirstMirror(
    HOSTS.map((host) => `https://${host}/search?q=${encodeURIComponent(q)}&sortBy=seeders&order=desc&page=1`),
    {
      signal: ctx.signal,
      timeoutMs: Math.min(ctx.timeoutMs, 10_000),
      retries: 0,
    },
  );

  const parsed = parseResults(html);

  // If the page returned no magnets, check if the structure changed
  if (parsed.length === 0) {
    // Only flag as parse error if there are actually magnet links with valid-looking
    // btih hashes that we failed to parse — not if the page genuinely has no results.
    const hasBtihMagnets = /magnet:\?xt=urn:btih:[a-zA-Z0-9]{32,40}/i.test(html);
    if (hasBtihMagnets) {
      // The page has magnet links but we couldn't extract any valid results.
      // This likely means the HTML structure changed.
      throw new ParseError("solidtorrents: listing contains magnets but none could be parsed");
    }
    // Check for known error pages
    if (/\b(502|504|bad gateway|timeout|unreachable)\b/i.test(html)) {
      throw new HttpError(502, "solidtorrents: upstream error");
    }
    return [];
  }

  return parsed.map((r) => ({
    infohash: r.infohash,
    title: r.title,
    size: r.size,
    seeders: r.seeders,
    leechers: r.leechers,
    sourceId: "solidtorrents",
    category: r.category ?? "Other",
    magnet: r.magnet,
  }));
}

export const solidtorrents: SourceAdapter = {
  id: "solidtorrents",
  name: "SolidTorrents",
  groups: GROUPS,
  categories: CATEGORIES,
  homepage: "https://bitsearch.to",
  timeoutMs: 15_000,
  concurrency: 1,
  reportsHealth: true,
  search,
};
