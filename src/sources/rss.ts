/**
 * RSS parsing helpers shared by several adapters (Nyaa, FitGirl, SubsPlease
 * feeds, and any future RSS-backed source).
 */
import type { SearchResult } from "../model/search.js";
import type { SearchContext } from "../model/source.js";
import { fetchText, HttpError } from "./net.js";

export function unescapeEntities(s: string): string {
  return s
    .replace(/&#0?38;|&amp;/g, "&")
    .replace(/&#8211;|&#8212;/g, "-")
    .replace(/&#8217;|&#0?39;|&apos;/g, "'")
    .replace(/&#8220;|&#8221;|&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

export function extractTag(item: string, name: string): string {
  return (
    item.match(new RegExp(`<${name}(?:\\s[^>]*)?>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?</${name}>`, "s"))?.[1]?.trim() ?? ""
  );
}

export interface RssItem {
  title: string;
  link: string;
  description: string;
  pubDate: string;
  magnet?: string;
  sizeRaw?: string;
  seeders?: string;
  leechers?: string;
  infoHash?: string;
  extra: Record<string, string>;
}

/** Split an RSS/Atom document into its <item> fragments. */
export function splitItems(xml: string, tag = "item"): string[] {
  const re = new RegExp(`<${tag}[\\s>]`, "i");
  const parts: string[] = [];
  let rest = xml;
  for (;;) {
    const start = rest.search(re);
    if (start < 0) break;
    const end = rest.indexOf(`</${tag}>`, start);
    if (end < 0) {
      parts.push(rest.slice(start));
      break;
    }
    parts.push(rest.slice(start, end + tag.length + 3));
    rest = rest.slice(end + tag.length + 3);
  }
  return parts;
}

export function parseRssItem(item: string): RssItem {
  const title = unescapeEntities(extractTag(item, "title"));
  const link = unescapeEntities(extractTag(item, "link"));
  const pubDate = extractTag(item, "pubDate");
  // FitGirl (and other WordPress feeds) HTML-entity-escape the ampersands inside
  // magnets (e.g. `&#038;dn=`), which would mangle every `tr`/`dn` param. The
  // infohash survives, but the mangled announce URLs break discovery.
  const rawMagnet = item.match(/href="(magnet:\?xt=urn:btih:[^"]+)"/i)?.[1] ?? undefined;
  const magnet = rawMagnet ? unescapeEntities(rawMagnet) : undefined;
  const sizeRaw = extractTag(item, "nyaa:size") || extractTag(item, "size") || undefined;
  const seeders = extractTag(item, "nyaa:seeders") || undefined;
  const leechers = extractTag(item, "nyaa:leechers") || undefined;
  return { title, link, description: unescapeEntities(extractTag(item, "description")), pubDate, magnet, sizeRaw, seeders, leechers, infoHash: undefined, extra: {} };
}

/** Number of bytes for a human size like "1.4 GiB", "720MB", "2.10 GB". */
export function parseSize(raw: string): number {
  const s = raw.trim().toLowerCase();
  const m = s.match(/^([\d.]+)\s*(b|kb|kib|mb|mib|gb|gib|tb|tib)?$/);
  if (!m) return 0;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return 0;
  const unit = m[2] ?? "b";
  const mult: Record<string, number> = {
    b: 1,
    kb: 1e3,
    kib: 1 << 10,
    mb: 1e6,
    mib: 1 << 20,
    gb: 1e9,
    gib: 1 << 30,
    tb: 1e12,
    tib: 1 << 40,
  };
  return Math.round(value * (mult[unit] ?? 1));
}

export interface WordpressRssSource {
  sourceId: string;
  query: string;
  ctx: SearchContext;
}

/** Fetch a WordPress RSS feed (search or full feed), paginating shallowly. */
export async function fetchWordpressRss(
  base: string,
  sourceId: string,
  query: string,
  ctx: SearchContext,
): Promise<SearchResult[]> {
  const q = query.trim();
  const url = q
    ? `${base}/?s=${encodeURIComponent(q)}&feed=rss2`
    : `${base}/feed/`;
  const results = await fetchFeedPage(url, sourceId, ctx);
  const rawCount = results.count;
  if (rawCount < 10) return results.items;

  // Only page deeper when the first page is full, mirroring typical feeds.
  const deeper = await Promise.all(
    [2, 3].map((page) =>
      fetchFeedPage(`${url}${q ? "&" : "?"}paged=${page}`, sourceId, ctx)
        .then((r) => r.items)
        .catch(() => [] as SearchResult[]),
    ),
  );
  const seen = new Set(results.items.map((r) => r.infohash));
  const out = [...results.items];
  for (const r of deeper.flat()) {
    if (seen.has(r.infohash)) continue;
    seen.add(r.infohash);
    out.push(r);
  }
  return out;
}

async function fetchFeedPage(
  url: string,
  sourceId: string,
  ctx: SearchContext,
): Promise<{ items: SearchResult[]; count: number }> {
  const xml = await fetchText(url, {
    signal: ctx.signal,
    timeoutMs: ctx.timeoutMs,
    retries: 1,
  });
  const fragments = splitItems(xml);
  const items: SearchResult[] = [];
  for (const frag of fragments) {
    const item = parseRssItem(frag);
    if (!item.magnet) continue;
    const infoHash = item.magnet.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1]?.toLowerCase() ?? "";
    if (!infoHash) continue;
    const added = item.pubDate ? new Date(item.pubDate).getTime() / 1000 : undefined;
    items.push({
      infohash: infoHash,
      title: item.title || "Unknown",
      size: item.sizeRaw ? parseSize(item.sizeRaw) : undefined,
      seeders: item.seeders !== undefined ? Number(item.seeders) || 0 : undefined,
      leechers: item.leechers !== undefined ? Number(item.leechers) || 0 : undefined,
      sourceId,
      magnet: item.magnet,
      torrentUrl: item.link || undefined,
      added: added && Number.isFinite(added) ? added : undefined,
    });
  }
  return { items, count: fragments.length };
}

export { HttpError };