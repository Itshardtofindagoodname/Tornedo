/**
 * 4KHDHub scraper client. Scrapes HTML from 4khdhub.one (configurable via
 * `TORNEDO_FOURKHDHUB_URL`, falling back to `MOVIEBOX_FOURKHDHUB_URL`): movie
 * cards on search, details pages, per-episode download items and hub cloud
 * mirror resolution with a Range preflight probe.
 */
import { htmlAttr, htmlText, parseHtml, queryAllHtml, queryHtml, type HtmlElement, type HtmlNode } from "./html.js";
import {
  StreamCatalogItem,
  StreamDetails,
  StreamError,
  StreamMirror,
  StreamRelease,
  StreamProviderId,
} from "./models.js";
import { canonicalQuery } from "./crypto.js";

const DEFAULT_BASE = "https://4khdhub.one/";

export function fourkhdhubBaseUrl(env = process.env): string {
  const fromEnv = env.TORNEDO_FOURKHDHUB_URL ?? env.MOVIEBOX_FOURKHDHUB_URL;
  if (typeof fromEnv === "string" && fromEnv.trim().length > 0) return fromEnv.replace(/\/+$/, "") + "/";
  return DEFAULT_BASE;
}

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

function html(page: unknown): string {
  if (typeof page === "string") return page;
  throw new StreamError("parsing", "expected HTML text from 4KHDHub", { provider: "fourkhdhub" });
}

export class FourKHDHubClient {
  readonly provider: StreamProviderId = "fourkhdhub";
  private readonly baseUrl: string;
  private readonly htmlCache = new Map<string, Promise<string>>();

  constructor(baseUrl?: string) {
    this.baseUrl = (baseUrl ?? fourkhdhubBaseUrl()).replace(/\/+$/, "") + "/";
  }

  private async fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
    const existing = this.htmlCache.get(url);
    if (existing !== undefined) return existing;
    const promise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 12000);
      const onAbort = () => controller.abort();
      if (signal !== undefined) {
        if (signal.aborted) controller.abort();
        else signal.addEventListener("abort", onAbort, { once: true });
      }
      try {
        const res = await fetch(url, {
          headers: {
            "user-agent": UA,
            accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "accept-language": "en-US,en;q=0.9",
          },
          signal: controller.signal,
          redirect: "follow",
        });
        if (!res.ok) {
          if (res.status === 404) throw new StreamError("notFound", `4KHDHub 404 for ${url}`, { provider: "fourkhdhub" });
          throw new StreamError("network", `4KHDHub responded ${res.status}`, { provider: "fourkhdhub" });
        }
        return await res.text();
      } finally {
        clearTimeout(timer);
        if (signal !== undefined) signal.removeEventListener("abort", onAbort);
      }
    })();
    this.htmlCache.set(url, promise);
    return promise;
  }

  /** Strip base + query from a crawler url; used for the result id. */
  static idFromUrl(url: string): string {
    try {
      const u = new URL(url);
      return `${u.pathname}${u.search}`;
    } catch {
      return url;
    }
  }

  urlFor(path: string): string {
    return path.startsWith("http") ? path : new URL(path, this.baseUrl).toString();
  }

  async search(query: string, signal?: AbortSignal): Promise<StreamCatalogItem[]> {
    const url = this.urlFor(`?s=${encodeURIComponent(query)}`);
    const dom = parseHtml(await this.fetchHtml(url, signal));
    const cards = queryAllHtml(dom, "a.movie-card");
    const items: StreamCatalogItem[] = [];
    for (const card of cards) {
      const href = htmlAttr(card, "href");
      if (href === undefined) continue;
      const id = FourKHDHubClient.idFromUrl(this.urlFor(href));
      const img = queryHtml(card.children, "img");
      const title = htmlText(queryHtml(card.children, ".movie-card-title")?.children ?? card.children);
      const meta = htmlText(queryHtml(card.children, ".movie-card-meta")?.children ?? []);
      const seasonText = htmlText(queryHtml(card.children, ".movie-card-seasons")?.children ?? []);
      const yearMatch = /(19|20)\d{2}/.exec(meta);
      const seasonMatch = /(\d+)\s*(?:season|seasons|s\b)/i.exec(seasonText);
      if (title.length === 0) continue;
      items.push({
        provider: "fourkhdhub",
        id,
        title,
        mediaType: seasonMatch !== null ? "series" : "movie",
        year: yearMatch?.[1],
        posterUrl: img !== null ? this.urlFor(htmlAttr(img, "src") ?? "") : undefined,
        seasonCount: seasonMatch === null ? undefined : Number(seasonMatch[1]),
        extra: { pageUrl: this.urlFor(href) },
      });
    }
    return items;
  }

  async getDetails(path: string, signal?: AbortSignal): Promise<StreamDetails> {
    const url = this.urlFor(path);
    const page = html(await this.fetchHtml(url, signal));
    const dom = parseHtml(page);
    const title = htmlText(queryHtml(dom, "h1")?.children ?? []) || (og(dom, "og:title") ?? "");
    const posterUrl = og(dom, "og:image");
    const description = og(dom, "og:description") ?? htmlText(queryHtml(dom, ".content-section p")?.children ?? []);
    const tagline = htmlText(queryHtml(dom, ".movie-tagline")?.children ?? []);
    const imdbRating = htmlText(queryHtml(dom, ".imdb-score")?.children ?? []);
    const genres = queryAllHtml(dom, ".badge-outline a")
      .map((el) => htmlText(el.children))
      .filter((g) => g.length > 0);
    const stars = htmlText(queryHtml(dom, ".stars")?.children ?? []);
    const director = htmlText(queryHtml(dom, ".director")?.children ?? []);
    const duration = htmlText(queryHtml(dom, ".duration")?.children ?? []);
    const prints = htmlText(queryHtml(dom, ".prints")?.children ?? []);
    const audios = htmlText(queryHtml(dom, ".audios")?.children ?? []);
    const yearMatch = /(19|20)\d{2}/.exec(title + " " + description + " " + (posterUrl ?? ""));

    const isSeries = queryHtml(dom, "#episodes") !== null;
    const seasons = isSeries ? this.extractSeasons(dom) : [];

    return {
      provider: "fourkhdhub",
      id: path,
      title,
      mediaType: isSeries ? "series" : "movie",
      year: yearMatch?.[1],
      description,
      tagline: tagline.length > 0 ? tagline : undefined,
      imdbRating: imdbRating.length > 0 ? imdbRating : undefined,
      director: director.length > 0 ? director : undefined,
      stars: stars.length > 0 ? stars : undefined,
      prints: prints.length > 0 ? prints : undefined,
      audios: audios.length > 0 ? audios : undefined,
      duration: duration.length > 0 ? duration : undefined,
      genres,
      posterUrl: posterUrl !== undefined ? this.urlFor(posterUrl) : undefined,
      seasons,
    };
  }

  private extractSeasons(dom: HtmlNode[]): StreamDetails["seasons"] {
    const seasonMap = new Map<number, { title?: string }[]>();
    const registry = new Map<number, boolean>();
    const episodes = queryAllHtml(dom, "li.episode-download-item");
    for (const li of episodes) {
      const [se, ep] = parseSeasonEpisode(htmlText(li.children));
      if (se === undefined || ep === undefined) continue;
      registry.set(se, true);
      const list = seasonMap.get(se) ?? [];
      list[ep - 1] = { title: undefined };
      seasonMap.set(se, list);
    }
    return [...seasonMap.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([number, episodes]) => ({
        number,
        episodes: episodes
          .map((ep, i) => ({ season: number, number: i + 1, title: ep.title }))
          .filter((ep) => ep.number <= episodes.length && episodes[ep.number - 1] !== undefined),
      }));
  }

  /** Fetch the details page once and return the releases for a given se/ep. */
  async getReleases(path: string, season: number, episode: number, signal?: AbortSignal): Promise<StreamRelease[]> {
    const url = this.urlFor(path);
    const dom = parseHtml(await this.fetchHtml(url, signal));
    const items = queryAllHtml(dom, "li.episode-download-item");
    const releases: StreamRelease[] = [];
    for (const li of items) {
      const text = htmlText(li.children);
      const [se, ep] = parseSeasonEpisode(text);
      if (season !== 0 && episode !== 0 && (se !== season || ep !== episode)) continue;
      const titleEl = queryHtml(li.children, ".episode-file-title") ?? queryHtml(li.children, ".file-title");
      let filename = htmlText(titleEl?.children ?? li.children);
      if (filename.length === 0) filename = text;
      filename = filename.replace(/^\[.*?\]\s*/, "").trim();

      const links = queryAllHtml(li.children, "a");
      const mirrors: StreamMirror[] = [];
      for (const a of links) {
        const href = htmlAttr(a, "href");
        if (href === undefined || href.length === 0) continue;
        if (/\.(css|js|png|jpg|webp|ico)(\?|$)/i.test(href)) continue;
        const name = htmlText(a.children).trim() || this.mirrorHostLabel(href);
        if (name.length === 0) continue;
        mirrors.push({
          label: name,
          resolverUrl: this.urlFor(href),
          headers: { "user-agent": UA, referer: url },
          directFile: /\.(mp4|mkv|webm|m3u8|avi|mov)($|\?)/i.test(href),
        });
      }
      if (mirrors.length === 0) continue;

      const size = parseSize(text);
      const codec = detectCodec(filename);
      const language = detectLanguage(text + " " + filename);
      const release: StreamRelease = {
        provider: "4KHDHub",
        filename,
        quality: detectQuality(filename + " " + text),
        codec,
        language,
        sizeBytes: size,
        season: se,
        episode: ep,
        mirrors,
      };
      releases.push(release);
    }
    // Deduplicate by filename which often repeats across mirrors groups.
    const byName = new Map<string, StreamRelease>();
    for (const r of releases) {
      const existing = byName.get(r.filename);
      if (existing === undefined) byName.set(r.filename, r);
      else existing.mirrors.push(...r.mirrors);
    }
    return [...byName.values()];
  }

  /**
   * Resolve a hub-cloud "go" link into a playable file: follow redirects, then
   * probe the final URL with a ranged GET to learn length/type.
   */
  async resolveMirror(mirror: StreamMirror, signal?: AbortSignal): Promise<{ url: string; headers: Record<string, string>; sizeBytes?: number; directFile: boolean }> {
    const finalUrl = await this.followRedirects(mirror.resolverUrl, mirror.headers, signal);
    const directFile = mirror.directFile || isDirectMedia(finalUrl);
    let sizeBytes: number | undefined;
    if (directFile) {
      sizeBytes = await this.probe(finalUrl, mirror.headers, signal);
    }
    return { url: finalUrl, headers: mirror.headers, sizeBytes, directFile };
  }

  private async followRedirects(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<string> {
    const res = await fetch(url, {
      method: "HEAD",
      headers: { ...headers, accept: "*/*" },
      signal: signal ?? undefined,
      redirect: "follow",
    });
    return res.url;
  }

  private async probe(url: string, headers: Record<string, string>, signal?: AbortSignal): Promise<number | undefined> {
    try {
      const res = await fetch(url, {
        headers: { ...headers, range: "bytes=0-0", accept: "*/*" },
        signal: signal ?? undefined,
        redirect: "follow",
      });
      if (!res.ok && res.status !== 206) return undefined;
      const length = res.headers.get("content-length");
      const range = res.headers.get("content-range");
      void length;
      if (range !== null) {
        const total = /(\d+)\s*$/.exec(range);
        if (total !== null) return Number(total[1]);
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private mirrorHostLabel(url: string): string {
    try {
      const host = new URL(url).hostname.replace(/^www\./, "");
      if (host.includes("hubcloud")) return "HubCloud";
      if (host.includes("hubdrive")) return "HubDrive";
      if (host.includes("pixeldrain")) return "PixelDrain";
      if (host.includes("direct")) return "Direct";
      return host.split(".")[0] ?? "Link";
    } catch {
      return "Link";
    }
  }
}

function og(dom: HtmlNode[], property: string): string | undefined {
  const meta = queryAllHtml(dom, "meta").find((el) => htmlAttr(el, "property") === property);
  if (meta === null || meta === undefined) return undefined;
  return htmlAttr(meta, "content");
}

export function parseSeasonEpisode(text: string): [number | undefined, number | undefined] {
  const regionFromFull = /S(\d+)E(\d+)|(\d+)x(\d+)|Season\s*(\d+)[,:.\s]*\s*Episode\s*(\d+)/i.exec(text);
  if (regionFromFull !== null) {
    if (regionFromFull[1] !== undefined && regionFromFull[2] !== undefined) {
      return [Number(regionFromFull[1]), Number(regionFromFull[2])];
    }
    if (regionFromFull[3] !== undefined && regionFromFull[4] !== undefined) {
      return [Number(regionFromFull[3]), Number(regionFromFull[4])];
    }
    if (regionFromFull[5] !== undefined && regionFromFull[6] !== undefined) {
      return [Number(regionFromFull[5]), Number(regionFromFull[6])];
    }
  }
  const se = /S(\d{1,2})\b/i.exec(text);
  const ep = /E(\d{1,3})\b/i.exec(text);
  if (se !== null && ep !== null) return [Number(se[1]), Number(ep[1])];
  return [undefined, undefined];
}

export function detectQuality(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (/\b(2160p|4k|uhd)\b/.test(lower)) {
    if (/\b4k\b/.test(lower) && /\b2160p\b/.test(lower)) return "2160p";
    if (/2160p/.test(lower)) return "2160p";
    return "2160p";
  }
  if (/\b1080p\b|\bfhd\b/.test(lower)) return "1080p";
  if (/\b720p\b|\bhd\b/.test(lower)) return "720p";
  if (/\b480p\b|\bsd\b/.test(lower)) return "480p";
  return undefined;
}

export function detectCodec(text: string): string | undefined {
  if (/\bx264\b|\bh\.264\b|\bavc\b/i.test(text)) return "H.264";
  if (/\bx265\b|\bh\.265\b|\bhevc\b/i.test(text)) return "H.265";
  if (/\bav1\b/i.test(text)) return "AV1";
  if (/\bvpx\b/i.test(text)) return "VP9";
  if (/\bweb.?dl\b|\bwebrip\b|\bbluray\b|\bbdremux\b|\bbdrip\b|\bhdtv\b|\bhdr\b|\bdv\b/i.test(text)) {
    if (/\bhdr\b/i.test(text)) return "HDR";
    if (/\bdv\b/i.test(text)) return "DV";
    return "WEB-DL";
  }
  return undefined;
}

const LANGUAGE_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(tamil|தமிழ்)\b/i, "Tamil"],
  [/\b(telugu|తెలుగు)\b/i, "Telugu"],
  [/\b(hindi|हिंदी|हिन्दी)\b/i, "Hindi"],
  [/\b(malayalam|മലയാളം)\b/i, "Malayalam"],
  [/\b(kannada|ಕನ್ನಡ)\b/i, "Kannada"],
  [/\b(bengali|বাংলা)\b/i, "Bengali"],
  [/\b(marathi|मराठी)\b/i, "Marathi"],
  [/\b(gujarati|ગુજરાતી)\b/i, "Gujarati"],
  [/\b(punjabi|ਪੰਜਾਬੀ)\b/i, "Punjabi"],
];

export function detectLanguage(text: string): string | undefined {
  const langs: string[] = [];
  for (const [re, label] of LANGUAGE_PATTERNS) {
    if (re.test(text) && !langs.includes(label)) langs.push(label);
  }
  if (langs.length === 0) return undefined;
  return langs.join(", ");
}

export function parseSize(text: string): number | undefined {
  const m = /(\d+(?:\.\d+)?)\s*(GB|MB|GiB|MiB)/i.exec(text);
  if (m === null) return undefined;
  const value = Number(m[1]);
  const unit = m[2]!.toUpperCase();
  if (unit === "GB" || unit === "GIB") return Math.round(value * 1024 * 1024 * 1024);
  if (unit === "MB" || unit === "MIB") return Math.round(value * 1024 * 1024);
  return undefined;
}

export function isDirectMedia(url: string): boolean {
  return /\.(mp4|mkv|webm|m3u8|mp3|flv|ts|avi|mov)(\?|#|$)/i.test(url);
}

export async function fetchWithQuery(url: string, pairs: [string, string][]): Promise<string> {
  const query = canonicalQuery(pairs);
  const full = `${url}${query.length > 0 ? `?${query}` : ""}`;
  const res = await fetch(full, {
    headers: { "user-agent": UA, accept: "html" },
    redirect: "follow",
  });
  if (!res.ok) throw new StreamError("network", `fetch ${full} -> ${res.status}`);
  return res.text();
}