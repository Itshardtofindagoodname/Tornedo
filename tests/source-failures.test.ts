import { afterEach, describe, expect, it, vi } from "vitest";
import type { SearchContext } from "../src/model/source.js";
import { htmlMagnetMusicSource } from "../src/sources/html-magnet.js";
import { HttpError, ParseError } from "../src/sources/net.js";
import { x1337Music } from "../src/sources/x1337.js";

const HASH = "aa".repeat(20);

function response(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

function ctx(): SearchContext {
  return { signal: new AbortController().signal, timeoutMs: 2000 };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(urlToBody: (url: string) => Response): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => urlToBody(url)));
}

const MAGNET_SITE = {
  id: "test-music",
  name: "Test Music",
  homepage: "https://example.com",
  searchUrl: (q: string) => `https://example.com/search?q=${encodeURIComponent(q)}`,
  detailPath: /^\/torrent\/[^/?#]+\.html(?:[?#].*)?$/i,
};

describe("htmlMagnetMusicSource failure semantics", () => {
  it("resolves results directly from listing magnets even when detail links changed", async () => {
    stubFetch(() => response(`<a href="magnet:?xt=urn:btih:${HASH}">get</a>`));
    const results = await htmlMagnetMusicSource(MAGNET_SITE).search("album", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe(HASH);
  });

  it("returns an empty list for a genuinely empty listing (no structure signal)", async () => {
    stubFetch(() => response("<html><body>no results</body></html>"));
    const results = await htmlMagnetMusicSource(MAGNET_SITE).search("album", ctx());
    expect(results).toEqual([]);
  });

  it("surfaces a parse error when every detail page loads but has no magnet", async () => {
    stubFetch((url) =>
      url.includes("/search") ? response(`<a href="/torrent/1.html">Album</a>`) : response("<html>no magnet</html>"),
    );
    await expect(htmlMagnetMusicSource(MAGNET_SITE).search("album", ctx())).rejects.toBeInstanceOf(ParseError);
  });

  it("classifies all-detail-HTTP-failures as unavailability, not parsing", async () => {
    stubFetch((url) =>
      url.includes("/search") ? response(`<a href="/torrent/1.html">Album</a>`) : response("", 500),
    );
    await expect(htmlMagnetMusicSource(MAGNET_SITE).search("album", ctx())).rejects.toBeInstanceOf(HttpError);
  });

  it("returns partial results when some detail pages resolve", async () => {
    stubFetch((url) => {
      if (url.includes("/search")) return response(`<a href="/torrent/1.html">Album One</a><a href="/torrent/2.html">Album Two</a>`);
      if (url.endsWith("/1.html")) return response(`<a href="magnet:?xt=urn:btih:${HASH}&dn=One">m</a>`);
      return response("", 500);
    });
    const results = await htmlMagnetMusicSource(MAGNET_SITE).search("album", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe(HASH);
    expect(results[0]!.category).toBe("Music");
  });

  it("returns full results on the happy path with verified infohashes", async () => {
    stubFetch((url) =>
      url.includes("/search")
        ? response(`<a href="/torrent/1.html">Album FLAC</a>`)
        : response(`<a href="magnet:?xt=urn:btih:${HASH}&dn=Album">m</a>`),
    );
    const results = await htmlMagnetMusicSource(MAGNET_SITE).search("album", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.magnet).toContain(`urn:btih:${HASH}`);
  });
});

function x1337Listing(): string {
  return (
    `<table class="table-list">` +
    `<tr><td class="coll-1"><a href="/torrent/1">Album FLAC</a></td>` +
    `<td class="coll-2 seeds">42</td><td class="coll-3 leeches">3</td><td class="coll-4 size">1.4 GB</td></tr>` +
    `</table>`
  );
}

describe("x1337Music failure semantics", () => {
  it("surfaces a parse error when the listing structure is unrecognized", async () => {
    stubFetch(() => response("<html><body>down for maintenance</body></html>"));
    await expect(x1337Music.search("album", ctx())).rejects.toBeInstanceOf(ParseError);
  });

  it("surfaces a parse error when detail pages load but carry no magnet", async () => {
    stubFetch((url) => (url.includes("/category-search") ? response(x1337Listing()) : response("<html>no magnet</html>")));
    await expect(x1337Music.search("album", ctx())).rejects.toBeInstanceOf(ParseError);
  });

  it("classifies all-detail-HTTP-failures as unavailability", async () => {
    stubFetch((url) => (url.includes("/category-search") ? response(x1337Listing()) : response("", 500)));
    await expect(x1337Music.search("album", ctx())).rejects.toBeInstanceOf(HttpError);
  });

  it("returns partial results when some detail pages resolve", async () => {
    stubFetch((url) => {
      if (url.includes("/category-search")) return response(x1337Listing());
      if (url.includes("/torrent/1")) return response(`<a href="magnet:?xt=urn:btih:${HASH}&dn=Album">m</a>`);
      return response("", 500);
    });
    const results = await x1337Music.search("album", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe(HASH);
  });
});