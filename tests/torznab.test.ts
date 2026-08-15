import { afterEach, describe, expect, it, vi } from "vitest";
import type { TorznabProviderConfig } from "../src/config/config.js";
import {
  TorznabProvider,
  buildTorznabUrl,
  parseMusicQuery,
  parseTvQuery,
  parseTorznabCapabilities,
  parseTorznabFeed,
  torznabSource,
} from "../src/sources/torznab.js";
import { ParseError, UnsupportedError } from "../src/sources/net.js";
import { SearchEngine } from "../src/search/engine.js";
import type { SearchContext, SourceAdapter } from "../src/model/source.js";

const HASH_A = "aa".repeat(20);

function response(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function ctx(timeoutMs = 2000): SearchContext {
  return { signal: new AbortController().signal, timeoutMs };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(urlToBody: (url: string) => Response): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => urlToBody(url)));
}

function stubHangingFetch(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, opts: { signal?: AbortSignal }) => {
      return new Promise<Response>((_resolve, reject) => {
        opts.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    }),
  );
}

const CAPS = `<?xml version="1.0" encoding="UTF-8"?>
<caps>
  <server title="Test Indexer" version="1.0" />
  <limits max="100" default="50" />
  <searching>
    <search available="yes" supportedParams="q" />
    <tv-search available="yes" supportedParams="q,season,ep" />
    <movie-search available="yes" supportedParams="q,imdbid" />
    <audio-search available="yes" supportedParams="q,artist,album" />
  </searching>
  <categories>
    <category id="3000" name="Audio" />
    <category id="2000" name="Movies" />
  </categories>
</caps>`;

const NO_MUSIC_CAPS = CAPS.replace('<audio-search available="yes" supportedParams="q,artist,album" />', '<audio-search available="no" />');

function feed(...items: string[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:torznab="http://torznab.com/schemas/2015/feed">
  <channel>${items.join("")}</channel>
</rss>`;
}

function item(opts: { title: string; magnet?: string; infohash?: string; size?: string; seeders?: string; peers?: string; category?: string }): string {
  const magnet = opts.magnet ?? `magnet:?xt=urn:btih:${opts.infohash ?? HASH_A}&dn=${opts.title}`;
  return `<item>
  <title>${opts.title}</title>
  <guid>1</guid>
  <link>https://example.com/torrent/1</link>
  <pubDate>Thu, 01 Jan 2026 00:00:00 +0000</pubDate>
  <enclosure url="https://example.com/dl/1.torrent" length="${opts.size ?? 123456}" type="application/x-bittorrent" />
  <torznab:attr name="seeders" value="${opts.seeders ?? 42}" />
  <torznab:attr name="peers" value="${opts.peers ?? 45}" />
  <torznab:attr name="infohash" value="${opts.infohash ?? HASH_A}" />
  <torznab:attr name="magneturl" value="${magnet}" />
  ${opts.category ? `<torznab:attr name="category" value="${opts.category}" />` : ""}
</item>`;
}

const BASE: TorznabProviderConfig = {
  baseUrl: "https://indexer.example/api",
  apiKey: "key123",
  enabled: true,
};

describe("Torznab capability detection", () => {
  it("parses supported modes from a caps document", () => {
    const caps = parseTorznabCapabilities(CAPS);
    expect(caps.search).toBe(true);
    expect(caps.music).toBe(true);
    expect(caps.movie).toBe(true);
    expect(caps.tv).toBe(true);
    expect(caps.categories).toContain("3000");
  });

  it("reports music unsupported when audio-search is available=no", () => {
    const caps = parseTorznabCapabilities(NO_MUSIC_CAPS);
    expect(caps.music).toBe(false);
    expect(caps.search).toBe(true);
  });

  it("is lenient when no searching block is present", () => {
    const caps = parseTorznabCapabilities("<caps><server/></caps>");
    expect(caps.music).toBe(true);
    expect(caps.movie).toBe(true);
  });

  it("rejects non-caps documents", () => {
    expect(() => parseTorznabCapabilities("<!DOCTYPE html><html></html>")).toThrow(ParseError);
  });
});

describe("Torznab XML parsing", () => {
  it("normalizes a feed into SearchResults", () => {
    const { results, skipped } = parseTorznabFeed(feed(item({ title: "Artist - Album (2024) FLAC" })), {
      sourceId: "torznab:0",
      defaultCategory: "Music",
    });
    expect(skipped).toBe(0);
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.infohash).toBe(HASH_A);
    expect(r.title).toBe("Artist - Album (2024) FLAC");
    expect(r.size).toBe(123456);
    expect(r.seeders).toBe(42);
    expect(r.leechers).toBe(3);
    expect(r.category).toBe("Music");
    expect(r.magnet).toContain(`urn:btih:${HASH_A}`);
    expect(r.torrentUrl).toBe("https://example.com/dl/1.torrent");
    expect(r.added).toBeGreaterThan(0);
  });

  it("prefers the magneturl attribute over the link", () => {
    const { results } = parseTorznabFeed(feed(item({ title: "Album" })), { sourceId: "t" });
    expect(results[0]!.magnet).toContain(`urn:btih:${HASH_A}`);
  });

  it("derives the infohash from the magnet when no infohash attr exists", () => {
    const xml = feed(
      `<item><title>Album</title><link>https://example.com/torrent/1</link><enclosure url="https://example.com/dl/1.torrent" length="10" type="application/x-bittorrent"/><torznab:attr name="magneturl" value="magnet:?xt=urn:btih:${HASH_A}"/></item>`,
    );
    const { results } = parseTorznabFeed(xml, { sourceId: "t" });
    expect(results[0]!.infohash).toBe(HASH_A);
  });

  it("throws a parse error for HTML responses", () => {
    expect(() => parseTorznabFeed("<!DOCTYPE html><html><body>cloudflare</body></html>", { sourceId: "t" })).toThrow(
      ParseError,
    );
  });

  it("reports an empty result set (not a failure) for a legitimately empty feed", () => {
    const { results, skipped } = parseTorznabFeed(feed(), { sourceId: "t" });
    expect(results).toEqual([]);
    expect(skipped).toBe(0);
  });

  it("reports skipped unparseable items instead of throwing at the parser level", () => {
    const xml = feed(
      `<item><title>Album</title><link>https://example.com/torrent/1</link><enclosure url="https://example.com/dl/1.torrent" length="10" type="application/x-bittorrent"/></item>`,
    );
    const { results, skipped } = parseTorznabFeed(xml, { sourceId: "t" });
    expect(results).toEqual([]);
    expect(skipped).toBe(1);
  });
});

describe("Torznab music query mapping", () => {
  it("splits Artist - Album", () => {
    expect(parseMusicQuery("Brian Eno - Ambient 1")).toEqual({
      q: "Brian Eno - Ambient 1",
      artist: "Brian Eno",
      album: "Ambient 1",
    });
  });

  it("extracts a year", () => {
    expect(parseMusicQuery("Brian Eno - Ambient 1 (1978)").year).toBe("1978");
  });

  it("detects a track from a numbered title", () => {
    const q = parseMusicQuery("01 - In the Air");
    expect(q.track).toBe("In the Air");
    expect(q.album).toBe("01 - In the Air");
  });

  it("keeps a plain query as q", () => {
    expect(parseMusicQuery("jazz").q).toBe("jazz");
  });
});

describe("Torznab TV query mapping", () => {
  it("parses season/episode", () => {
    const q = parseTvQuery("Show Name S02E05");
    expect(q.season).toBe(2);
    expect(q.episode).toBe(5);
  });
});

describe("buildTorznabUrl", () => {
  it("appends t, apikey and query params", () => {
    const url = buildTorznabUrl(BASE, "music", { q: "artist album", artist: "artist" });
    expect(url).toContain("t=music");
    expect(url).toContain("apikey=key123");
    expect(url).toContain("q=artist+album");
    expect(url).toContain("artist=artist");
  });
});

describe("TorznabProvider.search", () => {
  it("searches and returns normalized results with the adapter sourceId", async () => {
    stubFetch((url) => (url.includes("t=caps") ? response(CAPS) : response(feed(item({ title: "Album FLAC" })))));
    const provider = new TorznabProvider(BASE, "torznab:0");
    const results = await provider.search("artist album", ctx(), "Music");
    expect(results).toHaveLength(1);
    expect(results[0]!.sourceId).toBe("torznab:0");
    expect(results[0]!.category).toBe("Music");
  });

  it("surfaces a parse error when every item is unusable", async () => {
    stubFetch((url) =>
      url.includes("t=caps")
        ? response(CAPS)
        : response(
            feed(
              `<item><title>Album</title><link>https://example.com/torrent/1</link><enclosure url="https://example.com/dl/1.torrent" length="10" type="application/x-bittorrent"/></item>`,
            ),
          ),
    );
    const provider = new TorznabProvider(BASE, "torznab:0");
    await expect(provider.search("album", ctx())).rejects.toBeInstanceOf(ParseError);
  });

  it("refuses unsupported query types instead of sending them", async () => {
    stubFetch((url) => (url.includes("t=caps") ? response(NO_MUSIC_CAPS) : response(feed(item({ title: "Album" })))));
    const provider = new TorznabProvider(BASE, "torznab:0");
    await expect(provider.search("album", ctx(), "Music")).rejects.toBeInstanceOf(UnsupportedError);
  });

  it("still attempts a search when the caps endpoint is unreachable", async () => {
    stubFetch((url) => (url.includes("t=caps") ? response("", 500) : response(feed(item({ title: "Album" })))));
    const provider = new TorznabProvider(BASE, "torznab:0");
    const results = await provider.search("album", ctx());
    expect(results).toHaveLength(1);
  });

  it("rejects (does not return []) when the search request never settles within its timeout", async () => {
    stubHangingFetch();
    const provider = new TorznabProvider(BASE, "torznab:0");
    await expect(provider.search("album", ctx(50))).rejects.toBeTruthy();
  });

  it("surfaces an HTTP error for a failing search endpoint", async () => {
    stubFetch((url) => (url.includes("t=caps") ? response(CAPS) : response("", 500)));
    const provider = new TorznabProvider(BASE, "torznab:0");
    await expect(provider.search("album", ctx())).rejects.toThrow();
  });
});

describe("Torznab engine integration", () => {
  function makeEngine(sources: ReturnType<typeof torznabSource>[]) {
    return new SearchEngine({
      sources,
      isEnabled: () => true,
      defaultTimeoutMs: 1000,
      maxConcurrentSources: 2,
    });
  }

  it("classifies a torznab timeout as a timeout failure, isolated from other sources", async () => {
    stubHangingFetch();
    const torznab = torznabSource({ ...BASE, timeoutMs: 100 }, 0);
    const engine = makeEngine([torznab]);
    const events: string[] = [];
    await engine.search(
      { query: "album" },
      {
        onSourceResults: (id, results) => events.push(`ok:${id}:${results.length}`),
        onSourceError: (id, failure) => events.push(`err:${id}:${failure.kind}`),
        onComplete: () => events.push("done"),
      },
    );
    expect(events).toContain("err:torznab:0:timeout");
    expect(events).toContain("done");
  });

  it("keeps results from a healthy source when another provider fails", async () => {
    stubHangingFetch();
    const torznab = torznabSource({ ...BASE, timeoutMs: 100 }, 0);
    const healthy: SourceAdapter = {
      id: "native-music",
      name: "Native",
      groups: ["Music"],
      categories: ["Music"],
      homepage: "https://example.com",
      timeoutMs: 5000,
      concurrency: 1,
      reportsHealth: true,
      search: async () => [{ infohash: HASH_A, title: "Album FLAC", size: 100, sourceId: "native-music", magnet: `magnet:?xt=urn:btih:${HASH_A}` }],
    };
    const engine = makeEngine([torznab, healthy]);
    const summary = await engine.search(
      { query: "album" },
      { onSourceResults: () => {}, onSourceError: () => {}, onComplete: () => {} },
    );
    expect(summary.sourcesSucceeded).toBe(1);
    expect(summary.sourcesFailed).toBe(1);
    expect(summary.totalResults).toBe(1);
  });

  it("reports zero results as ok (working), never as a failure", async () => {
    const empty: SourceAdapter = {
      id: "empty-source",
      name: "Empty",
      groups: ["Music"],
      categories: ["Music"],
      homepage: "https://example.com",
      timeoutMs: 5000,
      concurrency: 1,
      reportsHealth: true,
      search: async () => [],
    };
    const engine = makeEngine([empty]);
    const reports: string[] = [];
    await engine.search(
      { query: "album" },
      {
        onSourceResults: (id, results) => reports.push(`${id}:${results.length}`),
        onSourceError: (id, failure) => reports.push(`${id}:err:${failure.kind}`),
        onComplete: () => {},
      },
    );
    expect(reports).toContain("empty-source:0");
  });
});