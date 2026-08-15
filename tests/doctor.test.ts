import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openInMemory } from "../src/database/db.js";
import { TorrentStore } from "../src/database/store.js";
import { TorrentManager } from "../src/downloads/manager.js";
import { runDoctor } from "../src/diagnostics/doctor.js";
import { defaultConfig } from "../src/config/config.js";
import type { Application } from "../src/app/application.js";
import type { TorrentClient } from "../src/torrent/client.js";
import type { SearchEngine } from "../src/search/engine.js";
import type { SearchService } from "../src/app/search-service.js";
import { FakeClient } from "./helpers/fixtures.js";

const PREV_STATE = process.env.TORNEDO_STATE_DIR;

beforeEach(() => {
  // Point the config file check at an isolated, empty state dir so it never
  // reads whatever other tests wrote into the shared temp state dir.
  process.env.TORNEDO_STATE_DIR = mkdtempSync(path.join(tmpdir(), "tornedo-doctor-state-"));
});

afterEach(() => {
  if (PREV_STATE === undefined) delete process.env.TORNEDO_STATE_DIR;
  else process.env.TORNEDO_STATE_DIR = PREV_STATE;
});

function fakeClient(): TorrentClient {
  return {
    kind: "fake",
    add: () => {},
    pause: () => {},
    resume: () => {},
    remove: () => {},
    get: () => null,
    retryMetadata: () => {},
    stats: () => ({ downloadSpeed: 0, uploadSpeed: 0, active: 0 }),
    setSpeedLimits: () => {},
    listenPort: () => 6881,
    destroy: () => {},
  };
}

function makeApp(): Application {
  const downloadDir = mkdtempSync(path.join(tmpdir(), "tornedo-doctor-"));
  const cfg = { ...defaultConfig(), downloadDir };
  const store = new TorrentStore(openInMemory());
  const manager = new TorrentManager({ client: new FakeClient(), store, getConfig: () => cfg });
  void manager;
  return {
    getConfig: () => cfg,
    db: { db: openInMemory() },
    store,
    manager,
    sources: [],
    healthSources: new Set(),
    isSourceEnabled: () => true,
    setSourceEnabled: () => {},
    updateConfig: async () => {},
    reloadConfig: async () => {},
    suspend: async () => {},
    searchEngine: null as unknown as SearchEngine,
    searchService: null as unknown as SearchService,
    getClient: () => fakeClient(),
  } as unknown as Application;
}

describe("runDoctor", () => {
  it("returns a well-formed report without throwing", async () => {
    const report = await runDoctor(makeApp());
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThanOrEqual(8);
    for (const c of report.checks) {
      expect(typeof c.id).toBe("string");
      expect(typeof c.detail).toBe("string");
      expect(typeof c.ok).toBe("boolean");
    }
  });

  it("marks healthy when nothing is wrong", async () => {
    const report = await runDoctor(makeApp());
    // Network and sources depend on the environment/registry; skip them.
    const envDependent = new Set(["network", "sources"]);
    const hardFails = report.checks.filter((c) => !c.ok && !c.warning && !envDependent.has(c.id));
    expect(hardFails.length).toBe(0);
  });

  it("flags no sources enabled as a problem", async () => {
    const app = makeApp();
    (app as unknown as { sources: unknown[] }).sources = [];
    const report = await runDoctor(app);
    const sources = report.checks.find((c) => c.id === "sources");
    expect(sources).toBeDefined();
    expect(sources!.ok).toBe(false);
  });

  it("renders a report without throwing", async () => {
    const { renderDoctor } = await import("../src/diagnostics/doctor.js");
    const report = await runDoctor(makeApp());
    const text = renderDoctor(report);
    expect(text.length).toBeGreaterThan(10);
  });
});