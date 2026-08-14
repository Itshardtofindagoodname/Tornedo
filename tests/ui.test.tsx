/**
 * Smoke tests for the Ink-based terminal UI: render the full app against a fake
 * app (fake search engine + fake manager), drive it with keypresses, and assert
 * on the frames Ink writes. No TTY and no network required.
 */
import { describe, expect, it, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import { cleanup as inkCleanup, render } from "ink-testing-library";
import type { Application } from "../src/app/application.js";
import type { TorrentManager } from "../src/downloads/manager.js";
import type { TorrentItem, DownloadSummary, AddTorrentInput } from "../src/model/torrent.js";
import { SearchService } from "../src/app/search-service.js";
import { SearchEngine } from "../src/search/engine.js";
import { defaultConfig } from "../src/config/config.js";
import { fakeSource, result } from "./helpers/fixtures.js";
import { TornedoApp } from "../src/ui/App.js";

class FakeManager extends EventEmitter {
  items: TorrentItem[] = [];

  list(): TorrentItem[] {
    return this.items;
  }

  summary(): DownloadSummary {
    return {
      active: 0,
      queued: 0,
      paused: 0,
      completed: 0,
      seeding: 0,
      error: 0,
      totalDownloadSpeed: 0,
      totalUploadSpeed: 0,
    };
  }

  add(input: AddTorrentInput): TorrentItem {
    const now = Date.now();
    const item: TorrentItem = {
      id: input.infohash,
      infohash: input.infohash,
      magnet: input.magnet,
      name: input.name,
      category: input.category ?? null,
      sourceId: input.sourceId ?? null,
      metadata: input.metadata ?? {},
      destination: input.destination ?? "/tmp",
      status: "queued",
      progress: 0,
      downloaded: 0,
      uploaded: 0,
      size: input.size ?? 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      peers: 0,
      seeds: 0,
      timeRemaining: Infinity,
      priority: 0,
      seedEnabled: input.seedEnabled ?? true,
      queuedAt: now,
      startedAt: null,
      completedAt: null,
      lastUpdated: now,
      error: null,
      files: null,
    };
    this.items.push(item);
    this.emit("update");
    return item;
  }

  pause(): void {}
  resume(): void {}
  toggleSeeding(): void {}
  async remove(id: string): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id);
    this.emit("update");
  }
}

function makeApp(): Application {
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

  return {
    searchService,
    manager: new FakeManager() as unknown as TorrentManager,
    sources: [],
    healthSources: new Set(["yts"]),
    getConfig: () => defaultConfig(),
    isSourceEnabled: () => true,
    setSourceEnabled: () => {},
    updateConfig: async () => {},
    reloadConfig: async () => {},
    suspend: async () => {},
  } as unknown as Application;
}

function type(instance: ReturnType<typeof render>, text: string): void {
  instance.stdin.write(text);
}

function key(instance: ReturnType<typeof render>, sequence: string): void {
  instance.stdin.write(sequence);
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

afterEach(() => {
  inkCleanup();
});

describe("TUI", () => {
  it("renders the home screen with wordmark, search box and hints", async () => {
    const instance = render(<TornedoApp app={makeApp()} />);
    await wait(30);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("tornedo");
    expect(frame).toContain("federated torrent search");
    expect(frame).toContain("search");
    expect(frame).toContain("downloads");
    expect(frame).toContain("help");
  });

  it("types a query, searches, and lists ranked results", async () => {
    const instance = render(<TornedoApp app={makeApp()} />);
    await wait(30);
    type(instance, "dune");
    await wait(30);
    key(instance, "\r");
    await wait(80);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("Dune");
    expect(frame).toContain("unique results");
  });

  it("navigates between downloads, help and back", async () => {
    const instance = render(<TornedoApp app={makeApp()} />);
    await wait(30);
    type(instance, "dune");
    await wait(30);
    key(instance, "\r");
    await wait(80);

    key(instance, "v");
    await wait(30);
    expect(instance.lastFrame() ?? "").toContain("Downloads");

    key(instance, "?");
    await wait(30);
    expect(instance.lastFrame() ?? "").toContain("Keybindings");

    key(instance, "?");
    await wait(30);
    expect(instance.lastFrame() ?? "").toContain("Downloads");
  });

  it("queues a download from the results list", async () => {
    const app = makeApp();
    const instance = render(<TornedoApp app={app} />);
    await wait(30);
    type(instance, "dune");
    await wait(30);
    key(instance, "\r");
    await wait(80);

    key(instance, "\r");
    await wait(30);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toContain("Queued");
    expect((app.manager as unknown as FakeManager).items.length).toBe(1);
  });
});
