import { describe, expect, it, vi, afterEach } from "vitest";
import { magnetFromHtml, parseDetailCandidates, parseDirectMagnets } from "../src/sources/html-magnet.js";
import { SOURCES } from "../src/sources/registry.js";
import {
  limeTorrentsMusic,
  limeTorrentsMovies,
  limeTorrentsTv,
  torrentDownloadsMusic,
  torrentDownloadsMovies,
  torrentDownloadsTv,
  torrentGalaxyMusic,
  torrentGalaxyMovies,
  torrentGalaxyTv,
} from "../src/sources/fallback-music.js";
import type { SearchContext } from "../src/model/source.js";

function ctx(): SearchContext {
  return { signal: new AbortController().signal, timeoutMs: 2000 };
}

function response(html: string): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    text: () => Promise.resolve(html),
  } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("music torrent fallbacks", () => {
  it("registers every magnet-capable music provider", () => {
    const ids = SOURCES.filter((source) => source.groups.includes("Music")).map((source) => source.id);
    expect(ids).toEqual(expect.arrayContaining([
      "tpb-music", "x1337-music", "limetorrents-music", "torrentgalaxy-music", "torrentdownloads-music",
    ]));
  });

  it("registers movie and TV providers for all three sites", () => {
    const allIds = SOURCES.map((s) => s.id);
    expect(allIds).toContain("limetorrents-movies");
    expect(allIds).toContain("limetorrents-tv");
    expect(allIds).toContain("torrentgalaxy-movies");
    expect(allIds).toContain("torrentgalaxy-tv");
    expect(allIds).toContain("torrentdownloads-movies");
    expect(allIds).toContain("torrentdownloads-tv");
  });

  it("keeps only torrent detail links and extracts valid magnet URIs", () => {
    const rows = parseDetailCandidates(
      '<a href="/torrent/album-123">Album FLAC</a><a href="/about">About</a>',
      /^\/torrent\/[^?#]+/i,
    );
    expect(rows).toEqual([{ path: "/torrent/album-123", title: "Album FLAC" }]);
    expect(magnetFromHtml('<a href="magnet:?xt=urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa&amp;dn=Album">get</a>'))
      .toContain("urn:btih:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  });

  it("emits results straight from listing magnets without a detail-page round trip", async () => {
    const listing = `
      <a class="csprite_dl14" href="magnet:?xt=urn:btih:${"bb".repeat(20)}&amp;dn=Album">Download</a>
      <a href="/about">About</a>
    `;
    vi.stubGlobal("fetch", vi.fn(async () => response(listing)));
    const results = await limeTorrentsMusic.search("album", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe("bb".repeat(20));
    expect(results[0]!.magnet).toContain("urn:btih:" + "bb".repeat(20));
  });

  it("skips nav/footer .html links under the tightened LimeTorrents detail path", () => {
    const rows = parseDetailCandidates(
      '<a href="/faq.html">FAQ</a><a href="/torrent/1234-album.html">Album FLAC</a><a href="/contact.html">Contact</a>',
      /^\/torrent\/[^/?#]+\.html(?:[?#].*)?$/i,
    );
    expect(rows).toEqual([{ path: "/torrent/1234-album.html", title: "Album FLAC" }]);
  });

  it("aggregates direct magnets from multiple music providers", async () => {
    const listing = `<a href="magnet:?xt=urn:btih:${"cc".repeat(20)}">TorrentGalaxy Album</a>`;
    vi.stubGlobal("fetch", vi.fn(async () => response(listing)));
    const tg = await torrentGalaxyMusic.search("album", ctx());
    const td = await torrentDownloadsMusic.search("album", ctx());
    expect(tg).toHaveLength(1);
    expect(td).toHaveLength(1);
    expect(tg[0]!.magnet).toContain("urn:btih:");
    expect(td[0]!.magnet).toContain("urn:btih:");
  });

  it("normalizes duplicate infohashes in a listing to a single result", () => {
    const rows = parseDirectMagnets(
      `<a href="magnet:?xt=urn:btih:${"dd".repeat(20)}&dn=A">A</a><a href="magnet:?xt=urn:btih:${"dd".repeat(20)}&dn=A copy">A copy</a>`,
      "limetorrents-music",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.title).toBe("A");
  });
});

describe("LimeTorrents Movie adapter", () => {
  it("has correct metadata", () => {
    expect(limeTorrentsMovies.id).toBe("limetorrents-movies");
    expect(limeTorrentsMovies.groups).toEqual(["Movies"]);
    expect(limeTorrentsMovies.categories).toEqual(["Movie"]);
  });

  it("returns movie results from listing magnets", async () => {
    const listing = `<a href="magnet:?xt=urn:btih:${"aa".repeat(20)}&dn=Dune.2021.1080p">Dune 2021</a>`;
    vi.stubGlobal("fetch", vi.fn(async () => response(listing)));
    const results = await limeTorrentsMovies.search("dune", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.category).toBe("Movie");
    expect(results[0]!.infohash).toBe("aa".repeat(20));
  });

  it("uses movies-specific search URL", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      capturedUrl = url;
      return response("");
    }));
    await limeTorrentsMovies.search("dune", ctx());
    expect(capturedUrl).toContain("/search/movies/");
  });

  it("returns empty for empty query", async () => {
    const results = await limeTorrentsMovies.search("", ctx());
    expect(results).toEqual([]);
  });
});

describe("LimeTorrents TV adapter", () => {
  it("has correct metadata", () => {
    expect(limeTorrentsTv.id).toBe("limetorrents-tv");
    expect(limeTorrentsTv.groups).toEqual(["TV"]);
    expect(limeTorrentsTv.categories).toEqual(["TV"]);
  });

  it("uses tv-specific search URL", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      capturedUrl = url;
      return response("");
    }));
    await limeTorrentsTv.search("breaking bad", ctx());
    expect(capturedUrl).toContain("/search/tv/");
  });

  it("returns TV results with correct category", async () => {
    const listing = `<a href="magnet:?xt=urn:btih:${"bb".repeat(20)}&dn=Breaking.Bad.S01">Breaking Bad</a>`;
    vi.stubGlobal("fetch", vi.fn(async () => response(listing)));
    const results = await limeTorrentsTv.search("breaking bad", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.category).toBe("TV");
  });
});

describe("TorrentGalaxy Movie adapter", () => {
  it("has correct metadata", () => {
    expect(torrentGalaxyMovies.id).toBe("torrentgalaxy-movies");
    expect(torrentGalaxyMovies.groups).toEqual(["Movies"]);
    expect(torrentGalaxyMovies.categories).toEqual(["Movie"]);
  });

  it("returns movie results from listing magnets", async () => {
    const listing = `<a href="magnet:?xt=urn:btih:${"cc".repeat(20)}&dn=Inception.2010">Inception</a>`;
    vi.stubGlobal("fetch", vi.fn(async () => response(listing)));
    const results = await torrentGalaxyMovies.search("inception", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.category).toBe("Movie");
  });

  it("uses movies category in search URL", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      capturedUrl = url;
      return response("");
    }));
    await torrentGalaxyMovies.search("inception", ctx());
    expect(capturedUrl).toContain("cat=2");
  });
});

describe("TorrentGalaxy TV adapter", () => {
  it("has correct metadata", () => {
    expect(torrentGalaxyTv.id).toBe("torrentgalaxy-tv");
    expect(torrentGalaxyTv.groups).toEqual(["TV"]);
    expect(torrentGalaxyTv.categories).toEqual(["TV"]);
  });

  it("uses TV category in search URL", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      capturedUrl = url;
      return response("");
    }));
    await torrentGalaxyTv.search("breaking bad", ctx());
    expect(capturedUrl).toContain("cat=5");
  });
});

describe("TorrentDownloads Movie adapter", () => {
  it("has correct metadata", () => {
    expect(torrentDownloadsMovies.id).toBe("torrentdownloads-movies");
    expect(torrentDownloadsMovies.groups).toEqual(["Movies"]);
    expect(torrentDownloadsMovies.categories).toEqual(["Movie"]);
  });

  it("returns movie results", async () => {
    const listing = `<a href="magnet:?xt=urn:btih:${"dd".repeat(20)}&dn=Matrix.1999">The Matrix</a>`;
    vi.stubGlobal("fetch", vi.fn(async () => response(listing)));
    const results = await torrentDownloadsMovies.search("matrix", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.category).toBe("Movie");
  });

  it("uses movies category in search URL", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      capturedUrl = url;
      return response("");
    }));
    await torrentDownloadsMovies.search("matrix", ctx());
    expect(capturedUrl).toContain("cat=4");
  });
});

describe("TorrentDownloads TV adapter", () => {
  it("has correct metadata", () => {
    expect(torrentDownloadsTv.id).toBe("torrentdownloads-tv");
    expect(torrentDownloadsTv.groups).toEqual(["TV"]);
    expect(torrentDownloadsTv.categories).toEqual(["TV"]);
  });

  it("uses TV category in search URL", async () => {
    let capturedUrl = "";
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      capturedUrl = url;
      return response("");
    }));
    await torrentDownloadsTv.search("breaking bad", ctx());
    expect(capturedUrl).toContain("cat=8");
  });
});

describe("parseDirectMagnets with categories", () => {
  it("assigns the correct category to direct magnet results", () => {
    const html = `<a href="magnet:?xt=urn:btih:${"ee".repeat(20)}&dn=Movie">Movie</a>`;
    const movieResults = parseDirectMagnets(html, "test-movie", "Movie");
    expect(movieResults[0]!.category).toBe("Movie");

    const tvResults = parseDirectMagnets(html, "test-tv", "TV");
    expect(tvResults[0]!.category).toBe("TV");
  });
});

describe("htmlMagnet source with multiple categories", () => {
  it("returns empty for empty query", async () => {
    const results = await limeTorrentsMovies.search("", ctx());
    expect(results).toEqual([]);
  });

  it("handles HTTP errors gracefully", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: false, status: 500, headers: { get: () => null },
      text: () => Promise.resolve(""),
    })));
    await expect(limeTorrentsMovies.search("test", ctx())).rejects.toThrow();
  });

  it("returns empty when page has no magnets or detail links", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => response("<html><body>No results found</body></html>")));
    const results = await limeTorrentsMovies.search("xyznonexistent", ctx());
    expect(results).toEqual([]);
  });
});
