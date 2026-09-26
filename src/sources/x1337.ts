/**
 * 1337x (1337x.to) HTML adapter for Movies and TV. Scrapes the category-search
 * listing, then fetches detail pages to resolve magnets. Rotates between mirror
 * hosts and remembers the working one.
 */
import type { MediaCategory, SearchResult } from "../model/search.js";
import type { SearchContext, SourceAdapter } from "../model/source.js";
import type { FlareSolverrConfig } from "../config/config.js";
import {
  CancelledError,
  fetchFromFirstMirror,
  fetchText,
  fetchViaFlareSolverr,
  HttpError,
  looksLikeCloudflareChallenge,
  ParseError,
} from "./net.js";
import { unescapeEntities } from "./rss.js";
import { buildMagnet, normalizeInfoHash } from "../torrent/parse.js";

const HOSTS = ["1337x.to", "1337x.st", "x1337x.ws", "1337xx.to"];

const MAX_DETAILS = 6;
const STOP = new Set(["the", "a", "an", "of", "and", "or", "to", "for", "in"]);

/**
 * How many mirrors one search will replay through FlareSolverr when the whole
 * race was refused. Enough to ride out one bad host; every attempt is a full
 * browser page load in the container, so the list is deliberately short.
 */
const MAX_SOLVED_MIRRORS = 2;

/**
 * Budget for a plain detail-page fetch, deliberately *not* the adapter's own
 * timeout. Direct requests are not slow, and the difference is what reserves
 * room in the adapter timeout for a FlareSolverr solve to happen in - so a user
 * who never enables the proxy pays exactly what they paid before it existed.
 */
const DETAIL_DIRECT_TIMEOUT_MS = 15_000;

/**
 * Raised from 15s so a browser-driven solve has a fair chance. A solve is not a
 * plain HTTP request: a cold FlareSolverr container can take several seconds
 * just to start a browser. Note that the effective solve budget is
 * `min(adapter timeoutMs, flaresolverr.timeoutMs)` - the engine aborts the
 * source first, so `flaresolverr.timeoutMs` above this value buys nothing.
 */
const SOURCE_TIMEOUT_MS = 30_000;

interface Row {
  name: string;
  path: string;
  seeders: number;
  leechers: number;
  sizeBytes: number;
}

export function parseRows(html: string): Row[] {
  const start = html.indexOf("table-list");
  if (start < 0) return [];
  const out: Row[] = [];
  for (const tr of html.slice(start).split(/<tr[\s>]/i).slice(1)) {
    // The first /torrent/ anchor is usually the row icon; iterate and take the
    // first one that carries a real title.
    let name: string | undefined;
    let path: string | undefined;
    for (const link of tr.matchAll(/<a\b[^>]*href\s*=\s*["'](\/torrent\/[^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
      const candidate = unescapeEntities(link[2]!.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
      if (!candidate) continue;
      name = candidate;
      path = link[1]!;
      break;
    }
    if (!name || !path) continue;
    const sizeCell = tr.match(/class\s*=\s*"(?=[^"]*\bsize\b)[^"]*"\s*>\s*([\d.]+\s*[KMGT]i?B)/i)?.[1];
    const seedsCell = tr.match(/class\s*=\s*"(?=[^"]*\bseeds\b)[^"]*"\s*>\s*([\d,]+)/i)?.[1];
    const leechesCell = tr.match(/class\s*=\s*"(?=[^"]*\bleeches\b)[^"]*"\s*>\s*([\d,]+)/i)?.[1];
    out.push({
      name,
      path,
      seeders: Number((seedsCell ?? "").replace(/,/g, "")),
      leechers: Number((leechesCell ?? "").replace(/,/g, "")),
      sizeBytes: parseSizeSafe(sizeCell ?? ""),
    });
  }
  return out;
}

export function parseSizeSafe(raw: string): number {
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

/**
 * The statuses Cloudflare uses when it refuses a request it wants challenged.
 * Everything else is a different problem that a browser page load cannot fix:
 * 429 is rate limiting, 404 is a wrong path, status 0 is a host that never
 * answered and 5xx-other is an origin outage. Escalating only these keeps a
 * solve from being spent on an outage or a rate limit.
 */
function isChallengeStatus(status: number): boolean {
  return status === 403 || status === 503;
}

/**
 * Replay a URL through FlareSolverr and return the solved HTML, or undefined
 * when the solver had nothing usable to give back (empty page, or a challenge
 * that survived the solve). Throws `HttpError` when the proxy itself fails, so
 * the caller can report why.
 */
async function solveOnce(url: string, cfg: FlareSolverrConfig, ctx: SearchContext): Promise<string | undefined> {
  const solved = await fetchViaFlareSolverr(url, {
    baseUrl: cfg.url,
    timeoutMs: cfg.timeoutMs,
    signal: ctx.signal,
  });
  if (!solved.body || looksLikeCloudflareChallenge(solved.status, solved.body)) return undefined;
  return solved.body;
}

type DetailOutcome =
  | { ok: true; magnet: string; added?: number }
  | { ok: false; kind: "parse" | "http" | "cloudflare" };

/**
 * Fetch one detail page and pull its magnet. Detail pages sit behind the same
 * Cloudflare challenge as the listing, so a challenge-shaped refusal is
 * replayed through FlareSolverr rather than reported as a dead page.
 */
async function detailInfo(
  base: string,
  path: string,
  ctx: SearchContext,
): Promise<DetailOutcome> {
  const url = `${base}${path}`;
  const flaresolverr = ctx.flaresolverr;
  let html: string | undefined;

  try {
    const direct = await fetchText(url, {
      signal: ctx.signal,
      timeoutMs: Math.min(ctx.timeoutMs, DETAIL_DIRECT_TIMEOUT_MS),
      retries: 1,
    });
    // A 200 that is really the interstitial would otherwise land in the parse
    // bucket, pointing the user at a page-structure problem they cannot fix.
    if (!looksLikeCloudflareChallenge(200, direct)) html = direct;
  } catch (e) {
    // Only Cloudflare's own refusal statuses escalate; anything else is
    // availability, and stays reported as such.
    if (!(e instanceof HttpError && isChallengeStatus(e.status))) {
      return { ok: false, kind: "http" };
    }
  }

  if (html === undefined) {
    if (!flaresolverr?.enabled) return { ok: false, kind: "cloudflare" };
    try {
      html = await solveOnce(url, flaresolverr, ctx);
    } catch {
      // The proxy failed, or the search was cancelled mid-solve. Either way
      // this page is a block, which search() turns into the actionable message.
      html = undefined;
    }
    if (html === undefined) return { ok: false, kind: "cloudflare" };
  }

  const raw = html.match(/magnet:\?xt=urn:btih:[^"'<>\s]+/i)?.[0];
  if (!raw) return { ok: false, kind: "parse" };
  return { ok: true, magnet: unescapeEntities(raw), added: parseUploadDate(html) };
}

/**
 * Fetch the listing page, racing every mirror.
 *
 * When the race yields no usable page and the user has opted into FlareSolverr,
 * the affected mirror is replayed through the solver instead of the source
 * failing. With FlareSolverr off this is exactly the original mirror race.
 */
async function fetchListing(
  path: string,
  sourceId: string,
  ctx: SearchContext,
): Promise<{ url: string; body: string }> {
  const urls = HOSTS.map((host) => `https://${host}${path}`);
  const opts = { signal: ctx.signal, timeoutMs: Math.min(ctx.timeoutMs, 10_000), retries: 0 };

  let direct: { url: string; body: string } | undefined;
  let directError: unknown;
  try {
    direct = await fetchFromFirstMirror(urls, opts);
  } catch (e) {
    directError = e;
  }

  // A Cloudflare block surfaces two ways. The mirror can answer 403/503, in
  // which case the race rejects and fetchResilient has already discarded the
  // interstitial body, so the status is the only evidence left. Or it can
  // answer 200 carrying the challenge markup, so the race "wins" with an
  // unreadable page - only a 2xx can win, hence the hardcoded 200 below.
  const challenged = (directError instanceof HttpError && isChallengeStatus(directError.status)) ||
    (direct !== undefined && looksLikeCloudflareChallenge(200, direct.body));

  // Anything that is not a challenge is reported exactly as before. A rate
  // limit, a wrong path or a dead host must never be laundered through the
  // solver: a browser solve would not fix it and would cost a page load.
  if (direct && !challenged) return direct;
  if (!challenged) throw directError;

  const flaresolverr = ctx.flaresolverr;
  if (!flaresolverr?.enabled) {
    // A bare "HTTP 403" or "listing structure unrecognized" hides the cause.
    throw new HttpError(403, `${sourceId}: blocked by Cloudflare — enable FlareSolverr in config to bypass`);
  }

  // When a single mirror won with a challenge, replay that mirror only. When the
  // whole race failed there is no winner to attribute, so walk the hosts in
  // order - but only the first few, because every solve is a real browser page
  // load and the source timeout, not the mirror list, is what bounds this.
  const candidates = direct ? [direct.url] : urls.slice(0, MAX_SOLVED_MIRRORS);
  let lastError: unknown = directError;
  for (const url of candidates) {
    try {
      const body = await solveOnce(url, flaresolverr, ctx);
      if (body !== undefined) return { url, body };
      lastError = new HttpError(403, `${sourceId}: Cloudflare challenge survived FlareSolverr for ${url}`);
    } catch (e) {
      if (e instanceof CancelledError) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new HttpError(0, `${sourceId}: blocked by Cloudflare — enable FlareSolverr in config to bypass`);
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

  // All mirrors are raced concurrently: a hanging or blocked domain can no
  // longer consume the source's whole timeout budget before a fallback is ever
  // contacted. Detail-page links resolve against the winning origin.
  const { url: winningUrl, body: html } = await fetchListing(path, sourceId, ctx);
  const base = new URL(winningUrl).origin;

  const all = parseRows(html);
  // The listing answered but we cannot read it. Fail loudly instead of silently
  // claiming "zero results" whenever either (a) the table container we scrape is
  // gone, or (b) the container exists but the page still links to /torrent/
  // detail pages we failed to parse. A genuinely empty result page has a table
  // with no detail links, which is a legitimate empty set.
  if (all.length === 0 && (!/table-list/.test(html) || /href\s*=\s*["']\/torrent\//i.test(html))) {
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
  let cloudflareCount = 0;
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
    } else if (detail.kind === "cloudflare") {
      cloudflareCount++;
    } else {
      httpCount++;
    }
  }
  if (results.length > 0) return results;
  if (rows.length === 0) return [];

  // Every page was refused by Cloudflare. That is one cause with one fix, so
  // name it instead of reporting it as generic unavailability.
  if (cloudflareCount === rows.length) {
    throw new HttpError(403, `${sourceId}: blocked by Cloudflare — enable FlareSolverr in config to bypass`);
  }

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
  timeoutMs: SOURCE_TIMEOUT_MS,
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
  timeoutMs: SOURCE_TIMEOUT_MS,
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
  timeoutMs: SOURCE_TIMEOUT_MS,
  concurrency: 4,
  reportsHealth: true,
  search: (q, ctx) => search(q, "Music", "x1337-music", "Music", ctx),
};