import { describe, expect, it } from "vitest";
import {
  describeFilter,
  filterToQueryText,
  parseFilterText,
  releaseMatches,
  sortLabel,
  sortReleases,
} from "../src/results/filter.js";
import { buildReleases } from "../src/results/pipeline.js";
import type { Release } from "../src/model/search.js";
import { result } from "./helpers/fixtures.js";

function release(title: string, seeders: number, size: number, sourceId = "yts"): Release {
  return buildReleases([result({ infohash: title, title, seeders, size, sourceId })], {
    healthSources: new Set(),
    rank: {},
  })[0]!;
}

describe("parseFilterText", () => {
  it("parses structured tokens", () => {
    const f = parseFilterText("min:5 max:2g src:1337x res:1080p codec:h265 audio:flac lang:eng quality:webrip");
    expect(f.minSeeders).toBe(5);
    expect(f.maxSize).toBe(2 * (1 << 30));
    expect(f.source).toBe("1337x");
    expect(f.resolution).toBe("1080p");
    expect(f.codec).toBe("h265");
    expect(f.audioFormat).toBe("flac");
    expect(f.language).toBe("eng");
    expect(f.quality).toBe("webrip");
  });

  it("supports lowercase size suffixes", () => {
    const f = parseFilterText("max:750m");
    expect(f.maxSize).toBe(750 * (1 << 20));
  });

  it("ignores unknown tokens and empty input", () => {
    expect(parseFilterText("banana 42 nope:1")).toEqual({});
    expect(parseFilterText("  ")).toEqual({});
  });

  it("round-trips through filterToQueryText", () => {
    const f = parseFilterText("min:10 max:4g src:yts res:2160p");
    const parsed = parseFilterText(filterToQueryText(f));
    expect(parsed.minSeeders).toBe(10);
    expect(parsed.maxSize).toBe(4 * (1 << 30));
    expect(parsed.source).toBe("yts");
    expect(parsed.resolution).toBe("2160p");
  });
});

describe("releaseMatches", () => {
  it("filters by min seeders and max size", () => {
    const r = release("Dune 2021 1080p", 50, 2 * (1 << 30));
    expect(releaseMatches(r, { minSeeders: 40 })).toBe(true);
    expect(releaseMatches(r, { minSeeders: 60 })).toBe(false);
    expect(releaseMatches(r, { maxSize: 5 * (1 << 30) })).toBe(true);
    expect(releaseMatches(r, { maxSize: 1 * (1 << 30) })).toBe(false);
  });

  it("filters by source and language", () => {
    const r = release("Elite S01 1080p Spanish WEB-DL", 5, 100, "yts");
    expect(releaseMatches(r, { source: "yts" })).toBe(true);
    expect(releaseMatches(r, { source: "other" })).toBe(false);
  });
});

describe("sortReleases", () => {
  it("sorts by seeders desc and asc", () => {
    const list = [release("A", 10, 1), release("B", 100, 1), release("C", 50, 1)];
    expect(sortReleases(list, { by: "seeders", dir: "desc" }).map((r) => r.rawTitle)).toEqual(["B", "C", "A"]);
    expect(sortReleases(list, { by: "seeders", dir: "asc" }).map((r) => r.rawTitle)).toEqual(["A", "C", "B"]);
  });

  it("sorts by size desc", () => {
    const list = [release("A", 1, 100), release("B", 1, 1000), release("C", 1, 10)];
    expect(sortReleases(list, { by: "size", dir: "desc" }).map((r) => r.rawTitle)).toEqual(["B", "A", "C"]);
  });

  it("sorts by source then title", () => {
    const list = buildReleases(
      [
        result({ infohash: "a", title: "Z", sourceId: "zzz" }),
        result({ infohash: "b", title: "A", sourceId: "aaa" }),
      ],
      { healthSources: new Set(), rank: {} },
    );
    const sorted = sortReleases(list, { by: "source", dir: "asc" });
    expect(sorted.map((r) => r.sources[0])).toEqual(["aaa", "zzz"]);
  });
});

describe("describeFilter / sortLabel", () => {
  it("summarizes active filters", () => {
    const parts = describeFilter(parseFilterText("min:5 max:2g"));
    expect(parts.join(" ")).toContain("5");
    expect(parts.join(" ")).toContain("2.0G");
  });

  it("labels sort presets", () => {
    expect(sortLabel({ by: "score", dir: "desc" })).toBe("Best Match");
    expect(sortLabel({ by: "title", dir: "asc" })).toBe("Title");
  });
});