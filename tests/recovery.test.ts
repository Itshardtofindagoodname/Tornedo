import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/config.js";
import { openInMemory } from "../src/database/db.js";
import { TorrentStore } from "../src/database/store.js";
import { TorrentManager } from "../src/downloads/manager.js";
import type { RecoveryReport } from "../src/model/torrent.js";
import { FakeClient, ManualClient } from "./helpers/fixtures.js";

const HASH_A = "aa".repeat(20);

describe("crash recovery", () => {
  it("reconciles interrupted downloads and reports a recovery report", async () => {
    vi.useFakeTimers();
    try {
      const store = new TorrentStore(openInMemory());
      const cfg = { ...defaultConfig(), seedAfterComplete: false };
      const client = new ManualClient();

      // First run: start a download that is mid-flight, then "crash" by
      // abandoning it without a clean suspend (run marker stays set).
      const first = new TorrentManager({ client, store, getConfig: () => cfg });
      await first.init();
      first.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "Big File" });
      client.fireMetadata(HASH_A, { name: "Big File", total: 100 });
      client.setStats(HASH_A, { ready: true, total: 100, progress: 0.4, downloadSpeed: 10 });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(first.get(HASH_A)!.status).toBe("downloading");
      // Persist the mid-flight row but do NOT clear the run marker.
      first.persistSync();
      expect(store.hasRunMarker()).toBe(true);

      const recovered: RecoveryReport[] = [];
      const second = new TorrentManager({ client: new FakeClient(), store, getConfig: () => cfg });
      second.on("recovered", (r) => recovered.push(r));
      await second.init();

      expect(recovered.length).toBe(1);
      expect(recovered[0]!.resumed.length).toBeGreaterThan(0);
      expect(recovered[0]!.resumed[0]).toContain("Big File");
      expect(second.lastRecovery()).toBe(recovered[0]);
      // The interrupted item survives in the manager and stays resumable.
      expect(second.get(HASH_A)).not.toBeNull();

      await second.suspend();
      expect(store.hasRunMarker()).toBe(false);
    } finally {
      vi.useRealTimers();
    }
  });

  it("marks a fully-downloaded-but-interrupted item as complete", async () => {
    vi.useFakeTimers();
    try {
      const store = new TorrentStore(openInMemory());
      const cfg = { ...defaultConfig(), seedAfterComplete: false };
      const client = new ManualClient();

      const first = new TorrentManager({ client, store, getConfig: () => cfg });
      await first.init();
      first.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "Done But Crashed" });
      client.fireMetadata(HASH_A, { name: "Done But Crashed", total: 100 });
      client.setStats(HASH_A, { ready: true, total: 100, progress: 1, downloadSpeed: 0 });
      await vi.advanceTimersByTimeAsync(1_000);
      first.persistSync();

      const recovered: RecoveryReport[] = [];
      const second = new TorrentManager({ client: new FakeClient(), store, getConfig: () => cfg });
      second.on("recovered", (r) => recovered.push(r));
      await second.init();

      expect(recovered[0]!.completed.length).toBe(1);
      expect(second.get(HASH_A)!.status).toBe("completed");
      expect(second.get(HASH_A)!.progress).toBe(1);
      await second.suspend();
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not emit a recovery report on a clean shutdown", async () => {
    const store = new TorrentStore(openInMemory());
    const manager = new TorrentManager({ client: new FakeClient(), store, getConfig: () => defaultConfig() });
    await manager.init();
    const recovered: RecoveryReport[] = [];
    manager.on("recovered", (r) => recovered.push(r));
    await manager.suspend();
    expect(recovered.length).toBe(0);
    expect(manager.lastRecovery()).toBeNull();
  });

  it("resumes a cancelled (stopped) item", async () => {
    const store = new TorrentStore(openInMemory());
    const cfg = { ...defaultConfig(), seedAfterComplete: false };
    const manager = new TorrentManager({ client: new ManualClient(), store, getConfig: () => cfg });
    await manager.init();
    manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
    expect(manager.get(HASH_A)!.status).toBe("waiting_metadata");

    manager.cancel(HASH_A);
    expect(manager.get(HASH_A)!.status).toBe("stopped");

    manager.resume(HASH_A);
    expect(manager.get(HASH_A)!.status).toBe("waiting_metadata");
    await manager.suspend();
  });
});