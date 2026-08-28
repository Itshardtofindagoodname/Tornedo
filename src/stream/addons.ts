/**
 * Stremio-style "addons" provider (Cinemeta by default, user-installed via the
 * addons config file). Implements the manifest / catalog / meta / stream
 * endpoints and converts results into the normalized streaming models.
 *
 * Torrent (infoHash-only) streams are ignored in Watch mode — we hand only
 * HTTP playable streams to the downstream pipeline.
 */
import { canonicalQuery } from "./crypto.js";
import { detectQuality, parseSeasonEpisode } from "./fourkhdhub.js";
import {
  StreamCatalogItem,
  StreamDetails,
  StreamMediaType,
  StreamError,
  StreamRelease,
  StreamSubtitleOption,
} from "./models.js";

const DEFAULT_CINEMETA = "https://v3-cinemeta.strem.io";
const DEFAULT_KITSU = "https://anime-kitsu.strem.fun";

const DEFAULT_ADDONS: InstalledAddon[] = [
  { baseUrl: DEFAULT_CINEMETA, transportUrl: DEFAULT_CINEMETA, addonId: "cinemeta" },
  { baseUrl: DEFAULT_KITSU, transportUrl: DEFAULT_KITSU, addonId: "kitsu" },
];

type AddonMetaType = "movie" | "series" | "tv" | "anime" | "other";

// Reference probe order for `/meta/{type}/{id}.json`; series/tv/anime metas are
// returned as soon as one answers, movie-shaped metas are a best-effort fallback.
const ADDON_META_TYPES: AddonMetaType[] = ["series", "tv", "anime", "movie", "other"];

export interface InstalledAddon {
  baseUrl: string;
  transportUrl: string;
  addonId: string | null;
}

export interface AddonManifest {
  id?: string;
  name?: string;
  version?: string;
  description?: string;
  logo?: string;
  resources?: string[];
  types?: string[];
  catalogs?: { type?: string; id?: string; name?: string }[];
}

export interface AddonCatalogItem {
  id?: string;
  type?: string;
  name?: string;
  poster?: string;
  year?: string;
  imdbRating?: string;
  description?: string;
  genres?: string[];
}

export interface AddonMetaItem extends AddonCatalogItem {
  director?: string[];
  cast?: string[];
  runtime?: string;
  releaseInfo?: string;
  genres?: string[];
  episodes?: { id?: string; name?: string; season?: number; number?: number; overview?: string }[];
}

export interface AddonStream {
  url?: string;
  infoHash?: string;
  fileIdx?: number;
  title?: string;
  name?: string;
  behaviorHints?: { notWebReady?: boolean };
  subtitles?: { id?: string; url?: string; lang?: string }[];
}

export interface AddonCatalogPage {
  metas?: AddonCatalogItem[];
}

export interface AddonMetaPage {
  meta?: AddonMetaItem;
}

export interface AddonStreamPage {
  streams?: AddonStream[];
}

function fetchJson(
  url: string,
  signal?: AbortSignal,
  timeoutMs = 15000,
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const onAbort = () => controller.abort();
    if (signal !== undefined) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    fetch(url, {
      headers: { accept: "application/json", "user-agent": "tornedo/5.0" },
      signal: controller.signal,
      redirect: "follow",
    })
      .then(async (res) => {
        if (!res.ok) throw new StreamError("network", `${url} -> ${res.status}`);
        const text = await res.text();
        try {
          resolve(JSON.parse(text));
        } catch {
          throw new StreamError("parsing", `${url} -> not JSON`);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted && signal?.aborted) reject(err);
        else reject(err);
      })
      .finally(() => {
        clearTimeout(timer);
        if (signal !== undefined) signal.removeEventListener("abort", onAbort);
      });
  });
}

export class FourKHDAddonsClient {
  readonly provider = "addons" as const;
  readonly addons: InstalledAddon[];

  constructor(addonList: InstalledAddon[]) {
    this.addons = addonList.length > 0 ? addonList : DEFAULT_ADDONS;
  }

  /** Per-addon manifest capability memo (mirrors the reference's manifest cache). */
  private readonly streamCapability = new Map<string, Promise<boolean>>();

  get name(): string {
    return this.addons[0]?.addonId ?? "addons";
  }

  private named(addon: InstalledAddon): string {
    return addon.addonId ?? hostOf(addon.baseUrl) ?? "addon";
  }

  private async manifestOf(addon: InstalledAddon, signal?: AbortSignal): Promise<AddonManifest | null> {
    const url = `${stripSlash(addon.baseUrl)}/manifest.json`;
    try {
      const raw = await fetchJson(url, signal);
      return raw as AddonManifest;
    } catch {
      return null;
    }
  }

  /** Whether an addon exposes the `stream` resource — Cinemeta does not, so its
   *  `/stream/...` endpoints 404 and must never be called. */
  providesStream(addon: InstalledAddon): Promise<boolean> {
    const key = stripSlash(addon.baseUrl);
    let cached = this.streamCapability.get(key);
    if (cached === undefined) {
      cached = this.manifestOf(addon).then((m) => m !== null && (m.resources ?? []).includes("stream"));
      this.streamCapability.set(key, cached);
    }
    return cached;
  }

  /** True when at least one installed addon can serve streams. */
  async hasStreamProviders(): Promise<boolean> {
    const results = await Promise.all(this.addons.map((a) => this.providesStream(a)));
    return results.some(Boolean);
  }

  /**
   * Inspect a candidate addon before installing (used by `tornedo addons`):
   * returns its manifest and whether it advertises the `stream` resource.
   */
  async describe(
    baseUrl: string,
    signal?: AbortSignal,
  ): Promise<{ manifest: AddonManifest | null; streams: boolean }> {
    const entry: InstalledAddon = { baseUrl, transportUrl: baseUrl, addonId: null };
    const manifest = await this.manifestOf(entry, signal);
    return { manifest, streams: manifest !== null && (manifest.resources ?? []).includes("stream") };
  }

  async catalogSearch(
    query: string,
    signal?: AbortSignal,
  ): Promise<{ items: StreamCatalogItem[]; errors: { addon: string; message: string }[] }> {
    const items: StreamCatalogItem[] = [];
    const errors: { addon: string; message: string }[] = [];
    await Promise.all(
      this.addons.map(async (addon, i) => {
        const tag = this.named(addon);
        void i;
        try {
          const manifest = await this.manifestOf(addon, signal);
          if (manifest === null) throw new StreamError("unavailable", `no manifest for ${tag}`);
          const types = (manifest.types ?? ["movie", "series"]).filter(
            (t) => t === "movie" || t === "series",
          );
          if (types.length === 0) return;
          for (const type of types) {
            const catalogs =
              (manifest.catalogs?.filter((c) => c.type === type) ?? []).length > 0
                ? (manifest.catalogs?.filter((c) => c.type === type) ?? [])
                : [{ type, id: "top" }];
            const catalogIds = catalogs.map((c) => c.id).filter((id) => typeof id === "string");
            if (catalogIds.length === 0) catalogIds.push("top");
            const url = `${stripSlash(addon.baseUrl)}/catalog/${type}/${encodeURIComponent(catalogIds[0]!)}/search=${encodeURIComponent(query)}.json`;
            const raw = (await fetchJson(url, signal)) as AddonCatalogPage;
            for (const meta of raw.metas ?? []) {
              if (meta.id === undefined || meta.name === undefined) continue;
              items.push({
                provider: "addons",
                // Prefix with addon id to keep identity while merging.
                id: `${tag}:${resolveAddonId(meta.id, tag)}`,
                title: meta.name,
                mediaType: type === "movie" ? "movie" : "series",
                year: meta.year,
                posterUrl: meta.poster !== undefined && meta.poster.length > 0 ? meta.poster : undefined,
                extra: { addon: tag, baseUrl: addon.baseUrl, rawId: meta.id, imdb: meta.id },
              });
            }
          }
        } catch (err) {
          errors.push({ addon: tag, message: messageOf(err) });
        }
      }),
    );
    return { items, errors };
  }

  /**
   * Resolve details for an addon item. Mirrors the reference MovieBox-Tui
   * logic: instead of trusting a single type guess (which mis-classifies
   * imdb ids whose string form carries an addon prefix), we probe several
   * Stremio types — returning a series/tv/anime meta immediately, keeping the
   * first movie-shaped meta as a best-effort fallback, and only erroring when
   * every type comes back empty.
   */
  async getMeta(
    addon: InstalledAddon,
    itemId: string,
    mediaType?: string,
    signal?: AbortSignal,
  ): Promise<StreamDetails> {
    const rawId = rawAddonId(itemId);
    const hint: AddonMetaType = mediaType === "series" ? "series" : "movie";
    const order = [hint, ...ADDON_META_TYPES.filter((t) => t !== hint)];
    let best: AddonMetaItem | null = null;
    let bestType: AddonMetaType = "movie";
    for (const type of order) {
      let raw: AddonMetaPage;
      try {
        raw = (await fetchJson(
          `${stripSlash(addon.baseUrl)}/meta/${type}/${encodeURIComponent(rawId)}.json`,
          signal,
        )) as AddonMetaPage;
      } catch {
        continue; // wrong type or outage → try the next one
      }
      if (raw.meta === undefined) continue;
      const seriesLike = type === "series" || type === "tv" || type === "anime";
      if (best === null) {
        best = raw.meta;
        bestType = type;
      }
      if (seriesLike || (raw.meta.episodes?.length ?? 0) > 0) {
        return this.toDetails(addon, itemId, raw.meta, type, rawId);
      }
    }
    if (best !== null) return this.toDetails(addon, itemId, best, bestType, rawId);
    throw new StreamError("notFound", `addon meta empty for ${itemId}`);
  }

  private toDetails(
    addon: InstalledAddon,
    itemId: string,
    meta: AddonMetaItem,
    type: AddonMetaType,
    rawId: string,
  ): StreamDetails {
    const tag = this.named(addon);
    const mediaType: StreamMediaType = type === "series" || type === "tv" || type === "anime" ? "series" : "movie";
    return {
      provider: "addons",
      id: itemId,
      title: meta.name ?? rawId,
      mediaType,
      year: meta.year ?? meta.releaseInfo,
      description: meta.description,
      imdbRating: meta.imdbRating !== undefined ? String(meta.imdbRating) : undefined,
      director: meta.director?.join(", "),
      stars: meta.cast?.join(", "),
      duration: meta.runtime,
      genres: meta.genres ?? [],
      posterUrl: meta.poster !== undefined ? meta.poster : undefined,
      seasons: meta.episodes !== undefined ? groupEpisodes(meta.episodes) : [],
      tagline: tag === "cinemeta" ? `Cinemeta (${tag})` : undefined,
    };
  }

  async getStreams(
    addon: InstalledAddon,
    itemId: string,
    mediaType: string,
    season: number,
    episode: number,
    signal?: AbortSignal,
  ): Promise<{ releases: StreamRelease[]; subtitles: StreamSubtitleOption[]; blocked: string[] }> {
    if (!(await this.providesStream(addon))) {
      return { releases: [], subtitles: [], blocked: [] };
    }
    const rawId = rawAddonId(itemId);
    const type = mediaType === "series" ? "series" : "movie";
    const seKey = type === "series" && season > 0 ? `:${season}:${episode}` : "";
    const url = `${stripSlash(addon.baseUrl)}/stream/${type}/${encodeURIComponent(rawId)}${seKey}.json`;
    let raw: AddonStreamPage;
    try {
      raw = (await fetchJson(url, signal)) as AddonStreamPage;
    } catch {
      // Reference behavior: a failed stream fetch counts as no streams at all.
      return { releases: [], subtitles: [], blocked: [] };
    }
    const tag = this.named(addon);

    const releases: StreamRelease[] = [];
    const subtitles: StreamSubtitleOption[] = [];
    for (const stream of raw.streams ?? []) {
      if (stream.infoHash !== undefined && stream.url === undefined) continue;
      const resolved = firstUrl(stream);
      if (resolved === undefined) continue;
      const title = stream.title ?? stream.name ?? "";
      const parsed = parseStreamTitle(title);
      if (type === "series" && season > 0) {
        const [se, ep] = parseSeasonEpisode(title);
        if (se !== undefined && se !== season) continue;
        if (se === undefined && episode > 0 && ep !== undefined && ep !== episode) continue;
      }
      releases.push({
        provider: tag,
        filename: parsed.title || title || resolved,
        quality: parsed.quality ?? detectQuality(title),
        codec: parsed.codec,
        language: parsed.language,
        sizeBytes: parsed.sizeBytes,
        season,
        episode,
        mirrors: [
          {
            label: tag,
            resolverUrl: resolved,
            headers: { "user-agent": "tornedo/5.0", referer: stripSlash(addon.baseUrl) },
            directFile: /\.(mp4|mkv|webm|m3u8|mp3|ts|avi|mov)(\?|#|$)/i.test(resolved),
          },
        ],
      });
      for (const sub of stream.subtitles ?? []) {
        if (sub.url === undefined) continue;
        if (sub.url.startsWith("http")) {
          subtitles.push({
            name: sub.lang ?? sub.id ?? "subtitle",
            url: sub.url,
          });
        }
      }
    }
    // Mirror the reference's aggregator: when an addon answered with streams
    // but every one was a raw torrent (infoHash without an HTTP url), report it
    // as "blocked" so the UI can warn instead of silently showing nothing.
    const blocked = (raw.streams?.length ?? 0) > 0 && releases.length === 0 ? [tag] : [];
    return { releases, subtitles, blocked };
  }

  /** Raw catalog fetch for the home feed (featured rows). */
  async catalog(
    type: "movie" | "series",
    catalogId: string,
    signal?: AbortSignal,
  ): Promise<StreamCatalogItem[]> {
    const url = `${stripSlash(this.addons[0]!.baseUrl)}/catalog/${type}/${encodeURIComponent(catalogId)}.json`;
    const raw = (await fetchJson(url, signal)) as AddonCatalogPage;
    const tag = this.named(this.addons[0]!);
    return (raw.metas ?? [])
      .filter((meta) => meta.id !== undefined && meta.name !== undefined)
      .map((meta) => ({
        provider: "addons" as const,
        id: `${tag}:${resolveAddonId(meta.id!, tag)}`,
        title: meta.name!,
        mediaType: type as StreamMediaType,
        year: meta.year,
        posterUrl: meta.poster,
      }));
  }
}

/** Query params helper kept for parity with other clients (unused yet). */
export function addonUrl(base: string, path: string, pairs: [string, string][]): string {
  const query = canonicalQuery(pairs);
  return `${stripSlash(base)}${path}${query.length > 0 ? `?${query}` : ""}`;
}

function stripSlash(base: string): string {
  return base.replace(/\/+$/, "");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

function resolveAddonId(raw: string, tag: string): string {
  if (raw.startsWith("tt")) return `${tag}:${raw}`;
  return raw;
}

function rawAddonId(id: string): string {
  // "tt12345" or "cinemeta:tt12345" → "tt12345"; for series "cinemeta:tt12345:season" variants.
  const parts = id.split(":");
  while (parts.length > 1 && !parts[parts.length - 1]!.startsWith("tt")) parts.pop();
  return parts[parts.length - 1]!;
}

function firstUrl(stream: AddonStream): string | undefined {
  if (stream.url !== undefined && stream.url.length > 0) return stream.url;
  return undefined;
}

function groupEpisodes(episodes: { season?: number; number?: number; name?: string }[]): StreamDetails["seasons"] {
  const map = new Map<number, StreamDetails["seasons"][number]["episodes"]>();
  for (const ep of episodes) {
    const s = ep.season ?? 1;
    const n = ep.number ?? 1;
    if (!map.has(s)) map.set(s, []);
    const list = map.get(s)!;
    if (!list.some((e) => e.number === n && e.season === s)) {
      list.push({ season: s, number: n, title: ep.name });
    }
  }
  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([number, episodes]) => ({
      number,
      episodes: [...episodes].sort((a, b) => a.number - b.number),
    }));
}

export function parseStreamTitle(title: string): {
  title: string;
  quality?: string;
  codec?: string;
  language?: string;
  sizeBytes?: number;
} {
  let quality: string | undefined;
  const qualRe = /\b(2160p|4k|1080p|720p|480p)\b/i;
  const match = qualRe.exec(title);
  if (match !== null) quality = match[1]!.toLowerCase();
  let codec: string | undefined;
  if (/\bx265\b|\bhevc\b/i.test(title)) codec = "H.265";
  else if (/\bx264\b/i.test(title)) codec = "H.264";
  let sizeBytes: number | undefined;
  const sizeRe = /\[?\s*(\d+(?:\.\d+)?)\s*(GB|MB|KB)\s*\]?/i;
  const sm = sizeRe.exec(title);
  if (sm !== null) {
    const mult = sm[2]!.toUpperCase() === "GB" ? 1024 ** 3 : sm[2]!.toUpperCase() === "MB" ? 1024 ** 2 : 1024;
    sizeBytes = Math.round(Number(sm[1]) * mult);
  }
  const cleaned = title
    .replace(/\s*(\[[^\]]*\]|[()]\d*[pP]|\d{3,4}p)/g, " ")
    .replace(/👑/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return { title: cleaned.length > 0 ? cleaned : title, quality, codec, sizeBytes };
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}