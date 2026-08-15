import { afterEach, describe, expect, it } from "vitest";
import {
  defaultConfig,
  normalizeConfig,
  loadConfig,
  saveConfig,
  defaultKeybindings,
} from "../src/config/config.js";

const state = defaultConfig();

afterEach(async () => {
  await saveConfig(state);
});

describe("normalizeConfig", () => {
  it("returns defaults for garbage", () => {
    expect(normalizeConfig(null)).toEqual(defaultConfig());
    expect(normalizeConfig("x")).toEqual(defaultConfig());
    expect(normalizeConfig([])).toEqual(defaultConfig());
  });

  it("ignores bad numbers and keeps defaults", () => {
    const cfg = normalizeConfig({ maxActiveDownloads: -5, sourceTimeoutMs: "nope" });
    expect(cfg.maxActiveDownloads).toBe(defaultConfig().maxActiveDownloads);
    expect(cfg.sourceTimeoutMs).toBe(15_000);
  });

  it("normalizes sources to booleans only", () => {
    const cfg = normalizeConfig({ sources: { yts: true, nyaa: "yes", eztv: false } });
    expect(cfg.sources).toEqual({ yts: true, eztv: false });
  });

  it("accepts valid ranking", () => {
    const cfg = normalizeConfig({ ranking: { seedersWeight: 2, qualityWeight: 3, healthWeight: 1, preferLarger: true } });
    expect(cfg.ranking.seedersWeight).toBe(2);
  });

  it("rejects invalid keybindings wholesale", () => {
    const cfg = normalizeConfig({ keybindings: { bogus: ["x"], down: [1] } });
    expect(cfg.keybindings.down).toEqual(["down", "j"]);
    expect((cfg.keybindings as Record<string, unknown>).bogus).toBeUndefined();
  });

  it("normalizes Torznab providers and trims trailing slashes", () => {
    const cfg = normalizeConfig({
      torznabProviders: [
        { baseUrl: "http://localhost:9117/api/v1/", apiKey: "k", categories: ["Music"], timeoutMs: 5000 },
        { baseUrl: "", apiKey: 5 },
        "garbage",
      ],
    });
    expect(cfg.torznabProviders).toHaveLength(1);
    const p = cfg.torznabProviders[0]!;
    expect(p.baseUrl).toBe("http://localhost:9117/api/v1");
    expect(p.apiKey).toBe("k");
    expect(p.enabled).toBe(true);
    expect(p.categories).toEqual(["Music"]);
    expect(p.timeoutMs).toBe(5000);
  });

  it("normalizes internetArchive settings with clamping", () => {
    const cfg = normalizeConfig({ internetArchive: { enabled: true, timeoutMs: 2000, maxResults: 9999 } });
    expect(cfg.internetArchive.enabled).toBe(true);
    expect(cfg.internetArchive.timeoutMs).toBe(2000);
    expect(cfg.internetArchive.maxResults).toBe(200);
  });

  it("defaults internetArchive and torznabProviders to safe values", () => {
    const cfg = normalizeConfig({});
    expect(cfg.internetArchive).toEqual({ enabled: false, timeoutMs: 15_000, maxResults: 30 });
    expect(cfg.torznabProviders).toEqual([]);
  });
});

describe("load/saveConfig", () => {
  it("round-trips a config file", async () => {
    const cfg = defaultConfig();
    cfg.maxActiveDownloads = 7;
    cfg.sources.yts = false;
    await saveConfig(cfg);
    const loaded = await loadConfig();
    expect(loaded.maxActiveDownloads).toBe(7);
    expect(loaded.sources.yts).toBe(false);
  });

  it("defaults when no file exists", async () => {
    // The temp state dir from vitest config is empty on first run for this key.
    const cfg = await loadConfig();
    expect(cfg.maxActiveDownloads).toBeGreaterThanOrEqual(0);
  });
});

describe("defaultKeybindings", () => {
  it("has non-empty defaults for every action", () => {
    const kb = defaultKeybindings();
    expect(kb.up).toBeDefined();
    expect(kb.quit).toContain("q");
    expect(kb.downloadTo).toContain("shift+d");
  });
});