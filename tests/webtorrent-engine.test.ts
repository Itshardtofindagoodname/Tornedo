/**
 * Isolated torrent-engine integration test. Uses the REAL WebTorrent client
 * against a well-known public torrent whose metadata has no embedded trackers:
 * if metadata resolves, it proves the fallback public-tracker list is being
 * injected (the root cause that left real downloads stuck at 0 B with a cold
 * DHT). No external index site (FitGirl/YTS/Nyaa) is involved.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { TorrentMeta } from "../src/model/torrent.js";
import { PUBLIC_TRACKERS } from "../src/torrent/parse.js";
import { WebTorrentClient } from "../src/torrent/webtorrent.js";

// Big Buck Bunny (public, well-seeded): bare magnet, deliberately NO `tr=`
// params — discovery must rely on the injected fallback trackers.
const BBB_BARE = "magnet:?xt=urn:btih:dd8255ecdc7ca55fb0bbf81323d87062db1f6d1c&dn=Big+Buck+Bunny";

let client: WebTorrentClient;
let dest: string;

beforeAll(() => {
  dest = mkdtempSync(join(tmpdir(), "tornedo-engine-"));
  client = new WebTorrentClient({ announce: [...PUBLIC_TRACKERS] });
});

afterAll(() => {
  client.remove("bbb");
  client.destroy();
  rmSync(dest, { recursive: true, force: true });
});

describe("WebTorrentClient engine (network)", () => {
  it(
    "resolves metadata for a bare public torrent via the injected fallback trackers",
    async () => {
      const announced: string[] = [];
      const meta: TorrentMeta = await new Promise<TorrentMeta>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error("metadata timeout after 75s")), 75_000);
        client.add(
          { id: "bbb", source: BBB_BARE, destination: dest, announce: [...PUBLIC_TRACKERS] },
          {
            onMetadata: (_id, m) => {
              clearTimeout(timer);
              resolve(m);
            },
            onDone: () => {},
            onError: (_id, message) => {
              clearTimeout(timer);
              reject(new Error(message));
            },
            onWarning: () => {},
            onDiagnostics: (_id, patch) => {
              if (Array.isArray(patch.trackerUrls)) announced.push(...patch.trackerUrls);
            },
          },
        );
      });

      expect(meta.name).toMatch(/Big Buck Bunny/i);
      expect(meta.total).toBeGreaterThan(0);
      expect(meta.files).toBeGreaterThan(0);
      // The fallback list reached the engine's announce set.
      expect(announced.length).toBeGreaterThan(0);
      expect(announced).toContain(PUBLIC_TRACKERS[0]);
    },
    90_000,
  );
});