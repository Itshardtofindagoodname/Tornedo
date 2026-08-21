import { afterEach, describe, expect, it, vi } from "vitest";
import { search, eztv } from "../src/sources/eztv.js";
import type { SearchContext } from "../src/model/source.js";

function ctx(): SearchContext {
  return { signal: new AbortController().signal, timeoutMs: 5000 };
}

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(urlToResponse: (url: string) => Response): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => urlToResponse(url)));
}

function eztvTorrent(opts: {
  title?: string;
  filename?: string;
  hash?: string;
  magnet_url?: string;
  seeds?: number;
  peers?: number;
  size_bytes?: string | number;
  date_released_unix?: number;
} = {}): unknown {
  return {
    title: opts.title ?? "Breaking Bad S01E01 720p",
    filename: opts.filename ?? "breaking.bad.s01e01.720p.mkv",
    hash: opts.hash ?? "a".repeat(40),
    magnet_url: opts.magnet_url ?? `magnet:?xt=urn:btih:${opts.hash ?? "a".repeat(40)}&dn=Breaking+Bad`,
    seeds: opts.seeds ?? 100,
    peers: opts.peers ?? 20,
    size_bytes: opts.size_bytes ?? 350_000_000,
    date_released_unix: opts.date_released_unix ?? 1609459200,
  };
}

describe("EZTV adapter", () => {
  it("has correct metadata", () => {
    expect(eztv.id).toBe("eztv");
    expect(eztv.name).toBe("EZTV");
    expect(eztv.groups).toContain("TV");
    expect(eztv.categories).toContain("TV");
    expect(eztv.reportsHealth).toBe(true);
    expect(eztv.concurrency).toBe(1);
  });

  it("returns all results for an empty query", async () => {
    stubFetch(() => response({ torrents: [eztvTorrent(), eztvTorrent({ hash: "b".repeat(40), title: "Breaking Bad S01E02" })] }));
    const results = await search("", ctx());
    expect(results).toHaveLength(2);
    expect(results[0]!.infohash).toBe("a".repeat(40));
    expect(results[0]!.sourceId).toBe("eztv");
    expect(results[0]!.category).toBe("TV");
  });

  it("filters results client-side by query tokens", async () => {
    stubFetch(() => response({
      torrents: [
        eztvTorrent({ title: "Breaking Bad S01E01 720p" }),
        eztvTorrent({ hash: "b".repeat(40), title: "Game of Thrones S01E01" }),
        eztvTorrent({ hash: "c".repeat(40), title: "Breaking Bad S01E02 1080p" }),
      ],
    }));
    const results = await search("breaking bad", ctx());
    expect(results).toHaveLength(2);
    expect(results.every((r) => r.title.toLowerCase().includes("breaking"))).toBe(true);
  });

  it("uses magnet_url from the API when available", async () => {
    const magnet = "magnet:?xt=urn:btih:" + "a".repeat(40) + "&dn=Custom&tr=http://tracker.example.com/announce";
    stubFetch(() => response({ torrents: [eztvTorrent({ magnet_url: magnet })] }));
    const results = await search("", ctx());
    expect(results[0]!.magnet).toBe(magnet);
  });

  it("builds magnet from hash when magnet_url is missing", async () => {
    stubFetch(() => response({ torrents: [eztvTorrent({ magnet_url: undefined })] }));
    const results = await search("", ctx());
    expect(results[0]!.magnet).toContain("urn:btih:" + "a".repeat(40));
    expect(results[0]!.magnet).toContain("dn=");
  });

  it("skips entries with invalid hashes", async () => {
    stubFetch(() => response({
      torrents: [
        eztvTorrent({ hash: "" }),
        eztvTorrent({ hash: "not-a-hash" }),
        eztvTorrent({ hash: "c".repeat(40) }),
      ],
    }));
    const results = await search("", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe("c".repeat(40));
  });

  it("skips entries with no title", async () => {
    stubFetch(() => response({
      torrents: [
        eztvTorrent({ title: "", filename: "" }),
        eztvTorrent({ title: "Valid Show" }),
      ],
    }));
    const results = await search("", ctx());
    expect(results).toHaveLength(1);
  });

  it("handles size_bytes as string or number", async () => {
    stubFetch(() => response({
      torrents: [
        eztvTorrent({ hash: "a".repeat(40), size_bytes: 500_000_000 }),
        { title: "Test2", hash: "b".repeat(40), magnet_url: `magnet:?xt=urn:btih:${"b".repeat(40)}`, size_bytes: "700000000" },
      ],
    }));
    const results = await search("", ctx());
    expect(results[0]!.size).toBe(500_000_000);
    expect(results[1]!.size).toBe(700_000_000);
  });

  it("throws on invalid API response", async () => {
    stubFetch(() => response(null));
    await expect(search("", ctx())).rejects.toThrow();
  });

  it("throws when torrents array is missing", async () => {
    stubFetch(() => response({}));
    await expect(search("", ctx())).rejects.toThrow();
  });

  it("handles API returning empty torrents array", async () => {
    stubFetch(() => response({ torrents: [] }));
    const results = await search("anything", ctx());
    expect(results).toEqual([]);
  });

  it("returns results without optional fields when missing", async () => {
    stubFetch(() => response({
      torrents: [{ hash: "a".repeat(40), title: "Test" }],
    }));
    const results = await search("", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.size).toBeUndefined();
    expect(results[0]!.seeders).toBeUndefined();
    expect(results[0]!.leechers).toBeUndefined();
    expect(results[0]!.added).toBeUndefined();
  });

  it("sends limit=100 and page=1 to the API", async () => {
    let capturedUrl = "";
    stubFetch((url) => {
      capturedUrl = url;
      return response({ torrents: [] });
    });
    await search("", ctx());
    expect(capturedUrl).toContain("limit=100");
    expect(capturedUrl).toContain("page=1");
  });

  it("multi-word queries require all tokens to match", async () => {
    stubFetch(() => response({
      torrents: [
        eztvTorrent({ title: "Breaking Bad S01E01" }),
        eztvTorrent({ hash: "b".repeat(40), title: "Bad Boys" }),
      ],
    }));
    const results = await search("breaking bad", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Breaking Bad S01E01");
  });
});
