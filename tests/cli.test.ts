import { describe, expect, it, vi, afterEach } from "vitest";
import type { Application } from "../src/app/application.js";
import { SearchEngine } from "../src/search/engine.js";
import { SearchService } from "../src/app/search-service.js";
import { defaultConfig } from "../src/config/config.js";
import type { CliArgs } from "../src/cli/args.js";
import { defaultArgs } from "../src/cli/args.js";
import { CliContext } from "../src/cli/context.js";
import { runSearch } from "../src/cli/commands/search.js";
import { runDownloads } from "../src/cli/commands/downloads.js";
import { runHistory } from "../src/cli/commands/history.js";
import { runTv } from "../src/cli/commands/tv.js";
import { runAddons } from "../src/cli/commands/addons.js";
import type { TvPlaylist } from "../src/stream/tv.js";
import type { InstalledAddon } from "../src/stream/addons.js";
import type { StreamCatalogItem } from "../src/stream/models.js";
import { fakeSource, result, FakeClient } from "./helpers/fixtures.js";
import type { TorrentManager } from "../src/downloads/manager.js";

function makeCtx(args: Partial<CliArgs> = {}): { ctx: CliContext; out: string[] } {
  const engine = new SearchEngine({
    sources: [
      fakeSource("yts", "YTS", [
        result({ infohash: "aa".repeat(20), title: "Dune.2021.1080p.BluRay.x264", seeders: 50, sourceId: "yts" }),
        result({ infohash: "bb".repeat(20), title: "Dune.2021.720p.WEBRip", seeders: 5, sourceId: "yts" }),
      ]),
    ],
    isEnabled: () => true,
    defaultTimeoutMs: 1000,
    maxConcurrentSources: 2,
  });
  const searchService = new SearchService({
    engine,
    healthSources: new Set(["yts"]),
    getRank: () => defaultConfig().ranking,
  });

  const client = new FakeClient();
  const manager = {
    add: (input: { infohash: string; magnet: string; name: string }) => ({
      id: input.infohash,
      infohash: input.infohash,
      magnet: input.magnet,
      name: input.name,
      category: null,
      sourceId: null,
      metadata: {},
      destination: "/tmp",
      status: "queued",
      progress: 0,
      downloaded: 0,
      uploaded: 0,
      size: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      seeds: 0,
      timeRemaining: Infinity,
      priority: 0,
      seedEnabled: true,
      queuedAt: Date.now(),
      startedAt: null,
      completedAt: null,
      lastUpdated: Date.now(),
      error: null,
      files: null,
    }),
    list: () => [],
    get: () => null,
    summary: () => ({
      active: 0,
      queued: 0,
      paused: 0,
      completed: 0,
      seeding: 0,
      error: 0,
      totalDownloadSpeed: 0,
      totalUploadSpeed: 0,
    }),
  } as unknown as TorrentManager;

  const app = {
    searchService,
    manager,
    getConfig: () => defaultConfig(),
    isSourceEnabled: () => true,
    updateConfig: async () => {},
    suspend: async () => {},
    store: null,
    recentSearches: () => ["dune", "inception"],
    clearRecentSearches: () => {},
  } as unknown as Application;

  const full = { ...defaultArgs(), ...args };
  const ctx = new CliContext(app, full);
  const out: string[] = [];
  ctx.stdout = (s) => out.push(s);
  // JSON mode routes human output to stderr; mimic that so `out` stays JSON-only.
  ctx.log = (s) => {
    if (!full.json) out.push(s);
  };
  ctx.jsonOut = (v) => out.push(JSON.stringify(v));
  return { ctx, out };
}

describe("CLI commands", () => {
  it("search --json emits a single JSON document on stdout", async () => {
    const { ctx, out } = makeCtx({ command: "search", positional: ["dune"], json: true });
    const count = await runSearch(ctx, "dune");
    expect(count).toBe(2);
    const parsed = JSON.parse(out.join("\n")) as {
      query: string;
      results: { title: string; category: string; score: number }[];
      sources: Record<string, { status: string; results: number }>;
    };
    expect(parsed.query).toBe("dune");
    expect(parsed.results.length).toBe(2);
    expect(parsed.results[0]!.title).toContain("Dune");
    expect(parsed.results[0]!.category).toBe("Movie");
    expect(parsed.results[0]!.score).toBeGreaterThan(0);
    expect(parsed.sources.yts!.status).toBe("ok");
    expect(parsed.sources.yts!.results).toBe(2);
  });

  it("search without --json prints a human table", async () => {
    const { ctx, out } = makeCtx({ command: "search", positional: ["dune"], json: false });
    await runSearch(ctx, "dune");
    const joined = out.join("\n");
    expect(joined).toContain("unique releases");
    expect(joined).toContain("Dune");
  });

  it("downloads --json emits an array", async () => {
    const { ctx, out } = makeCtx({ command: "downloads", json: true });
    await runDownloads(ctx);
    const parsed = JSON.parse(out.join("\n"));
    expect(Array.isArray(parsed)).toBe(true);
  });

  it("history lists recent searches", async () => {
    const { ctx, out } = makeCtx({ command: "history" });
    const count = await runHistory(ctx);
    expect(count).toBe(2);
    expect(out.join("\n")).toContain("dune");
    expect(out.join("\n")).toContain("inception");
  });

  it("history --clear wipes them and reports cleared", async () => {
    const cleared: string[] = [];
    const { ctx, out } = makeCtx({ command: "history", clear: true });
    ctx.app.clearRecentSearches = () => cleared.push("cleared");
    const count = await runHistory(ctx);
    expect(count).toBe(0);
    expect(cleared).toEqual(["cleared"]);
    expect(out.join("\n")).toContain("cleared");
  });
});

describe("tv command", () => {
  function makeTvCtx(args: Partial<CliArgs> = {}): { ctx: CliContext; out: string[]; playlists: TvPlaylist[] } {
    const playlists: TvPlaylist[] = [];
    const full = { ...defaultArgs(), ...args };
    const app = {
      streamTvPlaylists: async () => [...playlists],
      setStreamTvPlaylists: async (list: TvPlaylist[]) => {
        playlists.splice(0, playlists.length, ...list);
      },
      streams: {
        tvPlaylistCount: 1,
        searchTv: async (q: string): Promise<StreamCatalogItem[]> => {
          const all: StreamCatalogItem[] = [
            {
              provider: "tv",
              id: "demo://bbcone",
              title: "BBC One HD",
              mediaType: "tv",
              extra: { group: "News", streamUrl: "http://x/1.m3u8" },
            },
          ];
          return q === "" ? all : all.filter((i) => i.title.toLowerCase().includes(q.toLowerCase()));
        },
      },
      getConfig: () => defaultConfig(),
      suspend: async () => {},
    } as unknown as Application;

    const ctx = new CliContext(app, full);
    const out: string[] = [];
    ctx.stdout = (s) => out.push(s);
    ctx.log = (s) => {
      if (!full.json) out.push(s);
    };
    ctx.err = (s) => {
      if (!full.json) out.push(s);
    };
    ctx.jsonOut = (v) => out.push(JSON.stringify(v));
    return { ctx, out, playlists };
  }

  it("lists configured playlists", async () => {
    const { ctx, out, playlists } = makeTvCtx({ command: "tv" });
    playlists.push({ name: "iptv", url: "https://x/pl.m3u8" });
    await runTv(ctx, []);
    expect(out.join("\n")).toContain("iptv");
    expect(out.join("\n")).toContain("https://x/pl.m3u8");
  });

  it("adds a playlist and reports the new total", async () => {
    const { ctx, out, playlists } = makeTvCtx({ command: "tv" });
    await runTv(ctx, ["add", "https://iptv.example/pl.m3u8", "iptv"]);
    expect(playlists).toHaveLength(1);
    expect(playlists[0]!.name).toBe("iptv");
    expect(out.join("\n")).toContain("Added live-TV playlist");
  });

  it("refuses obviously invalid playlist urls", async () => {
    const { ctx, out, playlists } = makeTvCtx({ command: "tv" });
    const code = await runTv(ctx, ["add", "not-a-url"]);
    expect(code).toBe(1);
    expect(playlists).toHaveLength(0);
    expect(out.join("\n")).toContain("not an http(s) URL");
  });

  it("removes matching playlists", async () => {
    const { ctx, playlists } = makeTvCtx({ command: "tv" });
    playlists.push({ name: "iptv", url: "https://x/pl.m3u8" });
    await runTv(ctx, ["remove", "iptv"]);
    expect(playlists).toHaveLength(0);
  });

  it("searches live channels", async () => {
    const { ctx, out } = makeTvCtx({ command: "tv" });
    const count = await runTv(ctx, ["search", "bbc"]);
    expect(count).toBe(1);
    expect(out.join("\n")).toContain("BBC One HD");
  });

  it("test probes a playlist file", async () => {
    const { mkdtemp, mkdir, rm, writeFile } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const path = await import("node:path");
    const dir = await mkdtemp(path.join(tmpdir(), "tornedo-tvcli-"));
    const file = path.join(dir, "p.m3u");
    await writeFile(file, "#EXTM3U\n#EXTINF:-1 group-title=\"News\",BBC One HD\nhttp://x/1.m3u8\n", "utf8");
    try {
      const { ctx, out } = makeTvCtx({ command: "tv" });
      const count = await runTv(ctx, ["test", file]);
      expect(count).toBe(1);
      expect(out.join("\n")).toContain("Loaded 1 channels");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});

describe("addons command", () => {
  function makeAddonsCtx(args: Partial<CliArgs> = {}): { ctx: CliContext; out: string[]; addons: InstalledAddon[] } {
    const addons: InstalledAddon[] = [];
    const full = { ...defaultArgs(), ...args };
    const app = {
      setAddons: async (list: InstalledAddon[]) => {
        addons.splice(0, addons.length, ...list);
      },
      streams: {
        activeAddons: { addons },
      },
      suspend: async () => {},
    } as unknown as Application;

    const ctx = new CliContext(app, full);
    const out: string[] = [];
    ctx.stdout = (s) => out.push(s);
    ctx.log = (s) => {
      if (!full.json) out.push(s);
    };
    ctx.err = (s) => {
      if (!full.json) out.push(s);
    };
    ctx.jsonOut = (v) => out.push(JSON.stringify(v));
    return { ctx, out, addons };
  }

  function manifestResponse(body: unknown): Response {
    return { ok: true, status: 200, text: async () => JSON.stringify(body) } as unknown as Response;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("lists installed addons with their stream capability", async () => {
    const { ctx, out, addons } = makeAddonsCtx({ command: "addons" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        if (url.endsWith("/manifest.json")) {
          return manifestResponse({ id: "peerflix", name: "Peerflix", resources: ["stream"] });
        }
        return { ok: false, status: 404, text: async () => "" } as unknown as Response;
      }),
    );
    addons.push({ baseUrl: "https://peerflix.example", transportUrl: "https://peerflix.example", addonId: "peerflix" });

    await runAddons(ctx, []);
    const joined = out.join("\n");
    expect(joined).toContain("peerflix");
    expect(joined).toContain("streams: yes");
  });

  it("installs a valid addon after validating its manifest", async () => {
    const { ctx, out, addons } = makeAddonsCtx({ command: "addons" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        if (url.endsWith("/manifest.json")) {
          return manifestResponse({ id: "com.torrentio", name: "Torrentio", resources: ["stream", "meta"] });
        }
        return { ok: false, status: 404, text: async () => "" } as unknown as Response;
      }),
    );

    const code = await runAddons(ctx, ["add", "https://torrentio.example/manifest.json"]);
    expect(code).toBe(0);
    expect(addons).toHaveLength(1);
    expect(addons[0]!.baseUrl).toBe("https://torrentio.example");
    expect(out.join("\n")).toContain("Installed addon");
    expect(out.join("\n")).toContain("provides streams");
  });

  it("rejects non-url addon input", async () => {
    const { ctx, out, addons } = makeAddonsCtx({ command: "addons" });
    const code = await runAddons(ctx, ["add", "not-a-url"]);
    expect(code).toBe(1);
    expect(addons).toHaveLength(0);
    expect(out.join("\n")).toContain("tornedo addons add <url>");
  });

  it("refuses to install the same addon twice", async () => {
    const { ctx, out, addons } = makeAddonsCtx({ command: "addons" });
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: Parameters<typeof fetch>[0]) => {
        const url = String(input);
        if (url.endsWith("/manifest.json")) {
          return manifestResponse({ id: "cinemeta", name: "Cinemeta", resources: ["catalog", "meta"] });
        }
        return { ok: false, status: 404, text: async () => "" } as unknown as Response;
      }),
    );
    await runAddons(ctx, ["add", "https://v3-cinemeta.strem.io"]);
    const code = await runAddons(ctx, ["add", "https://v3-cinemeta.strem.io/"]);
    expect(code).toBe(1);
    expect(addons).toHaveLength(1);
    expect(out.join("\n")).toContain("already installed");
  });

  it("removes matching addons", async () => {
    const { ctx, addons } = makeAddonsCtx({ command: "addons" });
    addons.push(
      { baseUrl: "https://a.example", transportUrl: "https://a.example", addonId: "addon-a" },
      { baseUrl: "https://b.example", transportUrl: "https://b.example", addonId: "addon-b" },
    );
    const code = await runAddons(ctx, ["remove", "addon-a"]);
    expect(code).toBe(0);
    expect(addons).toHaveLength(1);
    expect(addons[0]!.addonId).toBe("addon-b");
  });

  it("clears every installed addon", async () => {
    const { ctx, addons } = makeAddonsCtx({ command: "addons" });
    addons.push({ baseUrl: "https://a.example", transportUrl: "https://a.example", addonId: "addon-a" });
    const code = await runAddons(ctx, ["clear"]);
    expect(code).toBe(0);
    expect(addons).toHaveLength(0);
  });
});
