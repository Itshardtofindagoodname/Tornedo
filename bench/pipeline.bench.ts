/**
 * Results-pipeline throughput: raw SearchResult batches -> normalized,
 * de-duplicated, ranked, grouped releases.
 */
import { bench, describe } from "vitest";
import { buildReleases, buildGroups } from "../src/results/pipeline.js";
import type { SearchResult } from "../src/model/search.js";

const HEALTH = new Set(["yts", "eztv"]);

function batch(count: number): SearchResult[] {
  const out: SearchResult[] = [];
  const titles = [
    "Dune.2021.1080p.BluRay.x264-RARBG",
    "Dune.2021.2160p.BluRay.HEVC",
    "Dune.2021.720p.WEBRip",
    "Interstellar.2014.1080p.BluRay.x264-YTS",
    "Game.Of.Thrones.S08E03.720p.HDTV",
  ];
  for (let i = 0; i < count; i++) {
    const t = titles[i % titles.length]!;
    out.push({
      infohash: `${i}`.padStart(40, "0"),
      title: `${t}.${i % 7}`,
      size: 1024 * (1 + (i % 50)),
      seeders: i % 900,
      leechers: i % 40,
      sourceId: i % 2 === 0 ? "yts" : "eztv",
      magnet: `magnet:?xt=urn:btih:${`${i}`.padStart(40, "0")}`,
    });
  }
  return out;
}

const BATCH_100 = batch(100);
const BATCH_1000 = batch(1000);

describe("results pipeline", () => {
  bench("normalize + dedupe + rank + group (100 raw)", () => {
    const releases = buildReleases(BATCH_100, { healthSources: HEALTH });
    buildGroups(releases, { healthSources: HEALTH });
  });

  bench("normalize + dedupe + rank + group (1000 raw)", () => {
    const releases = buildReleases(BATCH_1000, { healthSources: HEALTH });
    buildGroups(releases, { healthSources: HEALTH });
  });
});