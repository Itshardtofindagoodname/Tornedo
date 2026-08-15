import { describe, expect, it } from "vitest";
import { SearchEngine } from "../src/search/engine.js";
import type { SearchEmitter, SearchSummary, SourceAdapter } from "../src/model/source.js";
import { CancelledError, ParseError } from "../src/sources/net.js";
import { fakeSource, failingSource, hangingSource, result } from "./helpers/fixtures.js";

function makeEngine(sources: SourceAdapter[], enabled: string[] = []) {
  return new SearchEngine({
    sources,
    isEnabled: (id) => enabled.includes(id) || enabled.length === 0,
    defaultTimeoutMs: 500,
    maxConcurrentSources: 4,
  });
}

function collect(engine: SearchEngine, req: Parameters<SearchEngine["search"]>[0]) {
  const events: string[] = [];
  const emitter: SearchEmitter = {
    onSourceResults: (id, results) => events.push(`ok:${id}:${results.length}`),
    onSourceError: (id, failure) => events.push(`err:${id}:${failure.kind}`),
    onComplete: (s) => events.push(`done:${s.sourcesSucceeded}/${s.sourcesFailed}`),
  };
  return engine.search(req, emitter).then((summary: SearchSummary) => ({ summary, events }));
}

describe("SearchEngine", () => {
  it("runs all enabled sources and reports a summary", async () => {
    const engine = makeEngine([
      fakeSource("a", "A", [result({ infohash: "aa".repeat(20), title: "X" })]),
      fakeSource("b", "B", [result({ infohash: "bb".repeat(20), title: "Y" })]),
    ]);
    const { summary, events } = await collect(engine, { query: "x" });
    expect(summary.sourcesSucceeded).toBe(2);
    expect(summary.totalResults).toBe(2);
    expect(events).toContain("ok:a:1");
    expect(events).toContain("ok:b:1");
    expect(events).toContain("done:2/0");
  });

  it("isolates failing sources", async () => {
    const engine = makeEngine([
      fakeSource("a", "A", [result({ infohash: "aa".repeat(20), title: "X" })]),
      failingSource("bad", "Bad", new Error("http 500"), { kind: "unavailable" }),
      fakeSource("c", "C", [result({ infohash: "cc".repeat(20), title: "Z" })]),
    ]);
    const { summary, events } = await collect(engine, { query: "x" });
    expect(summary.sourcesSucceeded).toBe(2);
    expect(summary.sourcesFailed).toBe(1);
    expect(events).toContain("err:bad:unavailable");
    expect(events).toContain("done:2/1");
  });

  it("times out hanging sources", async () => {
    const engine = makeEngine([
      fakeSource("fast", "Fast", [result({ infohash: "aa".repeat(20), title: "X" })]),
      hangingSource("slow", "Slow", { timeoutMs: 100 }),
    ]);
    const { summary, events } = await collect(engine, { query: "x" });
    expect(summary.sourcesFailed).toBe(1);
    expect(events.some((e) => e.startsWith("err:slow:timeout"))).toBe(true);
    expect(events).toContain("ok:fast:1");
  });

  it("respects the sourceIds restriction", async () => {
    const engine = makeEngine([
      fakeSource("a", "A", [result({ infohash: "aa".repeat(20), title: "X" })]),
      fakeSource("b", "B", [result({ infohash: "bb".repeat(20), title: "Y" })]),
    ]);
    const { summary, events } = await collect(engine, { query: "x", sourceIds: ["a"] });
    expect(summary.sourcesSucceeded).toBe(1);
    expect(events).not.toContain("ok:b:1");
  });

  it("skips disabled sources", async () => {
    const engine = makeEngine(
      [
        fakeSource("a", "A", [result({ infohash: "aa".repeat(20), title: "X" })]),
        fakeSource("b", "B", [result({ infohash: "bb".repeat(20), title: "Y" })]),
      ],
      ["a"],
    );
    const { summary } = await collect(engine, { query: "x" });
    expect(summary.sourcesSucceeded).toBe(1);
  });

  it("classifies ParseError as a parse failure and keeps other sources alive", async () => {
    const engine = makeEngine([
      failingSource("broken", "Broken", new ParseError("listing structure unrecognized")),
      fakeSource("music", "Music", [result({ infohash: "aa".repeat(20), title: "Album", category: "Music" })]),
    ]);
    const { summary, events } = await collect(engine, { query: "album" });
    expect(summary.sourcesSucceeded).toBe(1);
    expect(summary.sourcesFailed).toBe(1);
    expect(events).toContain("err:broken:parse");
    expect(events).toContain("ok:music:1");
    expect(events).toContain("done:1/1");
  });

  it("a parse failure can never zero out results from healthy sources", async () => {
    const engine = makeEngine([
      failingSource("broken", "Broken", new ParseError("structure changed")),
      fakeSource("good", "Good", [result({ infohash: "bb".repeat(20), title: "Album FLAC", category: "Music" })]),
    ]);
    const { summary } = await collect(engine, { query: "album" });
    expect(summary.totalResults).toBe(1);
    expect(summary.sourcesSucceeded).toBe(1);
  });

  it("rejects with CancelledError when aborted", async () => {
    const engine = makeEngine([
      hangingSource("slow", "Slow", { timeoutMs: 5000 }),
      fakeSource("fast", "Fast", [result({ infohash: "aa".repeat(20), title: "X" })]),
    ]);
    const controller = new AbortController();
    const promise = engine.search({ query: "x", signal: controller.signal }, { onSourceResults: () => {}, onSourceError: () => {}, onComplete: () => {} });
    controller.abort();
    await expect(promise).rejects.toBeInstanceOf(CancelledError);
  });

  it("emits results progressively as sources settle", async () => {
    const ordered: string[] = [];
    const slow = fakeSource("slow", "Slow", [result({ infohash: "bb".repeat(20), title: "Y" })], { delayMs: 60 });
    const fast = fakeSource("fast", "Fast", [result({ infohash: "aa".repeat(20), title: "X" })]);

    const engine = new SearchEngine({
      sources: [slow, fast],
      isEnabled: () => true,
      defaultTimeoutMs: 1000,
      maxConcurrentSources: 4,
    });
    const emitter: SearchEmitter = {
      onSourceResults: (id) => ordered.push(id),
      onSourceError: () => ordered.push("err"),
      onComplete: () => ordered.push("done"),
    };
    await engine.search({ query: "x" }, emitter);
    expect(ordered[0]).toBe("fast");
    expect(ordered[ordered.length - 1]).toBe("done");
  });
});