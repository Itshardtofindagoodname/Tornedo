import { describe, expect, it } from "vitest";
import { buildReleases, buildGroups } from "../src/results/pipeline.js";
import { dedupeByInfohash, mergeRelease, emptyRelease } from "../src/results/dedupe.js";
import { rankRelease, rankReleases, defaultRankContext, compareReleases } from "../src/results/rank.js";
import { groupKeyFor, groupReleases } from "../src/results/group.js";
import { filterReleases, type ReleaseFilter } from "../src/results/filter.js";
import { normalizeResult } from "../src/media/normalize.js";
import { result } from "./helpers/fixtures.js";

const HEALTH = new Set(["yts"]);
const ctx = defaultRankContext(HEALTH);

function norm(raw: ReturnType<typeof result>) {
  return normalizeResult(raw);
}

describe("dedupeByInfohash", () => {
  it("merges identical infohashes across sources", () => {
    const a = norm(result({ infohash: "aa".repeat(20), title: "Dune.2021.1080p", seeders: 5, sourceId: "yts" }));
    const b = norm(result({ infohash: "aa".repeat(20), title: "Dune.2021.1080p.BluRay", seeders: 9, sourceId: "tpb" }));
    const map = dedupeByInfohash([a, b]);
    expect(map.size).toBe(1);
    const r = map.get("aa".repeat(20))!;
    expect(r.seeders).toBe(9);
    expect(r.sources).toContain("yts");
    expect(r.sources).toContain("tpb");
  });

  it("keeps distinct infohashes separate", () => {
    const a = norm(result({ infohash: "aa".repeat(20), title: "A" }));
    const b = norm(result({ infohash: "bb".repeat(20), title: "B" }));
    expect(dedupeByInfohash([a, b]).size).toBe(2);
  });

  it("emptyRelease and mergeRelease work standalone", () => {
    const base = emptyRelease(norm(result({ infohash: "cc".repeat(20), title: "X", seeders: 2, sourceId: "s1" })));
    const merged = mergeRelease(base, norm(result({ infohash: "cc".repeat(20), title: "X Long Title", seeders: 7, sourceId: "s2" })));
    expect(merged.title).toBe("X Long Title");
    expect(merged.seeders).toBe(7);
  });
});

describe("rank", () => {
  it("prefers more seeders and better quality", () => {
    const a = mk("aaaa".repeat(10), "Alpha", "1080p", 100, ["yts"]);
    const b = mk("bbbb".repeat(10), "Alpha", "720p", 2, []);
    expect(rankRelease(a, ctx)).toBeGreaterThan(rankRelease(b, ctx));
  });

  it("adds health bonus only for health sources", () => {
    const a = mk("aaaa".repeat(10), "T", undefined, 1, ["yts"]);
    const b = mk("bbbb".repeat(10), "T", undefined, 1, ["other"]);
    expect(rankRelease(a, ctx)).toBeGreaterThan(rankRelease(b, ctx));
  });

  it("sorting is deterministic and stable", () => {
    const releases = [a(100), b(100), c(200)].map((r) => ({ ...r, score: rankRelease(r, ctx) }));
    releases.sort(compareReleases);
    const keys = releases.map((r) => r.infohash);
    expect(keys).toEqual([c(0), a(0), b(0)].map((r) => r.infohash));
  });

  it("rankReleases returns ranked copies", () => {
    const out = rankReleases([a(5), c(50)], ctx);
    expect(out[0]!.infohash).toBe(c(50).infohash);
    expect(out[0]!.score).toBeGreaterThan(0);
  });
});

describe("grouping", () => {
  it("groups by category/title/year", () => {
    const g1 = groupKeyFor({ infohash: "1", title: "Dune", category: "Movie", metadata: { year: 2021 }, score: 0 } as never as import("../src/model/search.js").Release);
    const g2 = groupKeyFor({ infohash: "2", title: "Dune", category: "Movie", metadata: { year: 2021 }, score: 0 } as never as import("../src/model/search.js").Release);
    const g3 = groupKeyFor({ infohash: "3", title: "Dune", category: "Movie", metadata: { year: 1984 }, score: 0 } as never as import("../src/model/search.js").Release);
    expect(g1).toBe(g2);
    expect(g1).not.toBe(g3);
  });

  it("groups TV by season", () => {
    const g1 = groupKeyFor({ infohash: "1", title: "Show", category: "TV", metadata: { season: 1 }, score: 0 } as never as import("../src/model/search.js").Release);
    const g2 = groupKeyFor({ infohash: "2", title: "Show", category: "TV", metadata: { season: 2 }, score: 0 } as never as import("../src/model/search.js").Release);
    expect(g1).not.toBe(g2);
  });

  it("builds groups from pipeline output", () => {
    const releases = buildReleases(
      [
        result({ infohash: "aa".repeat(20), title: "Dune.2021.1080p.BluRay.x264", seeders: 50, sourceId: "yts" }),
        result({ infohash: "bb".repeat(20), title: "Dune.2021.720p.WEBRip", seeders: 10, sourceId: "yts" }),
        result({ infohash: "cc".repeat(20), title: "Other.Movie.2019.1080p", seeders: 5, sourceId: "yts" }),
      ],
      { healthSources: HEALTH },
    );
    const groups = buildGroups(releases, { healthSources: HEALTH });
    expect(groups.length).toBe(2);
    const dune = groups.find((g) => g.title === "Dune")!;
    expect(dune.releases.length).toBe(2);
    expect(dune.releases[0]!.metadata.quality).toBe("1080p");
  });
});

describe("filter", () => {
  it("filters by query and category", () => {
    const r1 = { infohash: "a".repeat(40), title: "Dune 2021", category: "Movie", metadata: {}, score: 0 } as never as import("../src/model/search.js").Release;
    const r2 = { infohash: "b".repeat(40), title: "Cats", category: "Movie", metadata: {}, score: 0 } as never as import("../src/model/search.js").Release;
    const f: ReleaseFilter = { query: "dune" };
    const out = filterReleases([r1, r2], f);
    expect(out.map((r) => r.title)).toEqual(["Dune 2021"]);
  });
});

function a(seeders: number) {
  return mk("aaaa".repeat(10), "Alpha", "1080p", seeders, ["yts"]);
}
function b(seeders: number) {
  return mk("bbbb".repeat(10), "Beta", "1080p", seeders, ["yts"]);
}
function c(seeders: number) {
  return mk("cccc".repeat(10), "Gamma", "2160p", seeders, ["yts"]);
}
function mk(
  infohash: string,
  title: string,
  quality: string | undefined,
  seeders: number,
  sources: string[],
): import("../src/model/search.js").Release {
  return {
    infohash,
    title,
    rawTitle: title,
    category: "Movie",
    metadata: { quality },
    seeders,
    sources,
    magnet: `magnet:?xt=urn:btih:${infohash}`,
    torrentUrls: [],
    score: 0,
  };
}