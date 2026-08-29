import { afterEach, describe, expect, it, vi } from "vitest";
import { search, subsplease } from "../src/sources/subsplease.js";
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

function spEntry(opts: {
  show?: string;
  episode?: string;
  releaseDate?: string;
  downloads?: unknown[];
} = {}): unknown {
  return {
    show: opts.show ?? "Jujutsu Kaisen",
    episode: opts.episode ?? "24",
    release_date: opts.releaseDate ?? "2024-03-22",
    downloads: opts.downloads ?? [
      { res: "1080", magnet: "magnet:?xt=urn:btih:" + "a".repeat(40) + "&dn=Jujutsu+Kaisen" },
      { res: "720", magnet: "magnet:?xt=urn:btih:" + "b".repeat(40) + "&dn=Jujutsu+Kaisen+720p" },
    ],
  };
}

describe("SubsPlease adapter", () => {
  it("has correct metadata", () => {
    expect(subsplease.id).toBe("subsplease");
    expect(subsplease.name).toBe("SubsPlease");
    expect(subsplease.groups).toContain("Anime");
    expect(subsplease.categories).toContain("Anime");
    expect(subsplease.reportsHealth).toBe(false);
    expect(subsplease.concurrency).toBe(1);
  });

  it("returns results for a search query", async () => {
    stubFetch(() => response({ "entry-1": spEntry() }));
    const results = await search("jujutsu kaisen", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe("a".repeat(40));
    expect(results[0]!.title).toBe("Jujutsu Kaisen - 24 [1080p]");
    expect(results[0]!.sourceId).toBe("subsplease");
    expect(results[0]!.category).toBe("Anime");
    expect(results[0]!.magnet).toContain("urn:btih:" + "a".repeat(40));
    expect(results[0]!.added).toBe(Math.floor(new Date("2024-03-22").getTime() / 1000));
  });

  it("picks best resolution (1080 over 720)", async () => {
    stubFetch(() => response({ "entry-1": spEntry() }));
    const results = await search("jujutsu", ctx());
    expect(results[0]!.title).toContain("[1080p]");
    expect(results[0]!.infohash).toBe("a".repeat(40));
  });

  it("falls back to 720 when 1080 is not available", async () => {
    stubFetch(() => response({
      "entry-1": spEntry({
        downloads: [
          { res: "720", magnet: "magnet:?xt=urn:btih:" + "b".repeat(40) },
        ],
      }),
    }));
    const results = await search("jujutsu", ctx());
    expect(results[0]!.infohash).toBe("b".repeat(40));
    expect(results[0]!.title).toContain("[720p]");
  });

  it("uses latest endpoint for empty queries", async () => {
    let capturedUrl = "";
    stubFetch((url) => {
      capturedUrl = url;
      return response({});
    });
    await search("", ctx());
    expect(capturedUrl).toContain("f=latest");
    expect(capturedUrl).not.toContain("f=search");
  });

  it("uses search endpoint for non-empty queries", async () => {
    let capturedUrl = "";
    stubFetch((url) => {
      capturedUrl = url;
      return response({});
    });
    await search("one piece", ctx());
    expect(capturedUrl).toContain("f=search");
    expect(capturedUrl).toContain("s=one+piece");
    expect(capturedUrl).toContain("tz=UTC");
  });

  it("handles multiple entries", async () => {
    stubFetch(() => response({
      "entry-1": spEntry({ show: "Show A", episode: "1" }),
      "entry-2": spEntry({ show: "Show B", episode: "5", downloads: [{ res: "1080", magnet: "magnet:?xt=urn:btih:" + "c".repeat(40) }] }),
    }));
    const results = await search("show", ctx());
    expect(results).toHaveLength(2);
  });

  it("skips entries with no magnet links", async () => {
    stubFetch(() => response({
      "entry-1": spEntry({ downloads: [] }),
      "entry-2": spEntry({ show: "Other", downloads: [{ res: "1080", magnet: "magnet:?xt=urn:btih:" + "d".repeat(40) }] }),
    }));
    const results = await search("other", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe("d".repeat(40));
  });

  it("handles entries with no downloads array", async () => {
    stubFetch(() => response({
      "entry-1": { show: "No Downloads", episode: "1" },
    }));
    const results = await search("no downloads", ctx());
    expect(results).toEqual([]);
  });

  it("handles non-object response gracefully", async () => {
    stubFetch(() => response([]));
    const results = await search("test", ctx());
    expect(results).toEqual([]);
  });

  it("extracts size from magnet xl parameter", async () => {
    stubFetch(() => response({
      "entry-1": spEntry({
        downloads: [{ res: "1080", magnet: "magnet:?xt=urn:btih:" + "a".repeat(40) + "&xl=500000000" }],
      }),
    }));
    const results = await search("test", ctx());
    expect(results[0]!.size).toBe(500_000_000);
  });

  it("handles missing episode number", async () => {
    stubFetch(() => response({
      "entry-1": {
        show: "Jujutsu Kaisen",
        release_date: "2024-03-22",
        downloads: [
          { res: "1080", magnet: "magnet:?xt=urn:btih:" + "a".repeat(40) + "&dn=Jujutsu+Kaisen" },
        ],
      },
    }));
    const results = await search("test", ctx());
    expect(results[0]!.title).toBe("Jujutsu Kaisen [1080p]");
  });

  it("handles missing release_date", async () => {
    stubFetch(() => response({
      "entry-1": {
        show: "Jujutsu Kaisen",
        episode: "24",
        downloads: [
          { res: "1080", magnet: "magnet:?xt=urn:btih:" + "a".repeat(40) + "&dn=Jujutsu+Kaisen" },
        ],
      },
    }));
    const results = await search("test", ctx());
    expect(results[0]!.added).toBeUndefined();
  });

  it("skips entries with invalid magnet URIs", async () => {
    stubFetch(() => response({
      "entry-1": spEntry({ downloads: [{ res: "1080", magnet: "not-a-magnet" }] }),
    }));
    const results = await search("test", ctx());
    expect(results).toEqual([]);
  });
});
