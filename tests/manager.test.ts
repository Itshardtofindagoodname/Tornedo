import { describe, expect, it } from "vitest";
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
    expect(item.status).toBe("starting");
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
    expect(manager.get(HASH_A)!.status).toBe("starting");

    const statuses: string[] = [];
    manager.on("statusChanged", (_it, _f, to) => statuses.push(to));
    manager.pause(HASH_A);
    expect(manager.get(HASH_A)!.status).toBe("paused");
    expect(statuses).toContain("paused");

    manager.resume(HASH_A);
    // Resume requeues and the scheduler immediately restarts it.
    expect(manager.get(HASH_A)!.status).toBe("starting");

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
});