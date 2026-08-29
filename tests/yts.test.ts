import { afterEach, describe, expect, it, vi } from "vitest";
import { search, yts } from "../src/sources/yts.js";
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

function ytsResponse(movies: unknown[], movieCount = 1): unknown {
  return { data: { movie_count: movieCount, movies } };
}

function ytsMovie(opts: {
  title?: string;
  titleLong?: string;
  torrents?: unknown[];
  dateUploaded?: number;
} = {}): unknown {
  return {
    title: opts.title ?? "Dune",
    title_long: opts.titleLong ?? "Dune (2021)",
    date_uploaded_unix: opts.dateUploaded ?? 1633000000,
    torrents: opts.torrents ?? [
      {
        hash: "a".repeat(40),
        quality: "1080p",
        type: "BluRay",
        size_bytes: 2_000_000_000,
        seeds: 500,
        peers: 50,
      },
    ],
  };
}

describe("YTS adapter", () => {
  it("has correct metadata", () => {
    expect(yts.id).toBe("yts");
    expect(yts.name).toBe("YTS");
    expect(yts.groups).toContain("Movies");
    expect(yts.categories).toContain("Movie");
    expect(yts.reportsHealth).toBe(true);
    expect(yts.concurrency).toBe(1);
  });

  it("returns normalized results from the YTS API", async () => {
    stubFetch(() => response(ytsResponse([ytsMovie()])));
    const results = await search("dune", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe("a".repeat(40));
    expect(results[0]!.title).toBe("Dune (2021) [1080p BluRay]");
    expect(results[0]!.size).toBe(2_000_000_000);
    expect(results[0]!.seeders).toBe(500);
    expect(results[0]!.leechers).toBe(50);
    expect(results[0]!.sourceId).toBe("yts");
    expect(results[0]!.category).toBe("Movie");
    expect(results[0]!.magnet).toContain("urn:btih:" + "a".repeat(40));
    expect(results[0]!.added).toBe(1633000000);
  });

  it("handles multiple torrents per movie", async () => {
    stubFetch(() => response(ytsResponse([ytsMovie({
      torrents: [
        { hash: "a".repeat(40), quality: "720p", type: "WEBRip", size_bytes: 800_000_000, seeds: 200, peers: 20 },
        { hash: "b".repeat(40), quality: "1080p", type: "WEBRip", size_bytes: 1_500_000_000, seeds: 300, peers: 30 },
        { hash: "c".repeat(40), quality: "2160p", type: "BluRay", size_bytes: 4_000_000_000, seeds: 100, peers: 10 },
      ],
    })])));
    const results = await search("dune", ctx());
    expect(results).toHaveLength(3);
    expect(results.map((r) => r.title)).toEqual([
      "Dune (2021) [720p WEBRip]",
      "Dune (2021) [1080p WEBRip]",
      "Dune (2021) [2160p BluRay]",
    ]);
  });

  it("returns empty results for no movies", async () => {
    stubFetch(() => response(ytsResponse([], 0)));
    const results = await search("nonexistent query xyz", ctx());
    expect(results).toEqual([]);
  });

  it("skips entries with invalid/missing hashes", async () => {
    stubFetch(() => response(ytsResponse([ytsMovie({
      torrents: [
        { hash: "", quality: "1080p", type: "BluRay", size_bytes: 1e9, seeds: 10, peers: 1 },
        { quality: "720p", type: "WEBRip", size_bytes: 5e8, seeds: 5, peers: 1 },  // no hash
        { hash: "d".repeat(40), quality: "1080p", type: "BluRay", size_bytes: 1e9, seeds: 10, peers: 1 },
      ],
    })])));
    const results = await search("dune", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe("d".repeat(40));
  });

  it("tries fallback hosts when the first host fails", async () => {
    let callCount = 0;
    stubFetch((url) => {
      callCount++;
      if (url.includes("yts.mx") || url.includes("yts.am")) return response({ error: "unavailable" }, 500);
      return response(ytsResponse([ytsMovie()]));
    });
    const results = await search("dune", ctx());
    expect(results).toHaveLength(1);
    expect(callCount).toBeGreaterThanOrEqual(3);
  });

  it("throws when all hosts fail", async () => {
    stubFetch(() => response({ error: "unavailable" }, 500));
    await expect(search("dune", ctx())).rejects.toThrow();
  });

  it("uses sort_by=date_added for empty queries", async () => {
    let capturedUrl = "";
    stubFetch((url) => {
      capturedUrl = url;
      return response(ytsResponse([]));
    });
    await search("", ctx());
    expect(capturedUrl).toContain("sort_by=date_added");
    expect(capturedUrl).not.toContain("query_term");
  });

  it("sends query_term for non-empty queries", async () => {
    let capturedUrl = "";
    stubFetch((url) => {
      capturedUrl = url;
      return response(ytsResponse([]));
    });
    await search("interstellar", ctx());
    expect(capturedUrl).toContain("query_term=interstellar");
  });

  it("handles movies with no torrent entries", async () => {
    stubFetch(() => response(ytsResponse([ytsMovie({ torrents: [] })])));
    const results = await search("dune", ctx());
    expect(results).toEqual([]);
  });

  it("uses title_long fallback to title", async () => {
    stubFetch(() => response(ytsResponse([{
      title: "Dune",
      date_uploaded_unix: 1633000000,
      torrents: [{ hash: "a".repeat(40), quality: "1080p", type: "BluRay", size_bytes: 1e9, seeds: 10, peers: 1 }],
    }])));
    const results = await search("dune", ctx());
    expect(results[0]!.title).toBe("Dune [1080p BluRay]");
  });

  it("handles missing optional fields gracefully", async () => {
    stubFetch(() => response(ytsResponse([{
      title: "Test",
      torrents: [{ hash: "a".repeat(40) }],
    }])));
    const results = await search("test", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Test");
    expect(results[0]!.size).toBeUndefined();
    expect(results[0]!.seeders).toBeUndefined();
    expect(results[0]!.leechers).toBeUndefined();
  });
});
