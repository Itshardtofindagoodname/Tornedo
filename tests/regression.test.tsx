import { describe, expect, it, afterEach } from "vitest";
import { cleanup as inkCleanup, render } from "ink-testing-library";
import type { Application } from "../src/app/application.js";
import type { TorrentManager } from "../src/downloads/manager.js";
import type { TorrentItem, DownloadSummary, AddTorrentInput, RecoveryReport } from "../src/model/torrent.js";
import { SearchService } from "../src/app/search-service.js";
import { SearchEngine } from "../src/search/engine.js";
import { defaultConfig } from "../src/config/config.js";
import { fakeSource, result } from "./helpers/fixtures.js";
import { TornedoApp } from "../src/ui/App.js";
import { EventEmitter } from "node:events";

class FakeManager extends EventEmitter {
  items: TorrentItem[] = [];
  recovery: RecoveryReport | null = null;
  list(): TorrentItem[] { return this.items; }
  get(id: string): TorrentItem | null { return this.items.find((i) => i.id === id) ?? null; }
  lastRecovery(): RecoveryReport | null { return this.recovery; }
  summary(): DownloadSummary { return { active: 0, queued: 0, paused: 0, completed: 0, seeding: 0, error: 0, totalDownloadSpeed: 0, totalUploadSpeed: 0 }; }
  add(input: AddTorrentInput): TorrentItem {
    const now = Date.now();
    const item: TorrentItem = {
      id: input.infohash, infohash: input.infohash, magnet: input.magnet, name: input.name,
      category: input.category ?? null, sourceId: input.sourceId ?? null, metadata: input.metadata ?? {},
      destination: input.destination ?? "/tmp", status: "queued", progress: 0, downloaded: 0, uploaded: 0,
      size: input.size ?? 0, downloadSpeed: 0, uploadSpeed: 0, peers: 0, seeds: 0, timeRemaining: Infinity,
      priority: 0, seedEnabled: true, queuedAt: now, startedAt: null, completedAt: null, lastUpdated: now,
      error: null, files: null,
    };
    this.items.push(item);
    this.emit("update");
    return item;
  }
  pause(): void {} resume(): void {} toggleSeeding(): void {} cancel(): void {}
  setFileSelection(id: string, paths: string[]): void { const it = this.get(id); if (it) it.selectedFiles = paths; }
  openLocation(): boolean { return false; }
  async deleteFiles(): Promise<void> {}
  async remove(id: string): Promise<void> { this.items = this.items.filter((i) => i.id !== id); this.emit("update"); }
}

function makeApp(): Application {
  const engine = new SearchEngine({
    sources: [fakeSource("yts", "YTS", [result({ infohash: "aa".repeat(20), title: "Dune.2021.1080p.BluRay.x264", seeders: 50, sourceId: "yts" })])],
    isEnabled: () => true, defaultTimeoutMs: 1000, maxConcurrentSources: 2,
  });
  const searchService = new SearchService({ engine, healthSources: new Set(["yts"]), getRank: () => defaultConfig().ranking });
  let recentQueries: string[] = [];
  return {
    searchService,
    manager: new FakeManager() as unknown as TorrentManager,
    sources: [fakeSource("yts", "YTS", [])],
    healthSources: new Set(["yts"]),
    getConfig: () => defaultConfig(),
    isSourceEnabled: () => true,
    setSourceEnabled: () => {},
    updateConfig: async () => {},
    reloadConfig: async () => {},
    suspend: async () => {},
    recentSearches: () => recentQueries,
    addRecentSearch: (q: string) => { recentQueries = [q, ...recentQueries.filter((x) => x !== q)]; },
  } as unknown as Application;
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const key = (i: ReturnType<typeof render>, s: string): void => i.stdin.write(s);

afterEach(() => { inkCleanup(); });

describe("regression", () => {
  it("file list: no overlapping/skipped rows", async () => {
    const app = makeApp();
    const manager = app.manager as unknown as FakeManager;
    const realAdd = manager.add.bind(manager);
    manager.add = ((input) => {
      const item = realAdd(input);
      const files = Array.from({ length: 30 }, (_, i) => ({ path: `f${String(i + 1).padStart(2, "0")}.mkv`, length: 1_000_000_000 * (i + 1) }));
      item.fileList = files;
      return item;
    }) as FakeManager["add"];

    const instance = render(<TornedoApp app={app} />);
    await wait(30);
    key(instance, "dune");
    await wait(30);
    key(instance, "\r");
    await wait(80);
    key(instance, "\r");
    await wait(30);
    const frame = instance.lastFrame() ?? "";
    const lines = frame.split("\n");
    const fRows = lines.map((l) => l.match(/\[✓\] f(\d+)\.mkv/)?.[1]).filter(Boolean).map(Number);
    // f01 must be present, and rows must be strictly sequential (no gaps = no
    // row hidden behind another, no skips).
    expect(fRows[0]).toBe(1);
    for (let i = 1; i < fRows.length; i++) {
      expect(fRows[i]!).toBe(fRows[i - 1]! + 1);
    }
    expect(fRows.length).toBeGreaterThanOrEqual(3);
  });

  it("home history: recents + activity do not overlap the status line", async () => {
    const app = makeApp();
    for (let i = 1; i <= 8; i++) app.addRecentSearch(`some long search query number ${i} for media content`);
    const manager = app.manager as unknown as FakeManager;
    const realAdd = manager.add.bind(manager);
    manager.add = ((input) => {
      const item = realAdd(input);
      item.status = "downloading";
      item.progress = 0.5;
      item.downloadSpeed = 1_000_000;
      item.size = 2_000_000_000;
      return item;
    }) as FakeManager["add"];
    for (let i = 1; i <= 5; i++) {
      manager.add({ infohash: `${String(i).padStart(2, "0")}`.repeat(20), magnet: `magnet:${i}`, name: `Download ${i} - Some Very Long Release Title` } as AddTorrentInput);
    }
    const instance = render(<TornedoApp app={app} />);
    await wait(30);
    const frame = instance.lastFrame() ?? "";
    const lines = frame.split("\n");
    const status = lines.find((l) => l.includes("sources enabled"));
    expect(status).toBeTruthy();
    // The status line must not be merged with a download row.
    expect(status!).not.toContain("Download");
    // The recent header must be present and a recent row must not be merged
    // with a download row (overlap would put both on one line).
    const recentHeader = lines.findIndex((l) => l.includes("recent searches"));
    expect(recentHeader).toBeGreaterThan(-1);
    for (const l of lines) {
      expect(l).not.toMatch(/recent query number \d .*Download \d/);
    }
  });

  it("file list honors an existing selection when re-opening details", async () => {
    const app = makeApp();
    const manager = app.manager as unknown as FakeManager;
    const realAdd = manager.add.bind(manager);
    manager.add = ((input) => {
      const item = realAdd(input);
      item.fileList = [
        { path: "movie.mkv", length: 2_000_000_000 },
        { path: "subs/en.srt", length: 20_000 },
      ];
      return item;
    }) as FakeManager["add"];

    const instance = render(<TornedoApp app={app} />);
    await wait(30);
    key(instance, "dune");
    await wait(30);
    key(instance, "\r"); // results
    await wait(80);
    key(instance, "\r"); // details (all checked)
    await wait(30);
    key(instance, "\u001B[B"); // cursor onto subs/en.srt
    await wait(30);
    key(instance, "d"); // deselect subs
    await wait(30);
    key(instance, "\r"); // commit selection -> downloads
    await wait(30);
    // Back out of downloads to the previous view (details) re-resolves the file
    // list from the existing item, which should reflect only the chosen subset.
    key(instance, "\u001B"); // esc -> details
    await wait(60);
    const frame = instance.lastFrame() ?? "";
    expect(frame).toMatch(/\[✓\] movie\.mkv/);
    expect(frame).toMatch(/\[ \] subs\/en\.srt/);
  });
});