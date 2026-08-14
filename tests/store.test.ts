import { describe, expect, it } from "vitest";
import { openInMemory } from "../src/database/db.js";
import { TorrentStore } from "../src/database/store.js";
import type { TorrentItem } from "../src/model/torrent.js";

function makeItem(infohash: string, overrides: Partial<TorrentItem> = {}): TorrentItem {
  const id = infohash;
  return {
    id,
    infohash,
    magnet: `magnet:?xt=urn:btih:${infohash}`,
    name: `Torrent ${id}`,
    category: "Movie",
    sourceId: null,
    metadata: { quality: "1080p" },
    destination: "/tmp",
    status: "queued",
    progress: 0,
    downloaded: 0,
    uploaded: 0,
    size: 1000,
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
    ...overrides,
  };
}

describe("TorrentStore", () => {
  it("upserts and reads back items including metadata", () => {
    const store = new TorrentStore(openInMemory());
    const item = makeItem("aa".repeat(20), { seedEnabled: false });
    store.upsert(item);
    const got = store.get(item.id)!;
    expect(got.name).toBe(item.name);
    expect(got.metadata.quality).toBe("1080p");
    expect(got.seedEnabled).toBe(false);
  });

  it("upsert overwrites by id", () => {
    const store = new TorrentStore(openInMemory());
    const a = makeItem("aa".repeat(20), { status: "queued" });
    store.upsert(a);
    store.upsert({ ...a, status: "downloading", progress: 0.5 });
    expect(store.list().length).toBe(1);
    expect(store.get(a.id)!.status).toBe("downloading");
  });

  it("lists by status", () => {
    const store = new TorrentStore(openInMemory());
    store.upsert(makeItem("aa".repeat(20), { status: "queued" }));
    store.upsert(makeItem("bb".repeat(20), { status: "downloading" }));
    store.upsert(makeItem("cc".repeat(20), { status: "downloading" }));
    expect(store.listByStatus("downloading").length).toBe(2);
    expect(store.listByStatus("queued").length).toBe(1);
  });

  it("counts by status", () => {
    const store = new TorrentStore(openInMemory());
    store.upsert(makeItem("aa".repeat(20), { status: "queued" }));
    store.upsert(makeItem("bb".repeat(20), { status: "error" }));
    const counts = store.countByStatus();
    expect(counts.queued).toBe(1);
    expect(counts.error).toBe(1);
  });

  it("deletes items", () => {
    const store = new TorrentStore(openInMemory());
    store.upsert(makeItem("aa".repeat(20)));
    store.upsert(makeItem("bb".repeat(20)));
    store.delete("aa".repeat(20));
    expect(store.list().length).toBe(1);
  });

  it("clears finished states", () => {
    const store = new TorrentStore(openInMemory());
    store.upsert(makeItem("aa".repeat(20), { status: "completed" }));
    store.upsert(makeItem("bb".repeat(20), { status: "seeding" }));
    store.upsert(makeItem("cc".repeat(20), { status: "queued" }));
    store.clearCompleted();
    expect(store.get("aa".repeat(20))).toBeNull();
    expect(store.get("bb".repeat(20))).toBeNull();
    expect(store.get("cc".repeat(20))).not.toBeNull();
  });

  it("transactions roll back on throw", () => {
    const store = new TorrentStore(openInMemory());
    store.upsert(makeItem("aa".repeat(20)));
    expect(() =>
      store.transaction(() => {
        store.upsert(makeItem("bb".repeat(20)));
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(store.list().length).toBe(1);
  });

  it("stores torrent cache blobs", () => {
    const store = new TorrentStore(openInMemory());
    store.saveCache("aa".repeat(20), new Uint8Array([1, 2, 3]));
    expect(Array.from(store.loadCache("aa".repeat(20))!)).toEqual([1, 2, 3]);
    expect(store.loadCache("nope")).toBeNull();
  });

  it("stores meta values", () => {
    const store = new TorrentStore(openInMemory());
    store.metaSet("theme", "dark");
    expect(store.metaGet("theme")).toBe("dark");
  });
});

describe("watch record helpers", () => {
  it("set, get, list, prune", () => {
    const store = new TorrentStore(openInMemory());
    const path = "/data/file.torrent";
    store.watchSet(path, { mtime: 1, size: 2, hash: "h" });
    expect(store.watchGet(path)).toEqual({ mtime: 1, size: 2, hash: "h" });
    expect(store.watchList().length).toBe(1);
    const pruned = store.watchPrune(new Set(["/data/other.torrent"]));
    expect(pruned).toBe(1);
    expect(store.watchGet(path)).toBeNull();
  });
});
