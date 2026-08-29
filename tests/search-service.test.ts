import { describe, expect, it } from "vitest";
import { SearchEngine } from "../src/search/engine.js";
import { SearchService } from "../src/app/search-service.js";
import { defaultRankContext } from "../src/results/rank.js";
import type { SourceAdapter } from "../src/model/source.js";
import { fakeSource, failingSource, result } from "./helpers/fixtures.js";

function makeService(sources: SourceAdapter[]) {
  const engine = new SearchEngine({
    sources,
    isEnabled: () => true,
    defaultTimeoutMs: 1000,
    maxConcurrentSources: 4,
  });
  const rank = defaultRankContext(new Set(["yts"]));
  const service = new SearchService({
    engine,
    healthSources: new Set(["yts"]),
    getRank: () => rank,
  });
  return service;
}

describe("SearchService", () => {
  it("streams progressive results and de-duplicates across sources", async () => {
    const shared = result({ infohash: "aa".repeat(20), title: "Dune.2021.1080p", seeders: 8, sourceId: "yts" });
    const service = makeService([
      fakeSource("yts", "YTS", [shared], { delayMs: 20 }),
      fakeSource("tpb", "TPB", [
        result({ infohash: "aa".repeat(20), title: "Dune.2021.1080p.BluRay", seeders: 12, sourceId: "tpb" }),
        result({ infohash: "bb".repeat(20), title: "Dune.2021.720p", seeders: 3, sourceId: "tpb" }),
      ]),
    ]);

    const session = service.createSession("dune");
    const seen: number[] = [];
    session.onChange(() => seen.push(session.rawCount()));

    session.start();
    const summary = await session.waitForDone();

    expect(summary.sourcesSucceeded).toBe(2);
    expect(session.rawCount()).toBe(3);
    expect(session.releases().length).toBe(2); // deduplicated
    expect(session.releases()[0]!.sources.sort()).toEqual(["tpb", "yts"]);
    expect(seen.length).toBeGreaterThan(1);
  });

  it("records source failures and exposes reports", async () => {
    const service = makeService([
      fakeSource("ok", "OK", [result({ infohash: "aa".repeat(20), title: "X" })]),
      failingSource("bad", "BAD", new Error("nope")),
    ]);
    const session = service.createSession("x");
    session.start();
    await session.waitForDone();

    const failures = session.failuresList();
    expect(failures.length).toBe(1);
    expect(failures[0]!.sourceId).toBe("bad");
    expect(session.sourceReports().get("ok")!.status).toBe("ok");
    expect(session.sourceReports().get("bad")!.status).toBe("error");
  });

  it("cancels a running search", async () => {
    const service = makeService([
      fakeSource("ok", "OK", [result({ infohash: "aa".repeat(20), title: "X" })]),
    ]);
    const session = service.createSession("x");
    session.start();
    session.cancel();
    await session.waitForDone();
    expect(session.isCancelled()).toBe(true);
  });

  it("groups releases by title", async () => {
    const service = makeService([
      fakeSource("yts", "YTS", [
        result({ infohash: "aa".repeat(20), title: "Dune.2021.1080p" }),
        result({ infohash: "bb".repeat(20), title: "Dune.2021.720p" }),
      ]),
    ]);
    const session = service.createSession("dune");
    session.start();
    await session.waitForDone();
    const groups = session.groups();
    expect(groups.length).toBe(1);
    expect(groups[0]!.releases.length).toBe(2);
  });

});
