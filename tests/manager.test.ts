import { describe, expect, it, vi } from "vitest";
import { defaultConfig } from "../src/config/config.js";
import { openInMemory } from "../src/database/db.js";
import { TorrentStore } from "../src/database/store.js";
import { TorrentManager } from "../src/downloads/manager.js";
import type { TorrentClient } from "../src/torrent/client.js";
import { FakeClient, ManualClient } from "./helpers/fixtures.js";

const HASH_A = "aa".repeat(20);
const HASH_B = "bb".repeat(20);

function makeManager(client: TorrentClient, overrides: Partial<ReturnType<typeof defaultConfig>> = {}) {
  const store = new TorrentStore(openInMemory());
  const cfg = { ...defaultConfig(), ...overrides };
  const manager = new TorrentManager({
    client,
    store,
    getConfig: () => cfg,
  });
  return { manager, store };
}

async function flush(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("TorrentManager", () => {
  it("queues then completes to seeding when seedEnabled", async () => {
    const client = new FakeClient();
    const { manager } = makeManager(client, { seedAfterComplete: true });
    await manager.init();
    const item = manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
    expect(item.status).toBe("waiting_metadata");
    await flush();
    expect(manager.get(HASH_A)!.status).toBe("seeding");
    await manager.suspend();
  });

  it("completes without seeding when seedEnabled is false", async () => {
    const client = new FakeClient();
    const { manager } = makeManager(client, { seedAfterComplete: false });
    await manager.init();
    manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
    await flush();
    const item = manager.get(HASH_A)!;
    expect(item.status).toBe("completed");
    expect(client.removed.has(HASH_A)).toBe(true);
    await manager.suspend();
  });

  it("respects maxActiveDownloads cap", async () => {
    const client = new FakeClient();
    const { manager } = makeManager(client, { maxActiveDownloads: 1 });
    await manager.init();
    manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
    manager.add({ infohash: HASH_B, magnet: `magnet:?xt=urn:btih:${HASH_B}`, name: "B" });
    // First completes instantly; then second starts and completes.
    await flush();
    await flush();
    expect(client.adds.has(HASH_A)).toBe(true);
    expect(client.adds.has(HASH_B)).toBe(true);
    expect(manager.get(HASH_A)!.status).toBe("seeding");
    expect(manager.get(HASH_B)!.status).toBe("seeding");
    await manager.suspend();
  });

  it("pauses and resumes", async () => {
    const client = new ManualClient();
    const { manager } = makeManager(client, { seedAfterComplete: false });
    await manager.init();
    manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
    await flush();
    expect(manager.get(HASH_A)!.status).toBe("waiting_metadata");

    const statuses: string[] = [];
    manager.on("statusChanged", (_it, _f, to) => statuses.push(to));
    manager.pause(HASH_A);
    expect(manager.get(HASH_A)!.status).toBe("paused");
    expect(statuses).toContain("paused");

    manager.resume(HASH_A);
    // Resume requeues and the scheduler immediately restarts it.
    expect(manager.get(HASH_A)!.status).toBe("waiting_metadata");

    client.fireDone(HASH_A);
    await flush();
    expect(manager.get(HASH_A)!.status).toBe("completed");
    await manager.suspend();
  });

  it("removes items and clears the store", async () => {
    const client = new FakeClient();
    const { manager, store } = makeManager(client, { seedAfterComplete: false });
    await manager.init();
    manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
    await flush();
    await manager.remove(HASH_A);
    expect(manager.get(HASH_A)).toBeNull();
    expect(store.get(HASH_A)).toBeNull();
    await manager.suspend();
  });

  it("fails when the client throws on add", async () => {
    const throwing: TorrentClient = {
      kind: "throwing",
      add() {
        throw new Error("engine down");
      },
      pause: () => {},
      resume: () => {},
      remove: () => {},
      get: () => null,
      retryMetadata: () => {},
      stats: () => ({ downloadSpeed: 0, uploadSpeed: 0, active: 0 }),
      setSpeedLimits: () => {},
      listenPort: () => null,
      destroy: () => {},
    };
    const { manager } = makeManager(throwing);
    await manager.init();
    manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
    expect(manager.get(HASH_A)!.status).toBe("error");
    expect(manager.get(HASH_A)!.error).toBe("engine down");
    await manager.suspend();
  });

  it("summarizes states", async () => {
    const client = new FakeClient();
    const { manager } = makeManager(client, { seedAfterComplete: false });
    await manager.init();
    manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
    await flush();
    const summary = manager.summary();
    expect(summary.completed).toBe(1);
    expect(summary.active).toBe(0);
    await manager.suspend();
  });

  it("persists state and restores it", async () => {
    const client = new FakeClient();
    const { manager, store } = makeManager(client, { seedAfterComplete: false });
    await manager.init();
    manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "Persisted" });
    await flush();
    expect(store.get(HASH_A)).not.toBeNull();
    await manager.suspend();

    // A fresh manager over the same store sees the persisted item.
    const revived = new TorrentManager({ client, store, getConfig: () => defaultConfig() });
    await revived.init();
    const item = revived.get(HASH_A);
    expect(item).not.toBeNull();
    expect(item!.name).toBe("Persisted");
    await revived.suspend();
  });

  describe("metadata timeout and retry", () => {
    it("injects the fallback public-tracker list into every add", async () => {
      const client = new ManualClient();
      const { manager } = makeManager(client);
      await manager.init();
      manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
      const added = client.adds.get(HASH_A)!;
      expect(added.announce).toBeDefined();
      expect(added.announce!.length).toBeGreaterThan(0);
      await manager.suspend();
    });

    it("marks metadata timed out and schedules a bounded-backoff retry", async () => {
      vi.useFakeTimers();
      try {
        const client = new ManualClient();
        const { manager } = makeManager(client, { seedAfterComplete: false });
        await manager.init();
        manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
        // Metadata never arrives; keep the engine stats non-ready so the item
        // stays in waiting_metadata.
        client.setStats(HASH_A, { ready: false, total: 0, progress: 0, peers: 0, downloadSpeed: 0 });

        await vi.advanceTimersByTimeAsync(61_000);
        const item = manager.get(HASH_A)!;
        expect(item.diagnostics!.metadata).toBe("timeout");
        expect(item.diagnostics!.metadataRetries).toBe(1);
        expect(client.retried.has(HASH_A)).toBe(true);
        expect(item.diagnostics!.nextRetry).toBeGreaterThan(Date.now());

        // Second window: attempt 1 → nextRetry is ~120s away.
        await vi.advanceTimersByTimeAsync(121_000);
        expect(manager.get(HASH_A)!.diagnostics!.metadataRetries).toBe(2);
        expect(client.retried.has(HASH_A)).toBe(true);
        await manager.suspend();
      } finally {
        vi.useRealTimers();
      }
    });

    it("never fails the item on metadata timeout (recoverable state)", async () => {
      vi.useFakeTimers();
      try {
        const client = new ManualClient();
        const { manager } = makeManager(client, { seedAfterComplete: false });
        await manager.init();
        manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
        client.setStats(HASH_A, { ready: false, total: 0, progress: 0, peers: 0, downloadSpeed: 0 });
        await vi.advanceTimersByTimeAsync(200_000);
        const item = manager.get(HASH_A)!;
        expect(item.status).toBe("waiting_metadata");
        expect(item.error).toBeNull();
        await manager.suspend();
      } finally {
        vi.useRealTimers();
      }
    });

    it("transitions to downloading with size populated once metadata arrives", async () => {
      const client = new ManualClient();
      const { manager } = makeManager(client, { seedAfterComplete: false });
      await manager.init();
      manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
      client.fireMetadata(HASH_A, { name: "Album 2026", total: 123456 });
      const item = manager.get(HASH_A)!;
      expect(item.status).toBe("downloading");
      expect(item.size).toBe(123456);
      expect(item.diagnostics!.metadata).toBe("received");
      await manager.suspend();
    });
  });

  describe("stalled detection", () => {
    it("marks a metadata-known download stalled after sustained zero activity and reverts on activity", async () => {
      vi.useFakeTimers();
      try {
        const client = new ManualClient();
        const { manager } = makeManager(client, { seedAfterComplete: false });
        await manager.init();
        manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
        expect(manager.get(HASH_A)!.status).toBe("waiting_metadata");

        // Default stats report ready:true → the first tick flips to downloading.
        await vi.advanceTimersByTimeAsync(1_000);
        expect(manager.get(HASH_A)!.status).toBe("downloading");

        // Metadata known, but no peers and no speed for > STALL_THRESHOLD.
        client.setStats(HASH_A, { ready: true, total: 100, progress: 0, peers: 0, downloadSpeed: 0 });
        await vi.advanceTimersByTimeAsync(31_000);
        expect(manager.get(HASH_A)!.status).toBe("stalled");

        // Activity resumes → back to downloading.
        client.setStats(HASH_A, { progress: 0.5, downloadSpeed: 100 });
        await vi.advanceTimersByTimeAsync(1_000);
        expect(manager.get(HASH_A)!.status).toBe("downloading");
        await manager.suspend();
      } finally {
        vi.useRealTimers();
      }
    });

    it("counts stalled items as active and lets them complete", async () => {
      vi.useFakeTimers();
      try {
        const client = new ManualClient();
        const { manager } = makeManager(client, { seedAfterComplete: false });
        await manager.init();
        manager.add({ infohash: HASH_A, magnet: `magnet:?xt=urn:btih:${HASH_A}`, name: "A" });
        await vi.advanceTimersByTimeAsync(1_000);
        client.setStats(HASH_A, { ready: true, total: 100, progress: 0, peers: 0, downloadSpeed: 0 });
        await vi.advanceTimersByTimeAsync(31_000);
        expect(manager.get(HASH_A)!.status).toBe("stalled");
        expect(manager.summary().active).toBe(1);

        client.fireDone(HASH_A);
        expect(manager.get(HASH_A)!.status).toBe("completed");
        await manager.suspend();
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
