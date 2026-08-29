/**
 * BDIX provider (CircleFTP). A faithful TypeScript port of MovieBox-Tui's
 * CircleFtpClient: the public JSON API at new.circleftp.net:5000 serves search,
 * details and release links.
 *
 * BDIX hosts are only reachable from supported Bangladeshi ISP networks, so
 * every request runs under a short timeout and carries a reachability latch:
 * after a failure we skip further attempts for a window, so watch searches on
 * networks that cannot reach BDIX never stall on a dead endpoint. Everything
 * degrades to empty lists - BDIX can only add results, never break playback.
 */
import type {
  StreamCatalogItem,
  StreamDetails,
  StreamSeason,
  StreamSubtitleOption,
  StreamRelease,
  StreamMirror,
} from "./models.js";

export const CIRCLEFTP_API = "http://new.circleftp.net:5000/api";
export const CIRCLEFTP_UPLOADS = "http://new.circleftp.net:5000/uploads";

export interface BdixClientOptions {
  /** Overridden in tests. */
  fetchImpl?: typeof fetch;
  /** Overridden in tests. */
  now?: () => number;
  /** Window during which a failed probe suppresses further attempts (ms). */
  skipWindowMs?: number;
  /** How long each BDIX request may run (ms). */
  requestTimeoutMs?: number;
  /** How long the optional size HEAD may run (ms). */
  headTimeoutMs?: number;
}

interface CircleFtpPost {
  id?: number;
  title?: string;
  name?: string;
  type?: string;
  year?: number | string;
  image?: string;
  imageSm?: string;
}

export class BdixClient {
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => number;
  private readonly skipWindowMs: number;
  private readonly requestTimeoutMs: number;
  private readonly headTimeoutMs: number;
  private lastFailAt = Number.NEGATIVE_INFINITY;

  constructor(opts: BdixClientOptions = {}) {
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
    this.now = opts.now ?? Date.now;
    this.skipWindowMs = opts.skipWindowMs ?? 5 * 60 * 1000;
    this.requestTimeoutMs = opts.requestTimeoutMs ?? 6_000;
    this.headTimeoutMs = opts.headTimeoutMs ?? 3_000;
  }

  private shouldAttempt(): boolean {
    return this.now() - this.lastFailAt > this.skipWindowMs;
  }

  private markFailed(): void {
    this.lastFailAt = this.now();
  }

  /** Search the CircleFTP catalog. Never throws; [] on any failure. */
  async search(query: string, signal?: AbortSignal): Promise<StreamCatalogItem[]> {
    if (!this.shouldAttempt()) return [];
    const params = new URLSearchParams({ searchTerm: query, order: "desc" }).toString();
    try {
      const raw = await this.requestJson(`${CIRCLEFTP_API}/posts?${params}`, signal, this.requestTimeoutMs);
      const posts = Array.isArray((raw as { posts?: unknown })?.posts) ? (raw as { posts: CircleFtpPost[] }).posts : [];
      return posts.filter((p) => p !== null && typeof p === "object").map(postToCatalog);
    } catch {
      this.markFailed();
      return [];
    }
  }

  /** Details for a BDIX catalog item. Never throws; falls back to item data. */
  async details(item: StreamCatalogItem, signal?: AbortSignal): Promise<StreamDetails> {
    if (item.provider !== "bdix_circleftp") {
      return minimalDetails(item, "BDIX providers are only reachable from supported Bangladeshi ISP networks.");
    }
    try {
      const json = (await this.requestJson(`${CIRCLEFTP_API}/posts/${encodeURIComponent(item.id)}`, signal, this.requestTimeoutMs)) as {
        title?: string;
        name?: string;
        type?: string;
        year?: number | string;
        image?: string;
        imageSm?: string;
        metaData?: string;
        watchTime?: string;
        categories?: { name?: string }[];
        content?: unknown;
      };
      const title = String(json.title ?? json.name ?? item.title ?? "Unknown");
      const mediaType = json.type === "series" ? "series" : "movie";
      const genres = Array.isArray(json.categories)
        ? json.categories.map((c) => String(c.name ?? "")).filter(Boolean)
        : [];
      const seasons = seasonList(json.content, mediaType);
      return {
        provider: "bdix_circleftp",
        id: item.id,
        title,
        mediaType,
        year: yearOf(json.year) ?? item.year,
        description: String(json.metaData ?? item.extra?.["description"] ?? ""),
        duration: String(json.watchTime ?? ""),
        genres,
        posterUrl: posterUrlOf(json),
        seasons,
      };
    } catch {
      return minimalDetails(item, "BDIX providers are only reachable from supported Bangladeshi ISP networks.");
    }
  }

  /** Releases for an item. Never throws; [] on any failure. */
  async releases(
    item: StreamCatalogItem,
    season: number,
    episode: number,
    signal?: AbortSignal,
  ): Promise<{ releases: StreamRelease[]; subtitles: StreamSubtitleOption[] }> {
    if (item.provider !== "bdix_circleftp") return { releases: [], subtitles: [] };
    try {
      const json = (await this.requestJson(`${CIRCLEFTP_API}/posts/${encodeURIComponent(item.id)}`, signal, this.requestTimeoutMs)) as {
        type?: string;
        quality?: string;
        content?: unknown;
      };
      const quality = String(json.quality ?? "HD");
      const isSeries = json.type === "series";
      const link = isSeries
        ? episodeLink(json.content, season, episode)
        : typeof json.content === "string" && json.content.length > 0
          ? json.content
          : null;
      if (link === null || link.length === 0) return { releases: [], subtitles: [] };
      const sizeBytes = await this.headLength(link);
      const releases: StreamRelease[] = [
        {
          provider: "CircleFTP (BDIX)",
          filename: filenameOf(link),
          quality,
          sizeBytes,
          season: isSeries && season > 0 ? season : undefined,
          episode: isSeries && episode > 0 ? episode : undefined,
          mirrors: [mirrorFor(link)],
        },
      ];
      return { releases, subtitles: [] };
    } catch {
      return { releases: [], subtitles: [] };
    }
  }

  private async requestJson(url: string, signal?: AbortSignal, timeoutMs?: number): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs ?? this.requestTimeoutMs);
    const onAbort = () => controller.abort();
    if (signal !== undefined) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    try {
      const res = await this.fetchImpl(url, {
        headers: { accept: "application/json", "user-agent": "tornedo/5.0" },
        signal: controller.signal,
        redirect: "follow",
      });
      if (!res.ok) throw new Error(`${url} -> ${res.status}`);
      return await res.json();
    } finally {
      clearTimeout(timer);
      if (signal !== undefined) signal.removeEventListener("abort", onAbort);
    }
  }

  private async headLength(link: string): Promise<number | undefined> {
    try {
      const res = await this.fetchImpl(link, { method: "HEAD", signal: AbortSignal.timeout(this.headTimeoutMs) });
      if (!res.ok) return undefined;
      const raw = res.headers.get("content-length");
      if (raw === null) return undefined;
      const size = Number(raw);
      return Number.isFinite(size) && size > 0 ? size : undefined;
    } catch {
      return undefined;
    }
  }
}

function postToCatalog(post: CircleFtpPost): StreamCatalogItem {
  const id = String(post.id ?? "");
  const poster = posterUrlOf(post);
  return {
    provider: "bdix_circleftp",
    id,
    title: String(post.title ?? post.name ?? "Unknown"),
    mediaType: post.type === "series" ? "series" : "movie",
    year: yearOf(post.year),
    posterUrl: poster,
  };
}

function posterUrlOf(post: { image?: string; imageSm?: string }): string | undefined {
  const filename = post.imageSm ? post.imageSm : post.image;
  if (filename === undefined || filename.length === 0) return undefined;
  return `${CIRCLEFTP_UPLOADS}/${filename}`;
}

function yearOf(value: number | string | undefined): string | undefined {
  if (value === undefined) return undefined;
  return String(value);
}

function minimalDetails(item: StreamCatalogItem, note: string): StreamDetails {
  return {
    provider: item.provider,
    id: item.id,
    title: item.title,
    mediaType: item.mediaType,
    year: item.year,
    description: String(item.extra?.["description"] ?? "") + (String(item.extra?.["description"] ?? "").length > 0 ? " " : "") + note,
    genres: [],
    posterUrl: item.posterUrl,
    seasons: [],
  };
}

/** Build the season/episode skeleton from a series `content` array. */
function seasonList(content: unknown, mediaType: string): StreamSeason[] {
  if (mediaType !== "series" || !Array.isArray(content)) return [];
  const seasons: StreamSeason[] = [];
  for (let s = 0; s < content.length; s++) {
    const block = content[s] as { episodes?: { title?: string }[] } | undefined;
    const episodes = Array.isArray(block?.episodes)
      ? block.episodes.map((ep, i) => ({
          season: s + 1,
          number: i + 1,
          title: ep.title !== undefined ? String(ep.title) : undefined,
        }))
      : [];
    seasons.push({ number: s + 1, episodes });
  }
  return seasons;
}

/** Pull the direct playable link for a series season/episode. */
function episodeLink(content: unknown, season: number, episode: number): string | null {
  if (!Array.isArray(content) || season < 1 || episode < 1) return null;
  const block = content[season - 1] as { episodes?: { link?: string }[] } | undefined;
  const link = block?.episodes?.[episode - 1]?.link;
  return typeof link === "string" && link.length > 0 ? link : null;
}

function filenameOf(link: string): string {
  const tail = link
    .split("/")
    .pop()
    ?.replace(/%20/g, " ")
    .replace(/%28/g, "(")
    .replace(/%29/g, ")")
    .replace(/%5B/g, "[")
    .replace(/%5D/g, "]");
  return tail !== undefined && tail.length > 0 ? tail : "Video File";
}

function mirrorFor(link: string): StreamMirror {
  return {
    label: "CircleFTP",
    resolverUrl: link,
    headers: {},
    directFile: /\.(mp4|mkv|webm|m3u8|mp3|ts|avi|mov)(\?|#|$)/i.test(link),
  };
}