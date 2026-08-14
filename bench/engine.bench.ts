/**
 * Federated search engine throughput: N concurrent sources, each returning M
 * results, all settling on microtasks (no network).
 */
import { bench, describe } from "vitest";
import { SearchEngine } from "../src/search/engine.js";
import { fakeSource, result } from "../tests/helpers/fixtures.js";
import type { SearchEmitter, SearchSummary, SourceAdapter } from "../src/model/source.js";

function sources(count: number, resultsPerSource: number): SourceAdapter[] {
  const out: SourceAdapter[] = [];
  for (let s = 0; s < count; s++) {
    const results = [];
    for (let i = 0; i < resultsPerSource; i++) {
      results.push(
        result({ infohash: `${s}${i}`.padStart(40, "0"), title: `Title.${s}.${i}`, seeders: i, sourceId: `src${s}` }),
      );
    }
    out.push(fakeSource(`src${s}`, `Source ${s}`, results));
  }
  return out;
}

function silentEmitter(): SearchEmitter {
  return { onSourceResults: () => {}, onSourceError: () => {}, onComplete: () => {} };
}

describe("SearchEngine", () => {
  bench("10 sources x 100 results", async () => {
    const engine = new SearchEngine({
      sources: sources(10, 100),
      isEnabled: () => true,
      defaultTimeoutMs: 1000,
      maxConcurrentSources: 8,
    });
    await engine.search({ query: "x" }, silentEmitter());
  });

  bench("30 sources x 50 results", async () => {
    const engine = new SearchEngine({
      sources: sources(30, 50),
      isEnabled: () => true,
      defaultTimeoutMs: 1000,
      maxConcurrentSources: 8,
    });
    await engine.search({ query: "x" }, silentEmitter());
  });
});