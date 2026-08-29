/**
 * Persistence throughput: better-sqlite3 upsert + read hot loop.
 */
import { bench, describe } from "vitest";
import { openInMemory } from "../src/database/db.js";
import { TorrentStore } from "../src/database/store.js";
import type { TorrentItem } from "../src/model/torrent.js";

function makeItem(infohash: string): TorrentItem {
  return {
    id: infohash,
    infohash,
    magnet: `magnet:?xt=urn:btih:${infohash}`,
    name: `Torrent ${infohash}`,
    category: "Movie",
    sourceId: null,
    metadata: { quality: "1080p" },
    destination: "/tmp",
    status: "downloading",
    progress: 0.5,
    downloaded: 512,
    uploaded: 128,
    size: 1024,
    downloadSpeed: 1000,
    uploadSpeed: 500,
    peers: 3,
    seeds: 4,
    timeRemaining: 60_000,
    priority: 0,
    seedEnabled: true,
    queuedAt: Date.now(),
    startedAt: Date.now(),
    completedAt: null,
    lastUpdated: Date.now(),
    error: null,
    files: 3,
  };
}

const ITEMS = Array.from({ length: 200 }, (_, i) => makeItem(`${i}`.padStart(40, "0")));

describe("TorrentStore", () => {
  bench("upsert 200 items", () => {
    const store = new TorrentStore(openInMemory());
    for (const it of ITEMS) store.upsert(it);
  });

  bench("upsert + get hot loop (200)", () => {
    const store = new TorrentStore(openInMemory());
    for (const it of ITEMS) store.upsert(it);
    for (const it of ITEMS) store.get(it.id);
  });

  bench("transactional batch insert (200)", () => {
    const store = new TorrentStore(openInMemory());
    store.transaction(() => {
      for (const it of ITEMS) store.upsert(it);
    });
  });
});
