import { describe, expect, it } from "vitest";
import {
  normalizeInfoHash,
  buildMagnet,
  parseMagnet,
  parseInput,
  isInfoHash,
  parseTorrentBuffer,
  mergeTrackers,
  PUBLIC_TRACKERS,
} from "../src/torrent/parse.js";

const HEX = "0123456789abcdef0123456789abcdef01234567";

describe("normalizeInfoHash", () => {
  it("lowercases hex", () => {
    expect(normalizeInfoHash(HEX.toUpperCase())).toBe(HEX);
  });

  it("converts base32 to hex", () => {
    const b32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"; // a known base32 pattern
    const hex = normalizeInfoHash(b32);
    expect(hex).toMatch(/^[a-f0-9]{40}$/);
  });

  it("returns null for garbage", () => {
    expect(normalizeInfoHash("not-a-hash")).toBeNull();
    expect(normalizeInfoHash("xyz")).toBeNull();
  });
});

describe("buildMagnet", () => {
  it("builds a valid magnet", () => {
    const m = buildMagnet(HEX, "My File");
    expect(m.startsWith("magnet:?xt=urn:btih:")).toBe(true);
    expect(m).toContain("dn=My%20File");
    expect(m).toContain("&tr=");
  });

  it("deduplicates trackers", () => {
    const m = buildMagnet(HEX, "x", ["udp://a", "udp://a", "udp://b"]);
    expect((m.match(/tr=/g) ?? []).length).toBe(2);
  });
});

describe("parseMagnet / parseInput", () => {
  it("parses a magnet", () => {
    const p = parseMagnet(`magnet:?xt=urn:btih:${HEX}&dn=Interstellar.2014`);
    expect(p).not.toBeNull();
    expect(p!.infoHash).toBe(HEX);
    expect(p!.name).toBe("Interstellar.2014");
  });

  it("accepts bare infohash via parseInput", () => {
    const p = parseInput(HEX);
    expect(p).not.toBeNull();
    expect(p!.magnet).toContain(`urn:btih:${HEX}`);
  });

  it("isInfoHash detects bare hashes", () => {
    expect(isInfoHash(HEX)).toBe(true);
    expect(isInfoHash("magnet:?xt=urn:btih:x")).toBe(false);
    expect(isInfoHash("garbage")).toBe(false);
  });

  it("returns null for non-torrent input", () => {
    expect(parseInput("https://example.com/foo")).toBeNull();
  });
});

describe("mergeTrackers", () => {
  it("keeps embedded trackers first and appends fallbacks without duplicates", () => {
    const merged = mergeTrackers(
      ["udp://tracker.example:80/announce", "udp://tracker.example:80/announce"],
      PUBLIC_TRACKERS,
    );
    expect(merged[0]).toBe("udp://tracker.example:80/announce");
    expect(merged.filter((t) => t === "udp://tracker.example:80/announce")).toHaveLength(1);
    expect(merged.length).toBe(1 + PUBLIC_TRACKERS.length);
  });

  it("strips whitespace and empty entries", () => {
    expect(mergeTrackers(["  ", "udp://a", "udp://b  "], [])).toEqual(["udp://a", "udp://b"]);
  });

  it("is stable even when fallback overlaps the embedded list", () => {
    const merged = mergeTrackers([PUBLIC_TRACKERS[0]!], [PUBLIC_TRACKERS[0]!, PUBLIC_TRACKERS[1]!]);
    expect(merged).toEqual([PUBLIC_TRACKERS[0], PUBLIC_TRACKERS[1]]);
  });

  it("exports a non-empty public fallback list", () => {
    expect(PUBLIC_TRACKERS.length).toBeGreaterThan(0);
    expect(PUBLIC_TRACKERS.every((t) => /^(udp|http|https):\/\//.test(t))).toBe(true);
  });
});

describe("parseTorrentBuffer", () => {
  it("parses a minimal torrent", async () => {
    const buf = makeTorrentBuffer("sample.txt", 1000);
    const info = await parseTorrentBuffer(buf);
    expect(info).not.toBeNull();
    expect(info!.name).toBe("sample.txt");
    expect(info!.length).toBe(1000);
    expect(info!.infoHash).toMatch(/^[a-f0-9]{40}$/);
  });

  it("returns null for garbage", async () => {
    expect(await parseTorrentBuffer(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

/** Hand-rolled bencode for a minimal single-file torrent. */
function makeTorrentBuffer(fileName: string, length: number): Uint8Array {
  const info = `d6:lengthi${length}e4:name${fileName.length}:${fileName}12:piece lengthi16384e6:pieces20:${"x".repeat(20)}e`;
  const full = `d8:announce${"0:"}4:infod${info.slice(1)}ee`;
  return new TextEncoder().encode(full);
}