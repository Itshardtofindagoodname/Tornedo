import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openInMemory } from "../src/database/db.js";
import { TorrentStore } from "../src/database/store.js";
import { WatchService, type WatchAdd } from "../src/watch/watcher.js";
import { buildMagnet } from "../src/torrent/parse.js";

describe("WatchService", () => {
  let dir: string;
  let store: TorrentStore;
  let added: WatchAdd[];
  let errors: string[];

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), "tornedo-watch-"));
    store = new TorrentStore(openInMemory());
    added = [];
    errors = [];
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  function makeService() {
    return new WatchService({
      store,
      intervalMs: 50,
      onAdd: (a) => added.push(a),
      onError: (m) => errors.push(m),
    });
  }

  it("picks up a .torrent file", async () => {
    const info = makeTorrentBencode();
    await writeFile(path.join(dir, "movie.torrent"), Buffer.from(info));
    const svc = makeService();
    svc.watch(dir);
    await svc.scanOnce();
    expect(added.length).toBe(1);
    expect(added[0]!.kind).toBe("torrent");
    expect(added[0]!.infoHash).toMatch(/^[a-f0-9]{40}$/);
  });

  it("does not re-add an unchanged file", async () => {
    const info = makeTorrentBencode();
    const file = path.join(dir, "movie.torrent");
    await writeFile(file, Buffer.from(info));
    const svc = makeService();
    svc.watch(dir);
    await svc.scanOnce();
    await svc.scanOnce();
    await svc.scanOnce();
    expect(added.length).toBe(1);
  });

  it("re-adds after a file changes", async () => {
    const file = path.join(dir, "a.txt");
    const magnet = buildMagnet("aa".repeat(20), "First");
    await writeFile(file, magnet);
    const svc = makeService();
    svc.watch(dir);
    await svc.scanOnce();
    expect(added.length).toBe(1);

    await writeFile(file, buildMagnet("bb".repeat(20), "Second"));
    await new Promise((r) => setTimeout(r, 20));
    await svc.scanOnce();
    expect(added.length).toBe(2);
  });

  it("re-processes a deleted-then-recreated file", async () => {
    const file = path.join(dir, "a.txt");
    await writeFile(file, buildMagnet("aa".repeat(20), "X"));
    const svc = makeService();
    svc.watch(dir);
    await svc.scanOnce();
    expect(added.length).toBe(1);

    await rm(file);
    await svc.scanOnce();
    await writeFile(file, buildMagnet("aa".repeat(20), "X"));
    await new Promise((r) => setTimeout(r, 20));
    await svc.scanOnce();
    expect(added.length).toBe(2);
  });

  it("extracts multiple magnets from one text file", async () => {
    const text = `${buildMagnet("aa".repeat(20), "A")}\n${buildMagnet("bb".repeat(20), "B")}`;
    await writeFile(path.join(dir, "list.txt"), text);
    const svc = makeService();
    svc.watch(dir);
    await svc.scanOnce();
    expect(added.length).toBe(2);
  });

  it("watches nothing when unwatched", async () => {
    await writeFile(path.join(dir, "a.txt"), buildMagnet("aa".repeat(20), "X"));
    const svc = makeService();
    await svc.scanOnce();
    expect(added.length).toBe(0);
  });
});

/** Minimal single-file torrent bencode (duplicated from parse tests). */
function makeTorrentBencode(): Uint8Array {
  const info = "d6:lengthi1000e4:name8:file.txt12:piece lengthi16384e6:pieces20:xxxxxxxxxxxxxxxxxxxxe";
  const full = `d8:announce0:4:infod${info.slice(1)}ee`;
  return new TextEncoder().encode(full);
}