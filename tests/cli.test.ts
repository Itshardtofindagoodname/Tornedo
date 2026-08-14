import { describe, expect, it } from "vitest";
import type { Application } from "../src/app/application.js";
import { SearchEngine } from "../src/search/engine.js";
import { SearchService } from "../src/app/search-service.js";
import { defaultConfig } from "../src/config/config.js";
import type { CliArgs } from "../src/cli/args.js";
import { defaultArgs } from "../src/cli/args.js";
import { CliContext } from "../src/cli/context.js";
import { runSearch } from "../src/cli/commands/search.js";
import { runDownloads } from "../src/cli/commands/downloads.js";
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
});
