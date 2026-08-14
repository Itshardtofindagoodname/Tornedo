import { describe, expect, it } from "vitest";
import { Application } from "../src/app/application.js";
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
});