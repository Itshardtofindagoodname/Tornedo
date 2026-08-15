/**
 * 1337x (1337x.to) HTML adapter for Movies and TV. Scrapes the category-search
 * listing, then fetches detail pages to resolve magnets. Rotates between mirror
 * hosts and remembers the working one.
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import { fetchText, HttpError, ParseError } from "./net.js";
import { unescapeEntities } from "./rss.js";
import { buildMagnet, normalizeInfoHash } from "../torrent/parse.js";

const HOSTS = ["1337x.to", "1337x.st", "x1337x.ws", "1337xx.to"];
let workingHostIndex = 0;

const MAX_DETAILS = 6;
const STOP = new Set(["the", "a", "an", "of", "and", "or", "to", "for", "in"]);

interface Row {
  name: string;
  path: string;
  seeders: number;
  leechers: number;
  sizeBytes: number;
}

function parseRows(html: string): Row[] {
  const start = html.indexOf("table-list");
  if (start < 0) return [];
  const out: Row[] = [];
  for (const tr of html.slice(start).split(/<tr[\s>]/i).slice(1)) {
    const link = tr.match(/href="(\/torrent\/[^"]+)"[^>]*>([^<]+)<\/a>/i);
    if (!link) continue;
    const size = tr.match(/class="coll-4 size[^"]*">\s*([\d.]+\s*[KMGT]i?B)/i)?.[1] ?? "";
    out.push({
      name: unescapeEntities(link[2]!.trim()),
      path: link[1]!,
      seeders: Number(tr.match(/class="coll-2 seeds[^"]*">\s*(\d+)/i)?.[1] ?? 0),
      leechers: Number(tr.match(/class="coll-3 leeches[^"]*">\s*(\d+)/i)?.[1] ?? 0),
      sizeBytes: parseSizeSafe(size),
    });
  }
  return out;
}

function parseSizeSafe(raw: string): number {
  const s = raw.trim().toLowerCase();
  const m = s.match(/^([\d.]+)\s*([kmgt]i?b)$/);
  if (!m) return 0;
  const value = Number(m[1]);
  if (!Number.isFinite(value)) return 0;
  const mult: Record<string, number> = {
    kb: 1e3,
    k: 1e3,
    mb: 1e6,
    m: 1e6,
    gb: 1e9,
    g: 1e9,
    tb: 1e12,
    t: 1e12,
  };
  const u = m[2]!.replace(/i/, "");
  return Math.round(value * (mult[u] ?? 1));
}

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

/** 1337x detail pages render dates like "Jun. 26th  '26". */
export function parseUploadDate(html: string): number | undefined {
  const m = html.match(/Date uploaded<\/strong>\s*<span>\s*([A-Za-z]{3})\.?\s+(\d{1,2})[a-z]{2}\s*'(\d{2})/i);
  if (!m) return undefined;
  const month = MONTHS[m[1]!.toLowerCase()];
  if (month === undefined) return undefined;
  const day = Number(m[2]);
  const year = 2000 + Number(m[3]);
  const secs = Math.floor(Date.UTC(year, month, day) / 1000);
  return Number.isNaN(secs) ? undefined : secs;
}

type DetailOutcome =
  | { ok: true; magnet: string; added?: number }
  | { ok: false; kind: "parse" | "http" };

async function detailInfo(
  base: string,
  path: string,
  ctx: SearchContext,
): Promise<DetailOutcome> {
  try {
    const html = await fetchText(`${base}${path}`, {
      signal: ctx.signal,
      timeoutMs: ctx.timeoutMs,
      retries: 1,
    });
    const raw = html.match(/magnet:\?xt=urn:btih:[^"'<>\s]+/i)?.[0];
    if (!raw) return { ok: false, kind: "parse" };
    return { ok: true, magnet: unescapeEntities(raw), added: parseUploadDate(html) };
  } catch {
    return { ok: false, kind: "http" };
  }
}

async function search(
  query: string,
  cat: "Movies" | "TV" | "Music",
  sourceId: string,
  category: MediaCategory,
  ctx: SearchContext,
): Promise<SearchResult[]> {
  const q = query.trim();
  const path = q
    ? `/category-search/${encodeURIComponent(q).replace(/%20/g, "+")}/${cat}/1/`
    : cat === "Movies"
      ? "/popular-movies"
      : cat === "TV"
        ? "/popular-tv"
        : "/music/";

  let base = "";
  let html = "";
  let lastError: unknown;
  for (let i = 0; i < HOSTS.length; i++) {
    const hostIdx = (workingHostIndex + i) % HOSTS.length;
    const host = HOSTS[hostIdx]!;
    try {
      const candidate = `https://${host}`;
      html = await fetchText(`${candidate}${path}`, {
        signal: ctx.signal,
        timeoutMs: ctx.timeoutMs,
        retries: i === 0 ? 2 : 0,
      });
      base = candidate;
      workingHostIndex = hostIdx;
      break;
    } catch (e) {
      if (ctx.signal.aborted) throw e;
      lastError = e;
    }
  }
  if (!base) throw lastError instanceof Error ? lastError : new HttpError(0, "1337x unreachable");

  const all = parseRows(html);
  // The listing answered but the table structure we scrape is gone. Report a
  // parse failure rather than silently claiming "zero results".
  if (all.length === 0 && !/table-list/.test(html)) {
    throw new ParseError(`${sourceId}: listing structure unrecognized`);
  }
  const tokens = q.toLowerCase().split(/\s+/).filter(Boolean);
  const meaningful = tokens.filter((t) => !STOP.has(t));
  const need = meaningful.length > 0 ? meaningful : tokens;
  const matched = need.length > 0
    ? all.filter((r) => {
        const n = r.name.toLowerCase();
        return need.every((t) => n.includes(t));
      })
    : all;
  matched.sort((a, b) => b.seeders - a.seeders);
  const rows = matched.slice(0, MAX_DETAILS);

  const details = await Promise.all(rows.map((row) => detailInfo(base, row.path, ctx)));
  const results: SearchResult[] = [];
  let parseCount = 0;
  let httpCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    const detail = details[i]!;
    if (detail.ok) {
      const infoHash = normalizeInfoHash(detail.magnet.match(/urn:btih:([a-zA-Z0-9]+)/i)?.[1] ?? "");
      if (infoHash) {
        results.push({
          infohash: infoHash,
          title: row.name,
          size: row.sizeBytes || undefined,
          seeders: row.seeders || undefined,
          leechers: row.leechers || undefined,
          sourceId,
          category,
          magnet: detail.magnet,
          added: detail.added,
        });
      } else {
        parseCount++;
      }
    } else if (detail.kind === "parse") {
      parseCount++;
    } else {
      httpCount++;
    }
  }
  if (results.length > 0) return results;
  if (rows.length === 0) return [];

  // No magnet from any detail page. If at least one page loaded but contained
  // no magnet, the detail-page structure changed → parse failure. If all pages
  // failed at the network layer, it is availability, not parsing.
  if (parseCount > 0) {
    throw new ParseError(`${sourceId}: no magnet found in any of ${rows.length} detail pages (${parseCount} unparsable, ${httpCount} http errors)`);
  }
  throw new HttpError(0, `${sourceId}: all ${rows.length} detail pages failed to load`);
}

export const x1337Movies: SourceAdapter = {
  id: "x1337-movies",
  name: "1337x",
  groups: ["Movies"],
  categories: ["Movie"],
  homepage: "https://1337x.to",
  timeoutMs: 15_000,
  concurrency: 4,
  reportsHealth: true,
  search: (q, ctx) => search(q, "Movies", "x1337-movies", "Movie", ctx),
};

export const x1337Tv: SourceAdapter = {
  id: "x1337-tv",
  name: "1337x",
  groups: ["TV"],
  categories: ["TV"],
  homepage: "https://1337x.to",
  timeoutMs: 15_000,
  concurrency: 4,
  reportsHealth: true,
  search: (q, ctx) => search(q, "TV", "x1337-tv", "TV", ctx),
};

export const x1337Music: SourceAdapter = {
  id: "x1337-music",
  name: "1337x",
  groups: ["Music"],
  categories: ["Music"],
  homepage: "https://1337x.to",
  timeoutMs: 15_000,
  concurrency: 4,
  reportsHealth: true,
  search: (q, ctx) => search(q, "Music", "x1337-music", "Music", ctx),
};