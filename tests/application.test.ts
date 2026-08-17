import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { Application, MAX_RECENT_SEARCHES } from "../src/app/application.js";
import { defaultConfig } from "../src/config/config.js";

describe("Application", () => {
  it("creates with in-memory DB and fresh config", async () => {
    const app = await Application.create({ memoryDb: true, freshConfig: true });
    expect(app.getConfig().maxActiveDownloads).toBe(defaultConfig().maxActiveDownloads);
    expect(app.manager).toBeDefined();
    expect(app.searchService).toBeDefined();
    expect(app.healthSources.size).toBeGreaterThan(0);
    await app.suspend();
  });

  it("suspend is idempotent", async () => {
    const app = await Application.create({ memoryDb: true, freshConfig: true });
    await app.suspend();
    await app.suspend();
  });

  it("sources are enabled by default and toggleable", async () => {
    const app = await Application.create({ memoryDb: true, freshConfig: true });
    expect(app.isSourceEnabled("yts")).toBe(true);
    app.setSourceEnabled("yts", false);
    expect(app.isSourceEnabled("yts")).toBe(false);
    await app.suspend();
  });

  it("updateConfig applies manager config", async () => {
    const app = await Application.create({ memoryDb: true, freshConfig: true });
    await app.updateConfig({ maxActiveDownloads: 9 });
    expect(app.getConfig().maxActiveDownloads).toBe(9);
    await app.suspend();
  });

  it("persists recent search history across restarts", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "tornedo-history-"));
    const prev = process.env.TORNEDO_STATE_DIR;
    process.env.TORNEDO_STATE_DIR = dir;
    try {
      const first = await Application.create({ freshConfig: true });
      expect(first.recentSearches()).toEqual([]);
      first.addRecentSearch("dune");
      first.addRecentSearch("inception");
      first.addRecentSearch("dune"); // dedupes and moves to the front
      expect([...first.recentSearches()]).toEqual(["dune", "inception"]);
      await first.suspend();

      const second = await Application.create({ freshConfig: true });
      expect([...second.recentSearches()]).toEqual(["dune", "inception"]);
      for (let i = 0; i < MAX_RECENT_SEARCHES + 3; i++) second.addRecentSearch(`q${i}`);
      expect(second.recentSearches().length).toBeLessThanOrEqual(MAX_RECENT_SEARCHES);
      await second.suspend();
    } finally {
      if (prev === undefined) delete process.env.TORNEDO_STATE_DIR;
      else process.env.TORNEDO_STATE_DIR = prev;
      rmSync(dir, { recursive: true, force: true });
    }
  });
});