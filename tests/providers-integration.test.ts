import { afterEach, describe, expect, it, vi } from "vitest";
import { SearchEngine } from "../src/search/engine.js";
import { buildReleases } from "../src/results/pipeline.js";
import { defaultRankContext } from "../src/results/rank.js";
import { dedupeByInfohash } from "../src/results/dedupe.js";
import { normalizeResult } from "../src/media/normalize.js";
import type { SourceAdapter } from "../src/model/source.js";
import type { SearchResult } from "../src/model/search.js";
import { fakeSource, failingSource, result } from "./helpers/fixtures.js";
import { SOURCES } from "../src/sources/registry.js";

const HEALTH = new Set(["yts"]);
const ctx = defaultRankContext(HEALTH);

function makeEngine(sources: SourceAdapter[]) {
  return new SearchEngine({
    sources,
    isEnabled: () => true,
    defaultTimeoutMs: 2000,
    maxConcurrentSources: 8,
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(urlToResponse: (url: string) => Response): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => urlToResponse(url)));
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

function htmlResponse(html: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(html),
  } as unknown as Response;
}

describe("Provider isolation: one broken source must not affect others", () => {
  it("aggregates results from healthy sources when one source throws", async () => {
    const engine = makeEngine([
      fakeSource("yts", "YTS", [
        result({ infohash: "a".repeat(40), title: "Dune.2021.1080p", seeders: 500, sourceId: "yts" }),
      ]),
      failingSource("broken", "Broken", new Error("connection refused")),
      fakeSource("tpb", "TPB", [
        result({ infohash: "b".repeat(40), title: "Dune.2021.720p", seeders: 100, sourceId: "tpb" }),
      ]),
    ]);
    const summary = await engine.search({ query: "dune" }, {
      onSourceResults: () => {},
      onSourceError: () => {},
      onComplete: () => {},
    });
    expect(summary.sourcesSucceeded).toBe(2);
    expect(summary.sourcesFailed).toBe(1);
    expect(summary.totalResults).toBe(2);
  });

  it("deduplicates across healthy sources", async () => {
    const engine = makeEngine([
      fakeSource("yts", "YTS", [
        result({ infohash: "a".repeat(40), title: "Dune.2021.1080p", seeders: 500, sourceId: "yts" }),
      ]),
      fakeSource("tpb", "TPB", [
        result({ infohash: "a".repeat(40), title: "Dune.2021.1080p.BluRay", seeders: 600, sourceId: "tpb" }),
        result({ infohash: "b".repeat(40), title: "Dune.2021.720p", seeders: 100, sourceId: "tpb" }),
      ]),
    ]);
    const { summary, releases } = await searchAndBuild(engine, "dune");
    expect(summary.totalResults).toBe(3);
    expect(releases.length).toBe(2); // deduplicated
    const dune1080 = releases.find((r) => r.infohash === "a".repeat(40))!;
    expect(dune1080.sources).toContain("yts");
    expect(dune1080.sources).toContain("tpb");
  });
});

describe("Real provider integration with mocked HTTP", () => {
  const HASH_A = "a".repeat(40);
  const HASH_B = "b".repeat(40);

  it("YTS returns results from API response", async () => {
    stubFetch(() => jsonResponse({
      data: {
        movie_count: 1,
        movies: [{
          title: "Dune",
          title_long: "Dune (2021)",
          date_uploaded_unix: 1633000000,
          torrents: [{
            hash: HASH_A,
            quality: "1080p",
            type: "BluRay",
            size_bytes: 2_000_000_000,
            seeds: 500,
            peers: 50,
          }],
        }],
      },
    }));
    const { summary, releases } = await searchAndBuild(
      makeEngine([SOURCES.find((s) => s.id === "yts")!]),
      "dune",
    );
    expect(summary.sourcesSucceeded).toBeGreaterThanOrEqual(1);
    expect(releases.length).toBeGreaterThanOrEqual(1);
    expect(releases[0]!.infohash).toBe(HASH_A);
    expect(releases[0]!.title).toContain("Dune");
  });

  it("EZTV returns results from API response", async () => {
    stubFetch(() => jsonResponse({
      torrents: [{
        title: "Breaking Bad S01E01 720p",
        hash: HASH_A,
        magnet_url: `magnet:?xt=urn:btih:${HASH_A}&dn=Breaking+Bad`,
        seeds: 100,
        peers: 20,
        size_bytes: 350_000_000,
        date_released_unix: 1609459200,
      }],
    }));
    const { summary, releases } = await searchAndBuild(
      makeEngine([SOURCES.find((s) => s.id === "eztv")!]),
      "",
    );
    expect(summary.sourcesSucceeded).toBeGreaterThanOrEqual(1);
    expect(releases.length).toBeGreaterThanOrEqual(1);
    expect(releases[0]!.infohash).toBe(HASH_A);
  });

  it("SubsPlease returns results from API response", async () => {
    stubFetch(() => jsonResponse({
      "entry-1": {
        show: "Jujutsu Kaisen",
        episode: "24",
        release_date: "2024-03-22",
        downloads: [
          { res: "1080", magnet: `magnet:?xt=urn:btih:${HASH_A}&dn=Jujutsu+Kaisen` },
        ],
      },
    }));
    const { summary, releases } = await searchAndBuild(
      makeEngine([SOURCES.find((s) => s.id === "subsplease")!]),
      "jujutsu kaisen",
    );
    expect(summary.sourcesSucceeded).toBeGreaterThanOrEqual(1);
    expect(releases.length).toBeGreaterThanOrEqual(1);
    expect(releases[0]!.infohash).toBe(HASH_A);
  });

  it("1337x returns results from HTML scraping", async () => {
    stubFetch((url) => {
      if (url.includes("/category-search")) {
        return htmlResponse(`<div id="table-list"><table class="table-list"><tbody><tr>
<td><a href="/torrent/12345-dune/">Dune 2021 1080p</a></td>
<td class="seeds">500</td>
<td class="leeches">50</td>
<td class="size">2.1 GB</td>
</tr></tbody></table></div>`);
      }
      return htmlResponse(`<a href="magnet:?xt=urn:btih:${HASH_A}&dn=Dune">m</a>`);
    });
    const { summary, releases } = await searchAndBuild(
      makeEngine([SOURCES.find((s) => s.id === "x1337-movies")!]),
      "dune",
    );
    expect(summary.sourcesSucceeded).toBeGreaterThanOrEqual(1);
    expect(releases.length).toBeGreaterThanOrEqual(1);
    expect(releases[0]!.infohash).toBe(HASH_A);
  });

  it("LimeTorrents Movies returns results from direct magnets", async () => {
    stubFetch(() => htmlResponse(
      `<a href="magnet:?xt=urn:btih:${HASH_A}&dn=Dune.2021">Dune 2021</a>`,
    ));
    const { summary, releases } = await searchAndBuild(
      makeEngine([SOURCES.find((s) => s.id === "limetorrents-movies")!]),
      "dune",
    );
    expect(summary.sourcesSucceeded).toBeGreaterThanOrEqual(1);
    expect(releases.length).toBeGreaterThanOrEqual(1);
    expect(releases[0]!.infohash).toBe(HASH_A);
    expect(releases[0]!.category).toBe("Movie");
  });

  it("TorrentGalaxy Movies returns results from direct magnets", async () => {
    stubFetch(() => htmlResponse(
      `<a href="magnet:?xt=urn:btih:${HASH_B}&dn=Inception.2010">Inception</a>`,
    ));
    const { summary, releases } = await searchAndBuild(
      makeEngine([SOURCES.find((s) => s.id === "torrentgalaxy-movies")!]),
      "inception",
    );
    expect(summary.sourcesSucceeded).toBeGreaterThanOrEqual(1);
    expect(releases.length).toBeGreaterThanOrEqual(1);
    expect(releases[0]!.infohash).toBe(HASH_B);
    expect(releases[0]!.category).toBe("Movie");
  });

  it("LimeTorrents TV returns results from direct magnets", async () => {
    stubFetch(() => htmlResponse(
      `<a href="magnet:?xt=urn:btih:${HASH_A}&dn=Breaking.Bad.S01">Breaking Bad</a>`,
    ));
    const { summary, releases } = await searchAndBuild(
      makeEngine([SOURCES.find((s) => s.id === "limetorrents-tv")!]),
      "breaking bad",
    );
    expect(summary.sourcesSucceeded).toBeGreaterThanOrEqual(1);
    expect(releases[0]!.category).toBe("TV");
  });
});

describe("Deduplication and normalization through the pipeline", () => {
  it("merges results with the same infohash from different sources", () => {
    const raw = [
      result({ infohash: "a".repeat(40), title: "Movie.2021.1080p", seeders: 100, sourceId: "yts" }),
      result({ infohash: "a".repeat(40), title: "Movie.2021.1080p.BluRay", seeders: 200, sourceId: "limetorrents-movies" }),
    ];
    const normalized = raw.map(normalizeResult);
    const deduped = dedupeByInfohash(normalized);
    expect(deduped.size).toBe(1);
    const release = deduped.get("a".repeat(40))!;
    expect(release.seeders).toBe(200);
    expect(release.sources).toContain("yts");
    expect(release.sources).toContain("limetorrents-movies");
  });

  it("builds releases with correct ranking", () => {
    const raw = [
      result({ infohash: "a".repeat(40), title: "Movie.2021.1080p", seeders: 100, sourceId: "yts" }),
      result({ infohash: "b".repeat(40), title: "Movie.2021.720p", seeders: 50, sourceId: "yts" }),
    ];
    const releases = buildReleases(raw, { healthSources: HEALTH });
    expect(releases).toHaveLength(2);
    expect(releases[0]!.infohash).toBe("a".repeat(40));
    expect(releases[0]!.score).toBeGreaterThan(releases[1]!.score);
  });
});

async function searchAndBuild(engine: SearchEngine, query: string) {
  const allResults: SearchResult[] = [];
  const summary = await engine.search({ query }, {
    onSourceResults: (_id, results) => allResults.push(...results),
    onSourceError: () => {},
    onComplete: () => {},
  });
  const releases = buildReleases(allResults, { healthSources: HEALTH });
  return { summary, releases, allResults };
}
