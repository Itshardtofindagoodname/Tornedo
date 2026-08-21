import { afterEach, describe, expect, it, vi } from "vitest";
import { parseResults, solidtorrents } from "../src/sources/solidtorrents.js";
import type { SearchContext } from "../src/model/source.js";

function ctx(): SearchContext {
  return { signal: new AbortController().signal, timeoutMs: 5000 };
}

function response(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(urlToResponse: (url: string) => Response): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => urlToResponse(url)));
}

const HASH_A = "a".repeat(40);
const HASH_B = "b".repeat(40);

function searchPage(magnets: string[]): string {
  const cards = magnets.map((m) =>
    `<div class="bg-white rounded-lg border items-start">
      <div class="flex-1">
        <h3><a href="${m}">Torrent Title</a></h3>
        <div class="items-center">
          <span>1.5 GB</span>
          <span>12/25/2024</span>
        </div>
        <div class="space-x-3">
          <span class="text-green-600"><span class="font-medium">150</span> seeders</span>
          <span class="text-red-600"><span class="font-medium">30</span> leechers</span>
        </div>
      </div>
      <div class="space-y-2">
        <a href="${m}">Download</a>
      </div>
    </div>`
  ).join("\n");
  return `<main class="mx-auto"><div class="space-y-4">${cards}</div></main>`;
}

describe("SolidTorrents adapter", () => {
  it("has correct metadata", () => {
    expect(solidtorrents.id).toBe("solidtorrents");
    expect(solidtorrents.name).toBe("SolidTorrents");
    expect(solidtorrents.groups).toContain("Movies");
    expect(solidtorrents.groups).toContain("TV");
    expect(solidtorrents.groups).toContain("Music");
    expect(solidtorrents.categories).toContain("Movie");
    expect(solidtorrents.categories).toContain("TV");
    expect(solidtorrents.categories).toContain("Music");
    expect(solidtorrents.reportsHealth).toBe(true);
    expect(solidtorrents.concurrency).toBe(1);
  });

  it("returns empty for empty query", async () => {
    const results = await solidtorrents.search("", ctx());
    expect(results).toEqual([]);
  });

  it("extracts results from HTML with direct magnets", async () => {
    stubFetch(() => response(searchPage([
      `magnet:?xt=urn:btih:${HASH_A}&dn=Dune.2021.1080p`,
      `magnet:?xt=urn:btih:${HASH_B}&dn=Inception.2010.720p`,
    ])));
    const results = await solidtorrents.search("dune", ctx());
    expect(results).toHaveLength(2);
    expect(results[0]!.infohash).toBe(HASH_A);
    expect(results[0]!.sourceId).toBe("solidtorrents");
    expect(results[0]!.magnet).toContain("urn:btih:" + HASH_A);
    expect(results[1]!.infohash).toBe(HASH_B);
  });

  it("deduplicates by infohash", async () => {
    stubFetch(() => response(searchPage([
      `magnet:?xt=urn:btih:${HASH_A}&dn=Movie.1080p`,
      `magnet:?xt=urn:btih:${HASH_A}&dn=Movie.Copy`,
    ])));
    const results = await solidtorrents.search("movie", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe(HASH_A);
  });

  it("categorizes results based on title keywords", async () => {
    stubFetch(() => response(`<div class="space-y-4"><div class="bg-white"><div class="items-start">
      <a href="magnet:?xt=urn:btih:${HASH_A}&dn=Dune">Dune 2021 BluRay 1080p</a>
    </div></div></div>`));
    const results = await solidtorrents.search("dune", ctx());
    expect(results[0]!.category).toBe("Movie");
  });

  it("falls back to Other category when no keywords match", async () => {
    stubFetch(() => response(searchPage([
      `magnet:?xt=urn:btih:${HASH_A}&dn=Some.Random.File`,
    ])));
    const results = await solidtorrents.search("random", ctx());
    expect(results[0]!.category).toBe("Other");
  });

  it("tries fallback hosts when the first host fails", async () => {
    let callCount = 0;
    stubFetch((url) => {
      callCount++;
      if (url.includes("bitsearch.to")) return response("", 500);
      return response(searchPage([`magnet:?xt=urn:btih:${HASH_A}&dn=Movie`]));
    });
    const results = await solidtorrents.search("movie", ctx());
    expect(results).toHaveLength(1);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("throws when all hosts fail", async () => {
    stubFetch(() => response("", 500));
    await expect(solidtorrents.search("test", ctx())).rejects.toThrow();
  });

  it("returns empty when no magnets found on page", async () => {
    stubFetch(() => response("<html><body>No results</body></html>"));
    const results = await solidtorrents.search("xyznonexistent", ctx());
    expect(results).toEqual([]);
  });

  it("returns empty when magnets exist but all have invalid hashes", async () => {
    stubFetch(() => response(`<html><body>magnet:?xt=urn:btih:not-a-valid-hash</body></html>`));
    const results = await solidtorrents.search("test", ctx());
    expect(results).toEqual([]);
  });

  it("skips magnet links with empty anchor text, reports parse error", async () => {
    stubFetch(() => response(`<html><body><a href="magnet:?xt=urn:btih:${HASH_A}"></a></body></html>`));
    await expect(solidtorrents.search("test", ctx())).rejects.toThrow("listing contains magnets");
  });

  it("sends sort=seeders and order=desc to the API", async () => {
    let capturedUrl = "";
    stubFetch((url) => {
      capturedUrl = url;
      return response(searchPage([]));
    });
    await solidtorrents.search("test", ctx());
    expect(capturedUrl).toContain("sortBy=seeders");
    expect(capturedUrl).toContain("order=desc");
    expect(capturedUrl).toContain("page=1");
  });

  it("encodes query properly in URL", async () => {
    let capturedUrl = "";
    stubFetch((url) => {
      capturedUrl = url;
      return response(searchPage([]));
    });
    await solidtorrents.search("breaking bad s01", ctx());
    expect(capturedUrl).toContain("q=breaking");
    expect(capturedUrl).toContain("bad");
    expect(capturedUrl).toContain("s01");
  });
});

describe("SolidTorrents parseResults", () => {
  it("parses multiple results from HTML", () => {
    const html = searchPage([
      `magnet:?xt=urn:btih:${HASH_A}&dn=Movie1`,
      `magnet:?xt=urn:btih:${HASH_B}&dn=Movie2`,
    ]);
    const results = parseResults(html);
    expect(results).toHaveLength(2);
    expect(results[0]!.infohash).toBe(HASH_A);
    expect(results[1]!.infohash).toBe(HASH_B);
  });

  it("returns empty array for HTML with no magnets", () => {
    expect(parseResults("<html><body>nothing</body></html>")).toEqual([]);
  });

  it("skips invalid infohashes", () => {
    const html = `<a href="magnet:?xt=urn:btih:not-valid">Bad</a><a href="magnet:?xt=urn:btih:${HASH_A}">Good</a>`;
    const results = parseResults(html);
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe(HASH_A);
  });

  it("handles HTML entities in magnet URIs", () => {
    const html = `<a href="magnet:?xt=urn:btih:${HASH_A}&amp;dn=Movie">Download</a>`;
    const results = parseResults(html);
    expect(results).toHaveLength(1);
    expect(results[0]!.magnet).toContain("urn:btih:" + HASH_A);
  });

  it("caps results at 20", () => {
    const magnets = Array.from({ length: 25 }, (_, i) => {
      const hash = i.toString(16).padStart(40, "0");
      return `magnet:?xt=urn:btih:${hash}&dn=Movie${i}`;
    });
    const html = searchPage(magnets);
    const results = parseResults(html);
    expect(results.length).toBeLessThanOrEqual(20);
  });

  it("extracts size from surrounding context", () => {
    const html = `<div><a href="magnet:?xt=urn:btih:${HASH_A}&dn=Movie">Download</a></div><span>2.5 GB</span>`;
    const results = parseResults(html);
    expect(results[0]!.size).toBe(2_500_000_000);
  });

  it("categorizes TV shows by episode pattern", () => {
    const html = `<a href="magnet:?xt=urn:btih:${HASH_A}&dn=Show">Show S01E05 720p</a>`;
    const results = parseResults(html);
    expect(results[0]!.category).toBe("TV");
  });

  it("categorizes music by codec keywords", () => {
    const html = `<a href="magnet:?xt=urn:btih:${HASH_A}&dn=Album">Artist Album FLAC</a>`;
    const results = parseResults(html);
    expect(results[0]!.category).toBe("Music");
  });
});

describe("SolidTorrents integration with engine", () => {
  it("is included in the source registry", async () => {
    const { SOURCES } = await import("../src/sources/registry.js");
    const ids = SOURCES.map((s) => s.id);
    expect(ids).toContain("solidtorrents");
  });

  it("is isolated when it fails - other sources still return results", async () => {
    stubFetch(() => response("", 500));
    const { SearchEngine } = await import("../src/search/engine.js");
    const { fakeSource, result } = await import("./helpers/fixtures.js");
    const engine = new SearchEngine({
      sources: [
        solidtorrents,
        fakeSource("yts", "YTS", [result({ infohash: "a".repeat(40), title: "Dune", sourceId: "yts" })]),
      ],
      isEnabled: () => true,
      defaultTimeoutMs: 2000,
      maxConcurrentSources: 4,
    });
    const summary = await engine.search({ query: "dune" }, {
      onSourceResults: () => {},
      onSourceError: () => {},
      onComplete: () => {},
    });
    expect(summary.sourcesSucceeded).toBe(1);
    expect(summary.sourcesFailed).toBe(1);
    expect(summary.totalResults).toBe(1);
  });
});
