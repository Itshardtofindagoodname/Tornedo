import { describe, expect, it } from "vitest";
import { magnetFromHtml, parseDetailCandidates } from "../src/sources/html-magnet.js";
import { SOURCES } from "../src/sources/registry.js";

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
});
