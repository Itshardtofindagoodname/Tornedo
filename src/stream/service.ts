/**
 * StreamService — the streaming side of Tornedo's "Watch" mode. Owns the
 * provider clients (MovieBox, 4KHDHub, addons, BDIX) and exposes normalized
 * catalog / detail / release / playback operations to the UI, plus named
 * identity caches and the poster store. Provider output is always adapted to
 * the models in models.ts so the terminal UI never sees provider specifics.
 */
import { InstalledAddon, FourKHDAddonsClient, AddonMetaItem, AddonCatalogItem } from "./addons.js";
import { MovieBoxClient, MbResource, MbSubject } from "./moviebox.js";
import {
  FourKHDHubClient,
  detectCodec,
  detectLanguage,
  detectQuality,
  parseSize,
} from "./fourkhdhub.js";
import { MemoCache } from "./store.js";
import { PosterStore } from "./poster.js";
import { channelToCatalog, loadPlaylistChannels, searchChannels, TvPlaylist } from "./tv.js";
import { BdixClient } from "./bdix.js";
import { PlaybackSource, StreamCatalogItem, StreamDetails, StreamError, StreamMirror, StreamProviderId, StreamRelease, StreamSeason, StreamSubtitleOption, TvChannel } from "./models.js";

export interface StreamServiceOptions {
  cacheDir: string;
  fourkhdhubUrl?: string | null;
  bdixEnabled?: boolean;
  /**
   * Torrent-source search (Watch mode "Torrent" provider). Returns catalog
   * items for the federated torrent engine; wired by the application layer.
   * Without it the "torrent" provider contributes nothing.
   */
  torrentSearch?: (query: string, signal?: AbortSignal) => Promise<StreamCatalogItem[]>;
  /**
   * Torrent-stream playback resolver. Receives the chosen release/mirror and
   * returns a playable PlaybackSource (e.g. a local HTTP server streaming the
   * torrent). Without it resolving a torrent item fails gracefully.
   */
  torrentStreamer?: (
    release: StreamRelease,
    mirror: StreamMirror,
    signal?: AbortSignal,
  ) => Promise<PlaybackSource>;
  /** Overrides for internal dimension tuning (mostly tests). */
  resourcePageSize?: number;
}

export interface HomeSection {
  name: string;
  items: StreamCatalogItem[];
}

const MOVIEBOX_MEDIA_TYPES = new Map<string, "movie" | "series">([
  ["1", "movie"],
  ["2", "series"],
]);

export class StreamService {
  readonly providers = {
    moviebox: new MovieBoxClient(),
    fourkhdhub: new FourKHDHubClient(),
  };
  private addons: FourKHDAddonsClient;
  private readonly memo = new MemoCache(15 * 60 * 1000);
  private readonly posterStore: PosterStore;
  private readonly bdix: BdixClient;
  private bdixEnabled: boolean;
  private readonly resourcePageSize: number;
  private readonly cacheDir: string;
  private readonly torrentSearch?: (query: string, signal?: AbortSignal) => Promise<StreamCatalogItem[]>;
  private readonly torrentStreamer?: (
    release: StreamRelease,
    mirror: StreamMirror,
    signal?: AbortSignal,
  ) => Promise<PlaybackSource>;
  private tvPlaylists: TvPlaylist[] = [];

  constructor(opts: StreamServiceOptions) {
    this.cacheDir = opts.cacheDir;
    this.posterStore = new PosterStore(`${opts.cacheDir}/posters.json`);
    this.bdixEnabled = opts.bdixEnabled ?? false;
    this.bdix = new BdixClient();
    this.resourcePageSize = opts.resourcePageSize ?? 20;
    this.torrentSearch = opts.torrentSearch;
    this.torrentStreamer = opts.torrentStreamer;
    this.addons = new FourKHDAddonsClient([]);
    if (opts.fourkhdhubUrl !== undefined && opts.fourkhdhubUrl !== null && opts.fourkhdhubUrl.length > 0) {
      this.providers.fourkhdhub = new FourKHDHubClient(opts.fourkhdhubUrl);
    }
  }

  get posters(): PosterStore {
    return this.posterStore;
  }

  /** Runtime BDIX toggle (kept in sync with config). */
  setBdixEnabled(enabled: boolean): void {
    this.bdixEnabled = enabled;
  }

  get bdixActive(): boolean {
    return this.bdixEnabled;
  }

  setAddons(addonList: InstalledAddon[]): void {
    this.addons = new FourKHDAddonsClient(addonList ?? []);
  }

  get activeAddons(): FourKHDAddonsClient {
    return this.addons;
  }

  /** Configure the live-TV playlists used by searchTv / searchAll. */
  setTvPlaylists(list: TvPlaylist[]): void {
    this.tvPlaylists = [...list];
  }

  get tvPlaylistCount(): number {
    return this.tvPlaylists.length;
  }

  /** Live-TV channel search across all configured playlists (empty query = browse). */
  async searchTv(query: string, signal?: AbortSignal): Promise<StreamCatalogItem[]> {
    if (this.tvPlaylists.length === 0) return [];
    const loads = await Promise.all(
      this.tvPlaylists.map((p): Promise<TvChannel[]> => loadPlaylistChannels(p, signal).catch(() => [])),
    );
    const items: StreamCatalogItem[] = [];
    for (let i = 0; i < this.tvPlaylists.length; i++) {
      const playlist = this.tvPlaylists[i]!;
      const channels = loads[i] ?? [];
      for (const ch of searchChannels(channels, query)) {
        items.push(channelToCatalog(ch, playlist));
      }
    }
    return items;
  }

  /* ------------------------------------------------------------------ */
  /* Search / browse                                                      */
  /* ------------------------------------------------------------------ */

  async searchAll(
    query: string,
    signal?: AbortSignal,
  ): Promise<{ items: StreamCatalogItem[]; errors: { provider: string; message: string }[] }> {
    const results = await Promise.allSettled([
      this.searchMovieBox(query, signal),
      this.searchFourKHD(query, signal),
      this.addons.catalogSearch(query, signal),
      this.searchTv(query, signal),
      this.bdixEnabled ? this.searchBdix(query, signal) : Promise.resolve([]),
      this.torrentSearch !== undefined ? this.torrentSearch(query, signal) : Promise.resolve([]),
    ]);

    const items: StreamCatalogItem[] = [];
    const errors: { provider: string; message: string }[] = [];
    const seen = new Set<string>();

    const push = (candidate: StreamCatalogItem) => {
      const key =
        candidate.provider === "tv"
          ? `tv:${candidate.id.toLowerCase()}`
          : `${candidate.provider}:${candidate.title.toLowerCase()}:${candidate.year ?? ""}`;
      if (seen.has(key)) return;
      seen.add(key);
      items.push(candidate);
    };
    const collect = <T>(settled: PromiseSettledResult<T>, provider: string, into: (value: T) => void) => {
      if (settled.status === "fulfilled") into(settled.value);
      else errors.push({ provider, message: messageOf(settled.reason) });
    };

    collect(results[0]!, "moviebox", (r: StreamCatalogItem[]) => r.forEach(push));
    collect(results[1]!, "fourkhdhub", (r: StreamCatalogItem[]) => r.forEach(push));
    collect(results[3]!, "tv", (r: StreamCatalogItem[]) => r.forEach(push));
    collect(results[4]!, "bdix", (r: StreamCatalogItem[]) => r.forEach(push));
    collect(results[5]!, "torrent", (r: StreamCatalogItem[]) => r.forEach(push));
    const addonSearch = results[2]!;
    if (addonSearch.status === "fulfilled") {
      addonSearch.value.items.forEach(push);
      addonSearch.value.errors.forEach((e) => errors.push({ provider: e.addon, message: e.message }));
    } else {
      errors.push({ provider: "addons", message: messageOf(addonSearch.reason) });
    }
    return { items, errors };
  }

  private async searchMovieBox(query: string, signal?: AbortSignal): Promise<StreamCatalogItem[]> {
    const page = await this.providers.moviebox.search(query, 1, signal);
    return (page.list ?? []).filter((s) => s.title !== undefined).map(adaptMovieBoxCatalog);
  }

  async searchFourKHD(query: string, signal?: AbortSignal): Promise<StreamCatalogItem[]> {
    return this.providers.fourkhdhub.search(query, signal);
  }

  private async searchBdix(query: string, signal?: AbortSignal): Promise<StreamCatalogItem[]> {
    // BDIX is purely additive: any failure is a graceful empty result.
    try {
      return await this.bdix.search(query, signal);
    } catch {
      return [];
    }
  }

  async homeSections(page = 1, signal?: AbortSignal): Promise<HomeSection[]> {
    const sections: HomeSection[] = [];
    // Well-formed rows come from addons catalogs.
    const cinemetaMovie = await this.catalogRows("movie", "top", signal).catch(() => []);
    const cinemetaSeries = await this.catalogRows("series", "top", signal).catch(() => []);
    if (cinemetaMovie.length > 0) sections.push({ name: "Trending · Movies (Cinemeta)", items: cinemetaMovie });
    if (cinemetaSeries.length > 0) sections.push({ name: "Trending · Series (Cinemeta)", items: cinemetaSeries });

    // MovieBox featured rows (tolerant: ignore shapes we don't recognize).
    try {
      const raw = await this.providers.moviebox.getHomepage(0, page, signal);
      const parsed = parseMovieBoxHome(raw);
      for (const row of parsed) {
        if (row.items.length === 0) continue;
        sections.push({ name: row.name, items: row.items });
      }
    } catch {
      // MovieBox homepage is best-effort.
    }
    return sections;
  }

  private async catalogRows(
    type: "movie" | "series",
    catalogId: string,
    signal?: AbortSignal,
  ): Promise<StreamCatalogItem[]> {
    return this.addons.catalog(type, catalogId, signal);
  }

  /* ------------------------------------------------------------------ */
  /* Details                                                              */
  /* ------------------------------------------------------------------ */

  async details(item: StreamCatalogItem, signal?: AbortSignal): Promise<StreamDetails> {
    const key = `details:${item.provider}:${item.id}`;
    return this.memo.wrap(key, () => this.fetchDetails(item, signal, key));
  }

  private async fetchDetails(
    item: StreamCatalogItem,
    signal: AbortSignal | undefined,
    key: string,
  ): Promise<StreamDetails> {
    switch (item.provider) {
      case "moviebox": {
        const raw = await this.providers.moviebox.getDetails(item.id, signal);
        const subject = raw["subject"] as MbSubject | undefined;
        if (subject === undefined) {
          throw new StreamError("parsing", "moviebox details missing subject", { provider: "moviebox" });
        }
        return this.adaptMovieBoxDetails(subject, signal);
      }
      case "fourkhdhub":
        return this.providers.fourkhdhub.getDetails(item.id, signal);
      case "addons": {
        const addon = this.addonForItem(item);
        return this.addons.getMeta(addon, item.id, item.mediaType, signal);
      }
      case "bdix_circleftp":
      case "bdix_dhakaflix":
        return this.bdix.details(item, signal);
      case "torrent": {
        const source = String(item.extra?.["source"] ?? "Torrent");
        const seeders = item.extra?.["seeders"];
        const size = item.extra?.["size"];
        const files = item.extra?.["files"];
        const parts = [source];
        if (typeof seeders === "number") parts.push(`${seeders} seeds`);
        if (typeof size === "number") parts.push(humanSize(size));
        if (typeof files === "number") parts.push(`${files} files`);
        return {
          provider: "torrent",
          id: item.id,
          title: item.title,
          mediaType: item.mediaType,
          year: item.year,
          description: `A torrent for this title, ranked from the enabled torrent sources. ${parts.join(" · ")}. Streaming starts when you play it.`,
          genres: [],
          posterUrl: item.posterUrl,
          seasons: [],
        };
      }
      case "tv": {
        const group = String(item.extra?.["group"] ?? "");
        const logo = String(item.extra?.["logo"] ?? "");
        return {
          provider: "tv",
          id: item.id,
          title: item.title,
          mediaType: "tv",
          description: group.length > 0 ? `${group} · live TV channel` : "Live TV channel",
          genres: group.length > 0 ? [group] : [],
          posterUrl: logo.length > 0 ? logo : undefined,
          seasons: [],
        };
      }
      default:
        throw new StreamError("unavailable", `no details adapter for ${item.provider}`);
    }
  }

  private async adaptMovieBoxDetails(subject: MbSubject, signal?: AbortSignal): Promise<StreamDetails> {
    const stype = String(subject.subjectType ?? subject.stype ?? "1");
    const mediaType = MOVIEBOX_MEDIA_TYPES.get(stype) ?? "movie";
    const seasons: StreamSeason[] = [];
    if (mediaType === "series") {
      try {
        const info = await this.providers.moviebox.getSeasonInfo(String(subject.subjectId ?? ""), signal);
        for (const block of info.seasons ?? []) {
          const se = Number(block.se ?? 1);
          const maxEp = Number(block.maxEp ?? 0);
          const eps = block.episodeNumbers ?? [];
          const episodes = Array.from({ length: maxEp }, (_, i) => {
            const epNo = i + 1;
            const title =
              typeof Number(eps[0]) === "number" && eps.length === maxEp
                ? (String(eps[i]) === String(epNo) ? undefined : undefined)
                : undefined;
            return { season: se, number: epNo, title };
          }).filter((ep) => ep.number <= maxEp);
          seasons.push({ number: se, episodes });
        }
      } catch {
        // Season info is best-effort; fall back to subject season/maxEp.
        const se = Number(subject.season ?? 1);
        const maxEp = Number(subject.maxEp ?? 0);
        if (maxEp > 0) {
          seasons.push({ number: se, episodes: Array.from({ length: maxEp }, (_, i) => ({ season: se, number: i + 1 })) });
        }
      }
    }
    const genres = Array.isArray(subject.genre)
      ? (subject.genre as string[])
      : typeof subject.genre === "string"
        ? (subject.genre as string).split(",").map((g) => g.trim()).filter(Boolean)
        : [];
    return {
      provider: "moviebox",
      id: String(subject.subjectId ?? ""),
      title: subject.title ?? "",
      mediaType,
      year: yearFromDate(subject.releaseDate),
      description: subject.description ?? subject.intro,
      tagline: subject.tagline,
      imdbRating: subject.imdbRatingValue !== undefined ? String(subject.imdbRatingValue) : undefined,
      director: subject.director,
      stars: subject.stars,
      prints: subject.prints,
      audios: subject.audios,
      duration: subject.duration,
      genres,
      posterUrl: posterUrlOf(subject.cover),
      seasons,
    };
  }

  private addonForItem(item: StreamCatalogItem): InstalledAddon {
    const baseUrl = String(item.extra?.["baseUrl"] ?? "");
    if (baseUrl.length === 0) {
      return { baseUrl, transportUrl: "", addonId: String(item.extra?.["addon"] ?? "cinemeta") };
    }
    return {
      baseUrl,
      transportUrl: baseUrl,
      addonId: String(item.extra?.["addon"] ?? ""),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Releases / streams                                                   */
  /* ------------------------------------------------------------------ */

  async releaseSources(
    item: StreamCatalogItem,
    season: number,
    episode: number,
    resolution: string,
    signal?: AbortSignal,
  ): Promise<{ releases: StreamRelease[]; subtitles: StreamSubtitleOption[]; resolutions: string[]; notice?: string }> {
    const key = `releases:${item.provider}:${item.id}:${season}:${episode}:${resolution}`;
    return this.memo.wrap(
      key,
      async () => {
        switch (item.provider) {
          case "moviebox": {
            const page = await this.providers.moviebox.getResources(
              item.id,
              season,
              episode,
              resolution,
              1,
              this.resourcePageSize,
              signal,
            );
            const resolutions = (page.collectionResolutions ?? [])
              .map((r) => String(r.resolution ?? ""))
              .filter(Boolean);
            const releases = (page.list ?? [])
              .filter((r) => r.resourceId !== undefined || r.resourceLink !== undefined)
              .map((r) => this.adaptMovieBoxRelease(r, item.id));
            return { releases, subtitles: [], resolutions };
          }
          case "fourkhdhub": {
            const releases = await this.providers.fourkhdhub.getReleases(item.id, season, episode, signal);
            const resolutions = [...new Set(releases.map((r) => r.quality).filter(Boolean).map((q) => q!))];
            return { releases, subtitles: [], resolutions };
          }
          case "addons": {
            const addon = this.addonForItem(item);
            const page = await this.addons.getStreams(addon, item.id, item.mediaType, season, episode, signal);
            if (page.releases.length === 0) {
              // Mirror MovieBox-Tui: watchable streams come from the native
              // providers (MovieBox / 4KHDHub). When the addon has nothing
              // HTTP-playable, look the same title up there so playback works
              // without the user installing anything extra.
              const native = await this.nativeStreamsFor(item, season, episode, resolution, signal);
              if (native.releases.length > 0) {
                return {
                  releases: native.releases,
                  subtitles: native.subtitles,
                  resolutions: native.resolutions,
                  notice:
                    page.blocked.length > 0
                      ? `Warning: ${page.blocked.join(", ")} streams are raw torrents only. Showing ${native.source} streams instead.`
                      : undefined,
                };
              }
            }
            let notice: string | undefined;
            if (page.blocked.length > 0) {
              notice = `Warning: ${page.blocked.join(", ")} streams blocked (raw torrents). Only HTTP streams are supported.`;
            } else if (page.releases.length === 0) {
              const hasStreamProviders = await this.addons.hasStreamProviders();
              notice = hasStreamProviders
                ? "No HTTP streams found from active addons for this title."
                : "No streaming addons are currently installed or enabled. Install/enable a stream provider.";
            }
            return { releases: page.releases, subtitles: page.subtitles, resolutions: [], notice };
          }
case "bdix_circleftp": {
            const result = await this.bdix.releases(item, season, episode, signal);
            if (result.releases.length === 0) {
              return {
                releases: [],
                subtitles: [],
                resolutions: [],
                notice: "BDIX streams are only reachable from supported Bangladeshi ISP networks.",
              };
            }
            return {
              releases: result.releases,
              subtitles: result.subtitles,
              resolutions: [...new Set(result.releases.map((r) => r.quality).filter(Boolean).map((q) => q!))],
            };
          }
          case "bdix_dhakaflix":
            return {
              releases: [],
              subtitles: [],
              resolutions: [],
              notice: "BDIX streams are only reachable from supported Bangladeshi ISP networks.",
            };
          case "torrent": {
            const source = String(item.extra?.["source"] ?? "torrent");
            const quality = String(item.extra?.["quality"] ?? item.extra?.["resolution"] ?? "HD");
            const magnet = String(item.extra?.["magnet"] ?? item.id);
            const size = typeof item.extra?.["size"] === "number" ? item.extra?.["size"] : undefined;
            const release: StreamRelease = {
              provider: source,
              filename: item.title,
              quality,
              sizeBytes: size,
              mirrors: [{ label: source.slice(0, 8), resolverUrl: magnet, headers: {}, directFile: false }],
            };
            return {
              releases: [release],
              subtitles: [],
              resolutions: quality.length > 0 ? [quality] : [],
            };
          }
          case "tv": {
            const streamUrl = String(item.extra?.["streamUrl"] ?? "");
            if (streamUrl.length === 0) {
              throw new StreamError("unavailable", "live TV stream has no URL", { provider: "tv" });
            }
            const group = String(item.extra?.["group"] ?? "");
            return {
              releases: [
                {
                  provider: "TV",
                  filename: item.title + (group.length > 0 ? ` [${group}]` : ""),
                  quality: "Live",
                  mirrors: [
                    {
                      label: "live",
                      resolverUrl: streamUrl,
                      headers: { "user-agent": "okhttp/3.12.1" },
                      directFile: DIRECT_MEDIA.test(streamUrl),
                    },
                  ],
                },
              ],
              subtitles: [],
              resolutions: [],
            };
          }
          default:
            throw new StreamError("unavailable", `no release source for ${item.provider}`, { provider: item.provider });
        }
      },
      10 * 60 * 1000,
    );
  }

  /**
   * Best-effort source of last resort for addon results: find the same title
   * on the native providers (MovieBox, then 4KHDHub) and reuse their streams.
   * Any provider failure is swallowed — this is strictly an enhancement, never
   * a breaking error path.
   */
  private async nativeStreamsFor(
    item: StreamCatalogItem,
    season: number,
    episode: number,
    resolution: string,
    signal?: AbortSignal,
  ): Promise<{ releases: StreamRelease[]; subtitles: StreamSubtitleOption[]; resolutions: string[]; source: string }> {
    const attempts = [
      { source: "MovieBox", run: () => this.movieBoxNative(item, season, episode, resolution, signal) },
      { source: "4KHDHub", run: () => this.fourKhdNative(item, season, episode, signal) },
    ] as const;
    for (const attempt of attempts) {
      try {
        const result = await attempt.run();
        if (result.releases.length > 0) return { ...result, source: attempt.source };
      } catch {
        // Native lookup is best-effort; move on to the next provider.
      }
    }
    return { releases: [], subtitles: [], resolutions: [], source: "" };
  }

  private async movieBoxNative(
    item: StreamCatalogItem,
    season: number,
    episode: number,
    resolution: string,
    signal?: AbortSignal,
  ): Promise<{ releases: StreamRelease[]; subtitles: StreamSubtitleOption[]; resolutions: string[] }> {
    const page = await this.providers.moviebox.search(item.title, 1, signal);
    const subject = bestSubjectMatch(page.list ?? [], item);
    if (subject === undefined || subject.subjectId === undefined) {
      return { releases: [], subtitles: [], resolutions: [] };
    }
    const id = String(subject.subjectId);
    const resources = await this.providers.moviebox.getResources(
      id,
      season,
      episode,
      resolution,
      1,
      this.resourcePageSize,
      signal,
    );
    const resolutions = (resources.collectionResolutions ?? [])
      .map((r) => String(r.resolution ?? ""))
      .filter(Boolean);
    const releases = (resources.list ?? [])
      .filter((r) => r.resourceId !== undefined || r.resourceLink !== undefined)
      .map((r) => this.adaptMovieBoxRelease(r, id));
    return { releases, subtitles: [], resolutions };
  }

  private async fourKhdNative(
    item: StreamCatalogItem,
    season: number,
    episode: number,
    signal?: AbortSignal,
  ): Promise<{ releases: StreamRelease[]; subtitles: StreamSubtitleOption[]; resolutions: string[] }> {
    const list = await this.providers.fourkhdhub.search(item.title, signal);
    const subject = bestFourKhdMatch(list, item);
    if (subject === undefined) return { releases: [], subtitles: [], resolutions: [] };
    const releases = await this.providers.fourkhdhub.getReleases(subject.id, season, episode, signal);
    const resolutions = [...new Set(releases.map((r) => r.quality).filter(Boolean).map((q) => q!))];
    return { releases, subtitles: [], resolutions };
  }

  async subtitles(
    item: StreamCatalogItem,
    resourceId: string,
    signal?: AbortSignal,
  ): Promise<StreamSubtitleOption[]> {
    if (item.provider === "moviebox") {
      const page = await this.providers.moviebox.getExtCaptions(item.id, resourceId, signal);
      return (page.list ?? []).map((c) => ({ name: c.lanName ?? "unknown", url: c.url ?? "" })).filter((s) => s.url.length > 0);
    }
    return [];
  }

  private adaptMovieBoxRelease(r: MbResource, subjectId: string): StreamRelease {
    const [se, ep] = [Number(r.season ?? 0), Number(r.episode ?? 0)];
    const filename = (r.title ?? r.fileName ?? "").replace(/^\[.*?\]\s*/, "");
    const codec = detectCodec(filename);
    const language = detectLanguage(filename);
    const quality = qualityLabel(Number(r.resolution ?? NaN)) || detectQuality(filename);
    const link = r.resourceLink ?? "";
    const host = hostLabel(link);
    const mirror: StreamMirror = {
      label: host,
      resolverUrl: link,
      headers: movieboxStreamHeaders(this.providers.moviebox),
      directFile: /\.(mp4|mkv|webm|m3u8|mp3|ts|avi|mov)(\?|#|$)/i.test(link),
    };
    return {
      provider: "MovieBox",
      filename,
      quality,
      codec,
      language,
      sizeBytes: parseSize(String(r.size ?? "")),
      season: se > 0 ? se : undefined,
      episode: ep > 0 ? ep : undefined,
      mirrors: [mirror],
      resourceId: r.resourceId !== undefined ? String(r.resourceId) : undefined,
      subjectId,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Playback                                                             */
  /* ------------------------------------------------------------------ */

  async resolve(
    item: StreamCatalogItem,
    release: StreamRelease,
    mirror: StreamMirror,
    subtitle?: string,
    signal?: AbortSignal,
  ): Promise<PlaybackSource> {
    if (item.provider === "torrent") {
      if (this.torrentStreamer === undefined) {
        throw new StreamError("unavailable", "torrent streaming is not available", { provider: "torrent" });
      }
      return this.torrentStreamer(release, mirror, signal);
    }
    if (item.provider === "fourkhdhub" && !mirror.directFile) {
      const resolved = await this.providers.fourkhdhub.resolveMirror(mirror, signal);
      return {
        provider: item.provider,
        url: resolved.url,
        headers: resolved.headers,
        subtitle,
        sourceLabel: `${release.provider} · ${release.quality ?? ""}`.trim().replace(/ +/g, " | "),
      };
    }
    return {
      provider: item.provider,
      url: mirror.resolverUrl,
      headers: mirror.headers,
      subtitle,
      sourceLabel: `${release.provider} · ${release.quality ?? "HD"}`.trim(),
    };
  }

  /* ------------------------------------------------------------------ */
  /* Misc                                                                 */
  /* ------------------------------------------------------------------ */

  /** Fetch favorites-catalog rows for the watch home (best-effort). */
  async favoriteItems(): Promise<StreamCatalogItem[]> {
    return [];
  }
}

/* ------------------------------------------------------------------ */
/* Adapters                                                             */
/* ------------------------------------------------------------------ */

function adaptMovieBoxCatalog(subject: MbSubject): StreamCatalogItem {
  const stype = String(subject.subjectType ?? subject.stype ?? "1");
  return {
    provider: "moviebox",
    id: String(subject.subjectId ?? ""),
    title: subject.title ?? "",
    mediaType: MOVIEBOX_MEDIA_TYPES.get(stype) ?? "movie",
    year: yearFromDate(subject.releaseDate),
    posterUrl: posterUrlOf(subject.cover),
    seasonCount: subject.maxEp !== undefined ? undefined : undefined,
  };
}

function posterUrlOf(cover: { url?: string } | undefined): string | undefined {
  if (cover === undefined) return undefined;
  const raw = cover.url;
  if (raw === undefined) return undefined;
  if (raw.startsWith("//")) return `https:${raw}`;
  return raw;
}

function yearFromDate(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  const resolved = new Date(typeof value === "number" ? value * 1000 : value.includes("/") ? value : value);
  if (Number.isNaN(resolved.getTime())) {
    const m = /(\d{4})/.exec(String(value));
    return m?.[1];
  }
  return String(resolved.getFullYear());
}

function qualityLabel(resolution: number): string | undefined {
  const map: Record<number, string> = {
    1: "240p",
    2: "480p",
    3: "720p",
    4: "1080p",
    5: "4K",
    6: "2160p",
  };
  return map[resolution] ?? map[5];
}

function hostLabel(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const first = host.split(".")[0];
    return first !== undefined && first.length > 0 ? first.slice(0, 8) : "stream";
  } catch {
    return "stream";
  }
}

function movieboxStreamHeaders(client: MovieBoxClient): Record<string, string> {
  const headers: Record<string, string> = {
    "user-agent": "okhttp/3.12.1",
    referer: "https://www.moviebox.app/",
  };
  return headers;
}

function messageOf(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

function humanSize(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
}

/** Extensions that a media player can consume directly without a resolver. */
const DIRECT_MEDIA = /\.(mp4|mkv|webm|m3u8|mp3|ts|avi|mov)(\?|#|$)/i;

/** Tolerant homepage row parsing over the raw moviebox tab-operating payload. */
function parseMovieBoxHome(raw: unknown): HomeSection[] {
  const sections: HomeSection[] = [];
  if (raw === null || typeof raw !== "object") return sections;
  const rows = (raw as Record<string, unknown>)["results"];
  if (!Array.isArray(rows)) return sections;
  for (const row of rows) {
    if (row === null || typeof row !== "object") continue;
    const rec = row as Record<string, unknown>;
    const subjectSeed = rec["subjects"];
    if (Array.isArray(subjectSeed)) {
      const items = subjectSeed
        .filter((s): s is MbSubject => typeof s === "object" && s !== null)
        .filter((s) => s.subjectId !== undefined && s.title !== undefined)
        .map(adaptMovieBoxCatalog);
      if (items.length > 0) {
        sections.push({ name: String(rec["title"] ?? "MovieBox"), items });
      }
    }
  }
  return sections;
}

/** Fallback adapter for addons metas used by homeSections. */
export function adaptAddonMeta(item: AddonMetaItem | AddonCatalogItem): StreamCatalogItem {
  const type = "type" in item && item.type !== undefined ? item.type : "movie";
  return {
    provider: "addons",
    id: item.id ?? "",
    title: item.name ?? item.id ?? "",
    mediaType: type === "series" ? "series" : "movie",
    year: item.year,
    posterUrl: item.poster,
  };
}

/** Pick the MovieBox subject that most plausibly is the addon item. */
function bestSubjectMatch(subjects: MbSubject[], item: StreamCatalogItem): MbSubject | undefined {
  const target = normalizeTitle(item.title);
  if (target.length === 0) return undefined;
  const candidates = subjects.filter((s) => s.subjectId !== undefined && s.title !== undefined && s.title!.length > 0);
  if (candidates.length === 0) return undefined;
  const wantType = item.mediaType === "series" ? "series" : "movie";
  const scored = candidates.map((s) => {
    const subjectTitle = normalizeTitle(s.title!);
    let score = 0;
    if (subjectTitle === target) score += 100;
    else if (subjectTitle.includes(target) || target.includes(subjectTitle)) score += 60;
    const gotType = MOVIEBOX_MEDIA_TYPES.get(String(s.subjectType ?? s.stype ?? "1"));
    if (gotType === wantType) score += 10;
    if (item.year !== undefined && s.releaseDate !== undefined && yearFromDate(s.releaseDate) === item.year) score += 20;
    return { subject: s, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  return top.score >= 60 ? top.subject : undefined;
}

/** Pick the 4KHDHub search card that most plausibly is the addon item. */
function bestFourKhdMatch(items: StreamCatalogItem[], item: StreamCatalogItem): StreamCatalogItem | undefined {
  const target = normalizeTitle(item.title);
  if (target.length === 0) return undefined;
  const candidates = items.filter((c) => c.title.length > 0);
  if (candidates.length === 0) return undefined;
  const scored = candidates.map((c) => {
    const title = normalizeTitle(c.title);
    let score = 0;
    if (title === target) score += 100;
    else if (title.includes(target) || target.includes(title)) score += 60;
    if (c.mediaType === item.mediaType) score += 10;
    if (item.year !== undefined && c.year !== undefined && c.year === item.year) score += 20;
    return { card: c, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0]!;
  return top.score >= 60 ? top.card : undefined;
}

function normalizeTitle(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}