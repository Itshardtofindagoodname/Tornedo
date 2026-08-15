import { describe, expect, it, vi, afterEach } from "vitest";
import { magnetFromHtml, parseDetailCandidates, parseDirectMagnets } from "../src/sources/html-magnet.js";
import { SOURCES } from "../src/sources/registry.js";
import { limeTorrentsMusic, torrentDownloadsMusic, torrentGalaxyMusic } from "../src/sources/fallback-music.js";
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
