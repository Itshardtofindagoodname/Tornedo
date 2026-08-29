/**
 * Unit tests for the streaming ("Watch") modules that don't need the network:
 * MovieBox signing, canonical query sorting, m3u/live-TV parsing, addon stream
 * title parsing, poster PNG decoding + block rendering, the theme engine, and
 * player command construction.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { PNG } from "pngjs";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { canonicalQuery, clientTokenHeaders, md5Hex, signMovieBox, type SignInput } from "../src/stream/crypto.js";
import { parseM3u, groupChannels, loadPlaylistChannels, searchChannels, channelToCatalog, type TvPlaylist } from "../src/stream/tv.js";
import { parseStreamTitle } from "../src/stream/addons.js";
import { decodeImage, toBlockRows } from "../src/stream/image.js";
import { isThemeName, lighten, darken, resolveTheme, THEME_NAMES, type PaletteType } from "../src/stream/themes.js";
import { providerLabel, qualityScore, STREAM_PROVIDERS, type StreamCatalogItem, type StreamMirror, type StreamRelease, type PlaybackSource } from "../src/stream/models.js";
import { buildCommand, detectPlayers, type Player } from "../src/stream/players.js";
import { StreamService } from "../src/stream/service.js";
import { FourKHDAddonsClient } from "../src/stream/addons.js";
import { BdixClient } from "../src/stream/bdix.js";
import { adaptTorrentRelease } from "../src/stream/torrent-adapter.js";
import { pickVideoFile, serveFile, TorrentStreamer, type StreamableFile } from "../src/stream/torrent-stream.js";
import { defaultConfig } from "../src/config/config.js";
import http from "node:http";
import { PassThrough, Readable } from "node:stream";
import type { Release } from "../src/model/search.js";

// Fake WebTorrent engine for the TorrentStreamer tests below: metadata resolves
// on the next microtask, torrents are registered per magnet, and every add is
// recorded so tests can assert warm()/serve() reuse instead of re-adding.
const { FakeWebTorrentModule, FakeEngine, registerTorrent } = vi.hoisted(() => {
  class FakeTorrent {
    files: StreamableFile[] = [];
    destroyed = false;
    on() {}
    destroy() {
      this.destroyed = true;
    }
  }
  const torrents = new Map<string, FakeTorrent>();
  class FakeEngine {
    static created: FakeEngine[] = [];
    added: string[] = [];
    destroyed = false;
    constructor() {
      FakeEngine.created.push(this);
    }
    add(source: string, _opts: unknown, onReady: (t: FakeTorrent) => void): FakeTorrent {
      this.added.push(source);
      const t = torrents.get(source) ?? new FakeTorrent();
      queueMicrotask(() => onReady(t));
      return t;
    }
    destroy() {
      this.destroyed = true;
    }
  }
  return {
    FakeWebTorrentModule: { default: FakeEngine },
    FakeEngine,
    registerTorrent: (magnet: string, files: StreamableFile[]): void => {
      const t = new FakeTorrent();
      t.files = files;
      torrents.set(magnet, t);
    },
  };
});
vi.mock("webtorrent", () => FakeWebTorrentModule);

describe("stream crypto (MovieBox signing)", () => {
  it("md5 matches the well-known empty-input digest", () => {
    expect(md5Hex("")).toBe("d41d8cd98f00b204e9800998ecf8427e");
    expect(md5Hex(Buffer.from("abc"))).toBe("900150983cd24fb0d6963f7d28e17f72");
  });

  it("canonical query sorts pairs by key", () => {
    expect(canonicalQuery([["b", "2"], ["a", "1"]])).toBe("a=1&b=2");
    expect(canonicalQuery([])).toBe("");
  });

  it("client token header is `ts,<hex>` shaped", () => {
    expect(clientTokenHeaders(12345, "aabbccddeeff0011")["x-client-token"]).toBe("12345,aabbccddeeff0011");
    const auto = clientTokenHeaders(12345);
    expect(/^\d+,([0-9a-f]{16})$/.test(auto["x-client-token"])).toBe(true);
  });

  it("signMovieBox produces a stable base64 signature for fixed input", () => {
    const input: SignInput = {
      method: "GET",
      accept: "application/json",
      contentType: "",
      bodyLength: 0,
      timestampMs: 1724000000000,
      bodyHash: md5Hex(""),
      scheme: "https",
      host: "sanbb5.1000vusvta4.com",
      pathname: "/wefeed-mobile-bff/mobile/v2/homepage",
      query: "a=1&b=2",
    };
    const sig = signMovieBox("a2V5", input);
    expect(sig.length).toBeGreaterThan(20);
    expect(/^[A-Za-z0-9+/=]+$/.test(sig)).toBe(true);
    // Same input -> same signature (deterministic).
    expect(signMovieBox("a2V5", input)).toBe(sig);
    // Different canonical input -> different signature.
    expect(signMovieBox("a2V5", { ...input, query: "a=2&b=1" })).not.toBe(sig);
  });
});

describe("live TV (m3u)", () => {
  const PLAYLIST = `#EXTM3U
#EXTINF:-1 tvg-id="bbc1" tvg-logo="https://x/logo.png" group-title="News",BBC One HD
http://example.com/bbc1.m3u8
#EXTINF:0 group-title="Movies",Cine 1,
http://example.com/cine1/index.m3u8

#EXTINF:-1,Canal Sport
#EXTGRP:Sports
udp://@239.1.2.3:1234
`;

  it("parses channels with logos, groups and names containing commas", () => {
    const channels = parseM3u(PLAYLIST);
    expect(channels).toHaveLength(3);
    const bbc = channels[0]!;
    expect(bbc.name).toBe("BBC One HD");
    expect(bbc.tvgId).toBe("bbc1");
    expect(bbc.logo).toBe("https://x/logo.png");
    expect(bbc.group).toBe("News");
    expect(bbc.streamUrl).toBe("http://example.com/bbc1.m3u8");
    const cine = channels[1]!;
    expect(cine.name).toBe("Cine 1,");
    const sport = channels[2]!;
    expect(sport.group).toBe("Sports");
  });

  it("groups channels by group-title", () => {
    const groups = groupChannels(parseM3u(PLAYLIST));
    expect([...groups.keys()].sort()).toEqual(["Movies", "News", "Sports"]);
    expect(groups.get("News")).toHaveLength(1);
  });

  it("ignores empty playlists", () => {
    expect(parseM3u("#EXTM3U\n\n# some comment\n")).toHaveLength(0);
  });
});

describe("addon stream titles", () => {
  it("extracts quality, codec and size, and cleans the display title", () => {
    const parsed = parseStreamTitle("Avatar [2021] 1080p [x265] [2.50 GB] 👑");
    expect(parsed.title).toContain("Avatar");
    expect(parsed.title).not.toContain("1080p");
    expect(parsed.quality).toBe("1080p");
    expect(parsed.codec).toBe("H.265");
    expect(parsed.sizeBytes).toBe(Math.round(2.5 * 1024 ** 3));
  });

  it("falls back to the raw title when nothing is parseable", () => {
    const parsed = parseStreamTitle("Something wholly plain");
    expect(parsed.title).toBe("Something wholly plain");
    expect(parsed.quality).toBeUndefined();
  });
});

describe("poster images", () => {
  function redSquare(): Buffer {
    const png = new PNG({ width: 2, height: 2 });
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const i = (png.width * y + x) * 4;
        png.data[i] = 200;
        png.data[i + 1] = 20;
        png.data[i + 2] = 30;
        png.data[i + 3] = 255;
      }
    }
    return PNG.sync.write(png);
  }

  it("decodes a tiny PNG to RGBA with the right dimensions", () => {
    const img = decodeImage(redSquare());
    expect(img?.width).toBe(2);
    expect(img?.height).toBe(2);
    expect(img?.data.length ?? 0).toBeGreaterThanOrEqual(2 * 2 * 4);
  });

  it("renders a visible truecolor cell for a solid frame", () => {
    const img = decodeImage(redSquare())!;
    const rows = toBlockRows(img, 1, 1);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.spans.length).toBeGreaterThan(0);
    expect(rows[0]!.spans[0]!.color).toBe("200;20;30");
  });

  it("contain-fit letterboxes and preserves aspect instead of squashing", () => {
    const img = decodeImage(redSquare())!; // 2×2
    const rows = toBlockRows(img, 4, 1); // 4×1 grid (ar 2) vs source (ar 1)
    expect(rows[0]!.spans[0]!.color).toBeNull(); // pillar
    expect(rows[0]!.spans[1]!.color).toBe("200;20;30"); // centered frame
    expect(rows[0]!.spans[1]!.text).toBe("  ");
    expect(rows[0]!.spans[2]!.color).toBeNull(); // pillar
  });

  it("cover fit fills the whole grid (crops the frame)", () => {
    const img = decodeImage(redSquare())!; // 2×2
    const rows = toBlockRows(img, 4, 1, { transparent: null, fit: "cover" });
    // cover scales to fill: source 2×2 covers 4×1-in-pixels (2 wide + pillars).
    expect(rows[0]!.spans.some((s) => s.color === "200;20;30")).toBe(true);
  });
});

describe("themes", () => {
  it("resolves a complete palette for every shipped theme", () => {
    const keys: (keyof PaletteType)[] = [
      "bg", "surface", "surfaceAlt", "border", "text", "subtext", "dim", "faint",
      "accent", "accentBright", "accentDim", "amber", "orange", "green", "red", "teal", "cyan", "magenta",
    ];
    expect(THEME_NAMES.length).toBeGreaterThanOrEqual(10);
    for (const name of THEME_NAMES) {
      const theme = resolveTheme(name);
      for (const key of keys) {
        expect(theme[key]).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  it("unknown names fall back to default", () => {
    expect(isThemeName("mocha")).toBe(true);
    expect(isThemeName("nope")).toBe(false);
    expect(resolveTheme("nope")).toEqual(resolveTheme("default"));
  });

  it("lighten/darken move toward white/black deterministically", () => {
    expect(lighten("#000000", 0.5)).toBe("#808080");
    expect(darken("#ffffff", 0.5)).toBe("#808080");
    expect(lighten("#ff0000", 0).toLowerCase()).toBe("#ff0000");
  });
});

describe("stream models", () => {
  it("ranks quality tiers", () => {
    expect(qualityScore("2160p")).toBeGreaterThan(qualityScore("1080p"));
    expect(qualityScore("1080p")).toBeGreaterThan(qualityScore("720p"));
    expect(qualityScore("720p")).toBeGreaterThan(qualityScore("480p"));
    expect(qualityScore(undefined)).toBe(0);
  });

  it("labels every provider id", () => {
    for (const id of STREAM_PROVIDERS) {
      expect(providerLabel(id).length).toBeGreaterThan(0);
    }
    expect(providerLabel("addons")).toBe("Addons");
  });
});

describe("addon client (Cinemeta)", () => {
  const addon = { baseUrl: "https://addons.example", transportUrl: "https://addons.example", addonId: "cinemeta" };
  const addons = new FourKHDAddonsClient([addon]);

  afterEach(() => vi.unstubAllGlobals());

  function jsonBody(url: string, status: number, body: unknown): Response {
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => JSON.stringify(body),
    } as unknown as Response;
  }

  it("resolves a movie whose prefixed id would be misclassified as series", async () => {
    const calls: string[] = [];
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("/meta/movie/tt37287335.json")) {
        return jsonBody(url, 200, {
          meta: { id: "tt37287335", name: "The End", type: "movie", year: "2024", poster: "https://img/x.jpg" },
        });
      }
      if (url.includes("/meta/series/tt37287335.json")) return jsonBody(url, 200, {});
      return jsonBody(url, 404, {});
    });
    vi.stubGlobal("fetch", fetcher);
    const details = await addons.getMeta(addon, "cinemeta:cinemeta:tt37287335", "movie");
    expect(details.mediaType).toBe("movie");
    expect(details.title).toBe("The End");
    expect(details.id).toBe("cinemeta:cinemeta:tt37287335");
    expect(calls.some((u) => u.includes("/meta/movie/tt37287335.json"))).toBe(true);
  });

  it("probes the series types first and falls back to the movie-shaped meta", async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.includes("/meta/movie/tt1234567.json")) {
        return jsonBody(url, 200, { meta: { id: "tt1234567", name: "Standalone", type: "movie" } });
      }
      return jsonBody(url, 200, {}); // series/tv/anime/other all empty
    });
    vi.stubGlobal("fetch", fetcher);
    const details = await addons.getMeta(addon, "tt1234567", "movie");
    expect(details.mediaType).toBe("movie");
    expect(details.title).toBe("Standalone");
  });

  it("errors only when every meta type is empty", async () => {
    const fetcher = vi.fn(async () => jsonBody("https://addons.example/meta/x", 200, {}));
    vi.stubGlobal("fetch", fetcher);
    await expect(addons.getMeta(addon, "cinemeta:cinemeta:tt0000000", "series")).rejects.toThrow(/meta empty/);
  });

  it("fetches streams with the catalog media type instead of guessing series", async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) {
        return jsonBody(url, 200, { id: "test", name: "Test", resources: ["stream"] });
      }
      if (url.includes("/stream/movie/tt37287335.json")) {
        return jsonBody(url, 200, { streams: [{ url: "https://cdn.example/movie.mp4", title: "The End 1080p" }] });
      }
      return jsonBody(url, 404, {});
    });
    vi.stubGlobal("fetch", fetcher);
    const client = new FourKHDAddonsClient([addon]);
    const { releases } = await client.getStreams(addon, "cinemeta:cinemeta:tt37287335", "movie", 0, 0);
    expect(releases).toHaveLength(1);
    expect(releases[0]!.filename).toContain("The End");
  });

  it("never calls /stream for an addon that lacks the stream resource", async () => {
    const urls: string[] = [];
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith("/manifest.json")) {
        return jsonBody(url, 200, { id: "cinemeta", name: "Cinemeta", resources: ["catalog", "meta"] });
      }
      return jsonBody(url, 404, {});
    });
    vi.stubGlobal("fetch", fetcher);
    const { releases } = await new FourKHDAddonsClient([addon]).getStreams(addon, "cinemeta:cinemeta:tt37287335", "movie", 0, 0);
    expect(releases).toHaveLength(0);
    expect(urls.some((u) => u.includes("/stream/"))).toBe(false);
  });

  it("swallows a failing stream endpoint into an empty result", async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) {
        return jsonBody(url, 200, { id: "test", name: "Test", resources: ["stream"] });
      }
      return jsonBody(url, 500, {});
    });
    vi.stubGlobal("fetch", fetcher);
    const { releases } = await new FourKHDAddonsClient([addon]).getStreams(addon, "cinemeta:cinemeta:tt37287335", "movie", 0, 0);
    expect(releases).toHaveLength(0);
  });

  it("reports an addon as blocked when it only offered raw torrents", async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) {
        return jsonBody(url, 200, { id: "torrent", name: "Torrents", resources: ["stream"] });
      }
      return jsonBody(url, 200, { streams: [{ infoHash: "abcdef", title: "Movie 1080p" }] });
    });
    vi.stubGlobal("fetch", fetcher);
    const { releases, blocked } = await new FourKHDAddonsClient([addon]).getStreams(addon, "cinemeta:cinemeta:tt37287335", "movie", 0, 0);
    expect(releases).toHaveLength(0);
    expect(blocked).toEqual(["cinemeta"]);
  });

  it("describe() inspects a candidate manifest before install", async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) {
        return jsonBody(url, 200, { id: "com.torrentio", name: "Torrentio", resources: ["stream", "meta"] });
      }
      return jsonBody(url, 404, {});
    });
    vi.stubGlobal("fetch", fetcher);
    const info = await new FourKHDAddonsClient([]).describe("https://torrentio.example");
    expect(info.manifest?.id).toBe("com.torrentio");
    expect(info.streams).toBe(true);
  });

  it("describe() reports null streams for a non-stream addon", async () => {
    const fetcher = vi.fn(async () => jsonBody("https://x.example/manifest.json", 404, {}));
    vi.stubGlobal("fetch", fetcher);
    const info = await new FourKHDAddonsClient([]).describe("https://x.example");
    expect(info.manifest).toBeNull();
    expect(info.streams).toBe(false);
  });
});

describe("addon stream fallback to native providers", () => {
  let dir: string;

  const item = (overrides: Partial<StreamCatalogItem> = {}): StreamCatalogItem => ({
    provider: "addons",
    id: "cinemeta:cinemeta:tt37287335",
    title: "The End",
    mediaType: "movie",
    year: "2024",
    extra: { addon: "cinemeta", baseUrl: "https://v3-cinemeta.strem.io", rawId: "tt37287335", imdb: "tt37287335" },
    ...overrides,
  });

  /** A Cinemeta-like manifest: catalog/meta only, never a /stream resource. */
  function noStreamManifest() {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: "cinemeta", name: "Cinemeta", resources: ["catalog", "meta"] }),
        } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => "{}" } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetcher);
  }

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tornedo-fallback-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("plays an addon-only title via MovieBox when the addon has no streams", async () => {
    noStreamManifest();
    const service = new StreamService({ cacheDir: path.join(dir, "c1") });
    vi.spyOn(service.providers.moviebox, "search").mockResolvedValue({
      list: [{ subjectId: "mb123", subjectType: 1, title: "The End", releaseDate: "2024" }],
    });
    vi.spyOn(service.providers.moviebox, "getResources").mockResolvedValue({
      list: [
        {
          resourceId: "r1",
          resourceLink: "https://cdn.example/the-end-1080p.mp4",
          title: "[1080p] The End",
          resolution: 4,
        },
      ],
      collectionResolutions: [{ resolution: 4 }],
    });

    const { releases, notice } = await service.releaseSources(item(), 0, 0, "");
    expect(releases).toHaveLength(1);
    expect(releases[0]!.provider).toBe("MovieBox");
    expect(releases[0]!.quality).toBe("1080p");
    expect(notice).toBeUndefined();
  });

  it("falls through to 4KHDHub when MovieBox has no matching subject", async () => {
    noStreamManifest();
    const service = new StreamService({ cacheDir: path.join(dir, "c2") });
    vi.spyOn(service.providers.moviebox, "search").mockResolvedValue({
      list: [{ subjectId: "mb999", subjectType: 1, title: "Something Completely Different", releaseDate: "2010" }],
    });
    vi.spyOn(service.providers.fourkhdhub, "search").mockResolvedValue([
      { provider: "fourkhdhub", id: "/movie/the-end", title: "The End", mediaType: "movie", year: "2024" },
    ]);
    vi.spyOn(service.providers.fourkhdhub, "getReleases").mockResolvedValue([
      {
        provider: "4KHDHub",
        filename: "The End 1080p.mkv",
        quality: "1080p",
        mirrors: [
          { label: "cdn", resolverUrl: "https://cdn.example/the-end.mkv", headers: {}, directFile: true },
        ],
      },
    ]);

    const { releases, notice } = await service.releaseSources(item(), 0, 0, "");
    expect(releases).toHaveLength(1);
    expect(releases[0]!.provider).toBe("4KHDHub");
    expect(notice).toBeUndefined();
  });

  it("keeps the install-a-stream-provider notice when nothing anywhere has streams", async () => {
    noStreamManifest();
    const service = new StreamService({ cacheDir: path.join(dir, "c3") });
    vi.spyOn(service.providers.moviebox, "search").mockResolvedValue({
      list: [{ subjectId: "mb123", subjectType: 1, title: "The End", releaseDate: "2024" }],
    });
    vi.spyOn(service.providers.moviebox, "getResources").mockResolvedValue({ list: [], collectionResolutions: [] });
    vi.spyOn(service.providers.fourkhdhub, "search").mockResolvedValue([]);

    const { releases, notice } = await service.releaseSources(item(), 0, 0, "");
    expect(releases).toHaveLength(0);
    expect(notice).toContain("No streaming addons are currently installed or enabled");
  });

  it("warns about torrent-only addon streams but still falls back to native streams", async () => {
    const fetcher = vi.fn(async (input: Parameters<typeof fetch>[0]) => {
      const url = String(input);
      if (url.endsWith("/manifest.json")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ id: "peerflix", name: "Peerflix", resources: ["stream"] }),
        } as unknown as Response;
      }
      if (url.includes("/stream/")) {
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({ streams: [{ infoHash: "abcdef", title: "The End 1080p" }] }),
        } as unknown as Response;
      }
      return { ok: false, status: 404, text: async () => "{}" } as unknown as Response;
    });
    vi.stubGlobal("fetch", fetcher);
    const service = new StreamService({ cacheDir: path.join(dir, "c4") });
    vi.spyOn(service.providers.moviebox, "search").mockResolvedValue({
      list: [{ subjectId: "mb123", subjectType: 1, title: "The End", releaseDate: "2024" }],
    });
    vi.spyOn(service.providers.moviebox, "getResources").mockResolvedValue({
      list: [{ resourceId: "r1", resourceLink: "https://cdn.example/the-end.mp4", title: "The End", resolution: 4 }],
      collectionResolutions: [{ resolution: 4 }],
    });

    const { releases, notice } = await service.releaseSources(item(), 0, 0, "");
    expect(releases).toHaveLength(1);
    expect(releases[0]!.provider).toBe("MovieBox");
    expect(notice).toContain("raw torrents");
    expect(notice).toContain("MovieBox");
  });
});

describe("player command building", () => {
  const mpv: Player = { id: "mpv", name: "mpv", command: "mpv" };
  const vlc: Player = { id: "vlc", name: "VLC", command: "vlc" };

  it("passes stream headers, subtitle, start offset and tracker script to mpv", () => {
    const { command, argv } = buildCommand(
      mpv,
      {
        url: "https://cdn.example/video.mp4",
        headers: { "user-agent": "okhttp/3.12.1", referer: "https://ref.example/" },
        subtitle: "https://sub.example/en.vtt",
        startSeconds: 95,
        title: "Dune S01E01",
        trackerStateFile: "/tmp/tracker.lua",
      },
      "win32",
    );
    expect(command).toBe("mpv");
    expect(argv).toContain("--http-header-fields=user-agent: okhttp/3.12.1");
    expect(argv).toContain("--http-header-fields=referer: https://ref.example/");
    expect(argv).toContain("--sub-file=https://sub.example/en.vtt");
    expect(argv).toContain("--start=95");
    expect(argv).toContain("--script=/tmp/tracker.lua");
    expect(argv.at(-1)).toBe("https://cdn.example/video.mp4");
  });

  it("vlc runs without the tracker script", () => {
    const { argv } = buildCommand(
      vlc,
      { url: "https://cdn.example/video.mp4", headers: { "user-agent": "okhttp" }, title: "T" },
      "linux",
    );
    expect(argv).toContain("--http-user-agent=okhttp");
    expect(argv).toContain("--play-and-exit");
    expect(argv.some((a) => a.includes("--script"))).toBe(false);
  });

  it("vlc normalizes Windows subtitle backslashes", () => {
    const { argv } = buildCommand(
      vlc,
      { url: "https://cdn.example/video.mp4", headers: {}, subtitle: "C:\\subs\\en.vtt" },
      "win32",
    );
    expect(argv.some((a) => a.startsWith("--sub-file=C:/subs/en.vtt"))).toBe(true);
  });
});

describe("player detection", () => {
  it("honors the env override even when the binary is not on PATH", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tornedo-players-"));
    const fakeVlc = path.join(dir, "vlc.exe");
    await writeFile(fakeVlc, "#!/bin/sh\n", "utf8");
    const players = detectPlayers("win32", {
      TORNEDO_VLC_PATH: fakeVlc,
      PATH: "", // deliberately empty: only the explicit path may win
    });
    const vlc = players.find((p) => p.id === "vlc");
    expect(vlc?.command).toBe(fakeVlc);
    expect(vlc?.name).toBe("VLC");
    await rm(dir, { recursive: true, force: true });
  });

  it("detects a win32 VLC install without needing PATH", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "tornedo-players-"));
    const local = path.join(dir, "AppData", "Local");
    const installDir = path.join(local, "Programs", "VLC");
    await mkdir(installDir, { recursive: true });
    const vlcExe = path.join(installDir, "vlc.exe");
    await writeFile(vlcExe, "#!/bin/sh\n", "utf8");
    const players = detectPlayers("win32", {
      PATH: "",
      USERPROFILE: "C:\\Users\\test",
      LOCALAPPDATA: local,
      APPDATA: path.join(dir, "AppData", "Roaming"),
    } as NodeJS.ProcessEnv);
    const vlc = players.find((p) => p.id === "vlc");
    // Either a real Program Files VLC exists on this machine (probed first), or
    // the LOCALAPPDATA candidate wins - either way the command must be a
    // real, existing vlc.exe that was found without any PATH lookup.
    expect(vlc).toBeDefined();
    expect(vlc!.command).toMatch(/vlc\.exe$/i);
    expect(existsSync(vlc!.command)).toBe(true);
    await rm(dir, { recursive: true, force: true });
  });
});

describe("live TV service integration", () => {
  let dir: string;
  let playlist: TvPlaylist;

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tornedo-tv-"));
    await mkdir(path.join(dir, "cache"), { recursive: true });
    const file = path.join(dir, "channels.m3u");
    await writeFile(
      file,
      [
        "#EXTM3U",
        '#EXTINF:-1 tvg-id="bbcone" group-title="News",BBC One HD',
        "http://example.com/bbc1.m3u8",
        '#EXTINF:-1 group-title="News",CNN International',
        "http://example.com/cnn.m3u8",
        '#EXTINF:-1 group-title="Movies",Cine 1',
        "http://example.com/cine1/index.m3u8",
        "",
      ].join("\n"),
      "utf8",
    );
    playlist = { name: "demo", url: file };
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("loads a playlist and caches it briefly", async () => {
    const channels = await loadPlaylistChannels(playlist);
    expect(channels).toHaveLength(3);
    const again = await loadPlaylistChannels(playlist);
    expect(again).toHaveLength(3);
  });

  it("searchChannels ranks exact name prefixes above group matches", () => {
    const channels = parseM3u(
      [
        '#EXTINF:-1 group-title="News",BBC World',
        "http://x/bbcworld.m3u8",
        '#EXTINF:-1 group-title="BBC Family",BBQ Grill Show',
        "http://x/bbq.m3u8",
      ].join("\n"),
    );
    const hits = searchChannels(channels, "bbc");
    expect(hits[0]!.name).toBe("BBC World");
  });

  it("channelToCatalog carries the stream data in extra", () => {
    const item = channelToCatalog(
      { id: "bbcone", name: "BBC One HD", group: "News", logo: "https://x/logo.png", streamUrl: "http://x/bbc1.m3u8" },
      { name: "demo", url: "http://pl.m3u8" },
    );
    expect(item.provider).toBe("tv");
    expect(item.mediaType).toBe("tv");
    expect(item.id).toContain("demo://bbcone");
    expect(item.extra?.["group"]).toBe("News");
    expect(item.extra?.["streamUrl"]).toBe("http://x/bbc1.m3u8");
  });

  it("searchTv surfaces matching channels and empty query browses all", async () => {
    const service = new StreamService({ cacheDir: path.join(dir, "cache") });
    service.setTvPlaylists([playlist]);
    expect(service.tvPlaylistCount).toBe(1);

    const hits = await service.searchTv("bbc");
    expect(hits.map((i) => i.title)).toContain("BBC One HD");
    expect(hits[0]!.extra?.["playlist"]).toBe("demo");

    const all = await service.searchTv("");
    expect(all.map((i) => i.title)).toEqual(["BBC One HD", "CNN International", "Cine 1"]);
  });

  it("details, releaseSources and resolve round-trip a channel to a live source", async () => {
    const service = new StreamService({ cacheDir: path.join(dir, "cache2") });
    service.setTvPlaylists([playlist]);
    const item = (await service.searchTv("bbc"))[0]!;

    const details = await service.details(item);
    expect(details.mediaType).toBe("tv");
    expect(details.genres).toContain("News");

    const { releases } = await service.releaseSources(item, 0, 0, "");
    expect(releases).toHaveLength(1);
    expect(releases[0]!.quality).toBe("Live");
    expect(releases[0]!.mirrors[0]!.directFile).toBe(true);

    const source = await service.resolve(item, releases[0]!, releases[0]!.mirrors[0]!);
    expect(source.url).toBe("http://example.com/bbc1.m3u8");
    expect(source.provider).toBe("tv");
  });

  it("searchTv is a no-op with no playlists configured", async () => {
    const service = new StreamService({ cacheDir: path.join(dir, "cache3") });
    expect(await service.searchTv("bbc")).toEqual([]);
  });
});

describe("BDIX (CircleFTP)", () => {
  let dir: string;

  afterEach(() => vi.unstubAllGlobals());

  function jsonResponse(payload: unknown): Response {
    return {
      ok: true,
      status: 200,
      json: async () => payload,
      text: async () => JSON.stringify(payload),
    } as unknown as Response;
  }

  const notFound = (): Response => ({ ok: false, status: 404, text: async () => "{}" } as unknown as Response);

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tornedo-bdix-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("maps the search API into catalog items", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/posts")) {
        return jsonResponse({
          posts: [
            { id: 42, title: "The End", type: "movie", year: "2024", image: "end.jpg" },
            { id: 43, name: "The Series", type: "series" },
          ],
        });
      }
      return notFound();
    });
    const client = new BdixClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const items = await client.search("the end");
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      provider: "bdix_circleftp",
      id: "42",
      title: "The End",
      mediaType: "movie",
      year: "2024",
      posterUrl: "http://new.circleftp.net:5000/uploads/end.jpg",
    });
    expect(items[1]!.mediaType).toBe("series");
  });

  it("returns [] and latches when the BDIX endpoint is unreachable", async () => {
    const now = vi.fn(() => 0);
    const fetchImpl = vi.fn(async () => {
      throw new Error("timeout");
    });
    const client = new BdixClient({ fetchImpl: fetchImpl as unknown as typeof fetch, now, skipWindowMs: 60_000 });
    expect(await client.search("the end")).toEqual([]);
    now.mockReturnValue(10_000);
    expect(await client.search("the end")).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("extracts a movie release from the detail content link", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/posts/7")) {
        return jsonResponse({
          type: "movie",
          quality: "1080p",
          content: "http://new.circleftp.net:5000/uploads/the-end.mp4",
        });
      }
      return notFound();
    });
    const client = new BdixClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { releases } = await client.releases(
      { provider: "bdix_circleftp", id: "7", title: "The End", mediaType: "movie" },
      0,
      0,
    );
    expect(releases).toHaveLength(1);
    expect(releases[0]!.quality).toBe("1080p");
    expect(releases[0]!.mirrors[0]!.resolverUrl).toBe("http://new.circleftp.net:5000/uploads/the-end.mp4");
    expect(releases[0]!.mirrors[0]!.directFile).toBe(true);
  });

  it("picks the episode link for a series season/episode", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/api/posts/9")) {
        return jsonResponse({
          type: "series",
          quality: "720p",
          content: [{ episodes: [{ title: "Pilot", link: "http://new.circleftp.net:5000/uploads/s01e01.mkv" }] }],
        });
      }
      return notFound();
    });
    const client = new BdixClient({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const { releases } = await client.releases(
      { provider: "bdix_circleftp", id: "9", title: "Serial", mediaType: "series" },
      1,
      1,
    );
    expect(releases).toHaveLength(1);
    expect(releases[0]!.season).toBe(1);
    expect(releases[0]!.filename).toBe("s01e01.mkv");
  });

  it("wires BDIX into StreamService searchAll when enabled", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("new.circleftp.net")) return jsonResponse({ posts: [{ id: 5, title: "The End", type: "movie", year: "2024" }] });
      return notFound();
    });
    vi.stubGlobal("fetch", fetchImpl);
    const service = new StreamService({ cacheDir: path.join(dir, "c1"), bdixEnabled: true });
    const { items } = await service.searchAll("the end");
    const bdix = items.find((i) => i.provider === "bdix_circleftp");
    expect(bdix).toBeDefined();
    expect((bdix as StreamCatalogItem | undefined)?.title).toBe("The End");
  });

  it("skips BDIX when disabled", async () => {
    const fetchImpl = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("new.circleftp.net")) return jsonResponse({ posts: [{ id: 5, title: "The End", type: "movie" }] });
      return notFound();
    });
    vi.stubGlobal("fetch", fetchImpl);
    const service = new StreamService({ cacheDir: path.join(dir, "c2"), bdixEnabled: false });
    const { items } = await service.searchAll("the end");
    expect(items.some((i) => i.provider === "bdix_circleftp")).toBe(false);
  });
});

describe("torrent watch sources", () => {
  let dir: string;
  const INFOHASH = "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0";

  afterEach(() => vi.unstubAllGlobals());

  function torrentItem(overrides: Partial<StreamCatalogItem> = {}): StreamCatalogItem {
    return {
      provider: "torrent",
      id: INFOHASH,
      title: "The End",
      mediaType: "movie",
      year: "2024",
      extra: {
        infohash: INFOHASH,
        magnet: `magnet:?xt=urn:btih:${INFOHASH}`,
        source: "YTS",
        seeders: 120,
        size: 2_500_000_000,
        resolution: "1080p",
        quality: "1080p",
      },
      ...overrides,
    };
  }

  const fakeStreamer = async (_release: StreamRelease, _mirror: StreamMirror): Promise<PlaybackSource> => {
    throw new Error("fake streamer should not be reached");
  };

  beforeAll(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "tornedo-torrent-"));
  });

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("merges torrent results into searchAll", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 404, text: async () => "{}" } as unknown as Response)),
    );
    const service = new StreamService({
      cacheDir: path.join(dir, "t1"),
      torrentSearch: async () => [torrentItem()],
    });
    const { items } = await service.searchAll("the end");
    const hit = items.find((i) => i.provider === "torrent");
    expect(hit).toBeDefined();
    expect((hit as StreamCatalogItem | undefined)?.year).toBe("2024");
  });

  it("builds minimal details from the item extra", async () => {
    const service = new StreamService({
      cacheDir: path.join(dir, "t2"),
      torrentSearch: async () => [],
      torrentStreamer: fakeStreamer,
    });
    const details = await service.details(torrentItem());
    expect(details.provider).toBe("torrent");
    expect(details.title).toBe("The End");
    expect(details.description).toContain("seeds");
  });

  it("returns a single release whose mirror carries the magnet", async () => {
    const service = new StreamService({
      cacheDir: path.join(dir, "t3"),
      torrentSearch: async () => [],
      torrentStreamer: fakeStreamer,
    });
    const { releases, resolutions } = await service.releaseSources(torrentItem(), 0, 0, "");
    expect(releases).toHaveLength(1);
    expect(releases[0]!.provider).toBe("YTS");
    expect(releases[0]!.mirrors[0]!.resolverUrl).toContain("magnet:");
    expect(resolutions).toContain("1080p");
  });

  it("resolves through the injected streamer", async () => {
    const streamer = vi.fn(async (release: StreamRelease, mirror: StreamMirror) => ({
      provider: "torrent",
      url: "http://127.0.0.1:3921/",
      headers: {},
      sourceLabel: `${release.provider} | ${release.quality}`,
    }));
    const service = new StreamService({
      cacheDir: path.join(dir, "t4"),
      torrentSearch: async () => [],
      torrentStreamer: streamer as never,
    });
    const item = torrentItem();
    const release = (await service.releaseSources(item, 0, 0, "")).releases[0]!;
    const src = await service.resolve(item, release, release.mirrors[0]!);
    expect(src.provider).toBe("torrent");
    expect(src.url).toBe("http://127.0.0.1:3921/");
    expect(streamer).toHaveBeenCalledTimes(1);
  });

  it("fails gracefully when no streamer is wired", async () => {
    const service = new StreamService({ cacheDir: path.join(dir, "t5") });
    const item = torrentItem();
    const release = (await service.releaseSources(item, 0, 0, "")).releases[0]!;
    await expect(service.resolve(item, release, release.mirrors[0]!)).rejects.toThrow(/torrent streaming is not available/);
  });
});

describe("torrent adapter + streaming helpers", () => {
  it("adapts a Release into a catalog item", () => {
    const release: Release = {
      infohash: "a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0",
      title: "The.End.2024.1080p.WEBRip.x264-YTS",
      rawTitle: "The.End.2024.1080p.WEBRip.x264-YTS",
      category: "Movie",
      size: 2_000_000_000,
      seeders: 99,
      magnet: "magnet:?xt=urn:btih:abcdef",
      sources: ["yts"],
      torrentUrls: [],
      metadata: { title: "The End", year: 2024, resolution: "1080p" },
      score: 10,
      entity: { kind: "movie", title: "The End", year: 2024, resolution: "1080p", quality: "1080p" },
    };
    const item = adaptTorrentRelease(release);
    expect(item.provider).toBe("torrent");
    expect(item.title).toBe("The End");
    expect(item.mediaType).toBe("movie");
    expect(item.year).toBe("2024");
    expect(item.extra).toMatchObject({ seeders: 99, source: "yts", quality: "1080p" });
  });

  it("adapts a TV release as a series", () => {
    const release: Release = {
      infohash: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      title: "Show.S01E01.1080p",
      rawTitle: "Show.S01E01.1080p",
      category: "TV",
      magnet: "magnet:?xt=urn:btih:bbbb",
      sources: ["eztv"],
      torrentUrls: [],
      metadata: { title: "Show", season: 1, episode: 1 },
      score: 5,
      entity: { kind: "tv", title: "Show", season: 1, episode: 1 },
    };
    expect(adaptTorrentRelease(release).mediaType).toBe("series");
  });

  it("picks the largest video file, honoring a filename hint", () => {
    const files = [
      { name: "cover.jpg", path: "cover.jpg", length: 10_000 },
      { name: "movie.mkv", path: "movie.mkv", length: 2_000 },
      { name: "movie.mp4", path: "movie.mp4", length: 5_000 },
    ] as unknown as StreamableFile[];
    expect(pickVideoFile(files)?.name).toBe("movie.mp4");
    expect(pickVideoFile(files, "mkv")?.name).toBe("movie.mkv");
    expect(pickVideoFile(files, "nope")?.name).toBe("movie.mp4");
    expect(pickVideoFile([])?.name).toBeUndefined();
  });

  it("serves a file over HTTP with Range support", async () => {
    const file: StreamableFile = {
      name: "clip.mp4",
      path: "clip.mp4",
      length: 100,
      createReadStream: (opts?: { start?: number; end?: number }) => {
        const bytes = Buffer.from("0123456789".repeat(10));
        const start = opts?.start ?? 0;
        const end = opts?.end ?? bytes.length - 1;
        return Readable.from(bytes.subarray(start, Math.min(end, bytes.length - 1) + 1));
      },
    };
    const { server, url } = await serveFile(file);
    try {
      const ranged = await fetch(url, { headers: { range: "bytes=0-3" } });
      expect(ranged.status).toBe(206);
      expect(ranged.headers.get("content-range")).toBe("bytes 0-3/100");
      expect(await ranged.text()).toBe("0123");

      const open = await fetch(url);
      expect(open.status).toBe(200);
      expect(await open.text()).toHaveLength(100);
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("survives a client aborting mid-stream instead of crashing on PREMATURE_CLOSE", async () => {
    const sources: PassThrough[] = [];
    const file: StreamableFile = {
      name: "movie.mkv",
      length: 5,
      createReadStream: () => {
        const s = new PassThrough();
        s.push(Buffer.from("chunk"));
        sources.push(s);
        return s;
      },
    };
    const { server, url } = await serveFile(file);
    const get = (): Promise<http.IncomingMessage> =>
      new Promise((resolve, reject) => {
        const req = http.get(url, (res) => resolve(res));
        req.on("error", reject);
      });
    try {
      const first = await get();
      // A player aborting its connection tears down the response; the read side
      // then surfaces PREMATURE_CLOSE. Without a listener that error is uncaught
      // and kills the process - with one, the server must keep serving.
      first.destroy();
      sources[0]!.emit("error", Object.assign(new Error("Writable stream closed"), { code: "PREMATURE_CLOSE" }));
      await new Promise((r) => setTimeout(r, 25));
      const again = await get();
      expect(again.statusCode).toBe(200);
      again.destroy();
    } finally {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it("warms a torrent in the background so a later serve is instant and single-adding", async () => {
    const magnet = "magnet:?xt=urn:btih:CDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCDCD";
    const mkFile = (name: string, length: number): StreamableFile => ({
      name,
      path: name,
      length,
      createReadStream: () => new PassThrough(),
    });
    registerTorrent(magnet, [mkFile("movie.mkv", 1_000), mkFile("cover.jpg", 10_000)]);
    const streamer = new TorrentStreamer();
    const dest = `${tmpdir()}${path.sep}tornedo-warm-${Math.random().toString(16).slice(2)}`;
    try {
      streamer.warm({ magnet, destination: dest });
      // Let the (simulated) metadata fetch settle; serve then needs no re-add.
      await new Promise((r) => setTimeout(r, 20));
      const a = await streamer.serve({ magnet, destination: dest });
      const b = await streamer.serve({ magnet, destination: dest });
      expect(a.url).toBe(b.url);
      expect(FakeEngine.created).toHaveLength(1);
      expect(FakeEngine.created[0]!.added).toEqual([magnet]);
      await streamer.disposeAll();
      expect(FakeEngine.created[0]!.destroyed).toBe(true);
    } finally {
      await rm(dest, { recursive: true, force: true });
    }
  });

  it("waits for the torrent to buffer before resolving serve and reports progress", async () => {
    const magnet = "magnet:?xt=urn:btih:ABABABABABABABABABABABABABABABABABABABAB";
    const file: StreamableFile = {
      name: "movie.mp4",
      path: "movie.mp4",
      length: 1000,
      downloaded: 0,
      progress: 0,
      createReadStream: () => new PassThrough(),
    };
    registerTorrent(magnet, [file]);
    const streamer = new TorrentStreamer();
    const dest = `${tmpdir()}${path.sep}tornedo-buffer-${Math.random().toString(16).slice(2)}`;
    const stages: string[] = [];
    try {
      const pending = streamer.serve({
        magnet,
        destination: dest,
        bufferingTimeoutMs: 5_000,
        onProgress: (stage) => {
          stages.push(stage);
        },
      });
      // The file has no bytes yet: serve must still be pending.
      let settled = false;
      void pending.then(() => (settled = true)).catch(() => (settled = true));
      await new Promise((r) => setTimeout(r, 60));
      expect(settled).toBe(false);

      // Now bytes arrive - serve should resolve without timing out.
      file.downloaded = 400;
      file.progress = 0.4;
      const result = await pending;
      expect(result.file).toBe("movie.mp4");
      expect(settled).toBe(true);
      expect(stages.length).toBeGreaterThan(0);
    } finally {
      await streamer.disposeAll();
      await rm(dest, { recursive: true, force: true });
    }
  });
});

describe("out-of-the-box configuration", () => {
  it("ships BDIX enabled by default", () => {
    expect(defaultConfig().bdixEnabled).toBe(true);
  });

  it("adds the community Kitsu addon alongside Cinemeta", () => {
    const client = new FourKHDAddonsClient([]);
    expect(client.addons.map((a) => a.addonId).sort()).toEqual(["cinemeta", "kitsu"]);
  });
});
