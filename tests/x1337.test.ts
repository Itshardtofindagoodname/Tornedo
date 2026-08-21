import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRows, parseSizeSafe, x1337Movies, x1337Tv, x1337Music } from "../src/sources/x1337.js";
import type { SearchContext } from "../src/model/source.js";

function ctx(): SearchContext {
  return { signal: new AbortController().signal, timeoutMs: 2000 };
}

function response(body: string, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    text: () => Promise.resolve(body),
  } as unknown as Response;
}

/** Realistic 1337x table markup with an icon anchor, comma-separated seeds, and nested tags. */
function row(opts: { name?: string; href?: string; seeds?: string; leeches?: string; size?: string }): string {
  const href = opts.href ?? "/torrent/12345-album-name/";
  const name = opts.name ?? "Artist - Album (2024) FLAC";
  return `<tr>
<td class="coll-1 name">
  <a href="${href}" class="ic-16x16"> <i class="ic-fa"></i></a>
  <a href="${href}">${name}</a>
</td>
<td class="coll-2 seeds">${opts.seeds ?? "12,345"}</td>
<td class="coll-3 leeches">${opts.leeches ?? "67"}</td>
<td class="coll-4 size">${opts.size ?? "1.2 GB"}</td>
<td class="coll-5">date</td>
</tr>`;
}

function listing(rows: string[]): string {
  return `<div id="table-list"><table class="table-list"><tbody>${rows.join("")}</tbody></table></div>`;
}

function stubFetch(urlToBody: (url: string) => Response): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string) => urlToBody(url)));
}

const HASH = "aa".repeat(20);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("1337x music row parsing", () => {
  it("parses rows with icon anchors, comma-separated seeders and nested tags", () => {
    const rows = parseRows(listing([row({})]));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      name: "Artist - Album (2024) FLAC",
      path: "/torrent/12345-album-name/",
      seeders: 12345,
      leechers: 67,
      sizeBytes: 1_200_000_000,
    });
  });

  it("tolerates reordered class attributes on cells", () => {
    const html = `<div id="table-list"><table class="table-list"><tbody><tr>
<td><a href="/torrent/1-abc/">Album</a></td>
<td class="seeds coll-2">9</td>
<td class="leeches coll-3">1</td>
<td class="size coll-4">800 MB</td>
</tr></tbody></table></div>`;
    const rows = parseRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.seeders).toBe(9);
    expect(rows[0]!.sizeBytes).toBe(800_000_000);
  });

  it("ignores rows whose name anchor is icon-only", () => {
    const html = `<div id="table-list"><table class="table-list"><tbody><tr>
<td class="coll-1 name"><a href="/torrent/1-abc/" class="ic-16x16"><i></i></a></td>
</tr></tbody></table></div>`;
    expect(parseRows(html)).toEqual([]);
  });

  it("parses only torrent detail links", () => {
    const html = `<div id="table-list"><table class="table-list"><tbody><tr>
<td class="coll-1 name"><a href="/top100">Top 100</a></td>
</tr></tbody></table></div>`;
    expect(parseRows(html)).toEqual([]);
  });
});

describe("parseSizeSafe", () => {
  it("handles MB, GB and GiB suffixes", () => {
    expect(parseSizeSafe("800 MB")).toBe(800_000_000);
    expect(parseSizeSafe("1.5 GB")).toBe(1_500_000_000);
    expect(parseSizeSafe("700 MiB")).toBe(700_000_000);
  });
  it("returns 0 for unknown units", () => {
    expect(parseSizeSafe("lots")).toBe(0);
  });
  it("handles TB", () => {
    expect(parseSizeSafe("2 TB")).toBe(2_000_000_000_000);
  });
  it("handles zero size", () => {
    expect(parseSizeSafe("0 GB")).toBe(0);
  });
});

describe("1337x music search", () => {
  it("throws a parse failure (not empty results) when rows exist but cannot be parsed", async () => {
    const html = `<div id="table-list"><table class="table-list"><tbody><tr>
<td class="coll-1 name"><a href="/torrent/1-abc/" class="ic-16x16"><i class="ic-fa"></i></a></td>
</tr></tbody></table></div>`;
    stubFetch(() => response(html));
    await expect(x1337Music.search("album", ctx())).rejects.toThrow("listing structure unrecognized");
  });

  it("reports zero results (not an error) for a genuinely empty page", async () => {
    const html = `<div id="table-list"><table class="table-list"><tbody><tr><td class="empty">No torrents found.</td></tr></tbody></table></div>`;
    stubFetch(() => response(html));
    const results = await x1337Music.search("zzz nothing", ctx());
    expect(results).toEqual([]);
  });

  it("returns partial results when some detail pages resolve", async () => {
    stubFetch((url) => {
      if (url.includes("/category-search")) return response(listing([
        row({ name: "Album One", href: "/torrent/1/" }),
        row({ name: "Album Two", href: "/torrent/2/" }),
      ]));
      if (url.includes("/torrent/1/")) return response(`<a href="magnet:?xt=urn:btih:${HASH}&dn=One">m</a>`);
      return response("", 500);
    });
    const results = await x1337Music.search("album", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe(HASH);
    expect(results[0]!.category).toBe("Music");
  });

  it("extracts upload date from detail pages", async () => {
    stubFetch((url) => {
      if (url.includes("/category-search")) return response(listing([
        row({ name: "Album", href: "/torrent/1/" }),
      ]));
      return response(`<a href="magnet:?xt=urn:btih:${HASH}">m</a><strong>Date uploaded</strong><span>Jun. 26th  '24</span>`);
    });
    const results = await x1337Music.search("album", ctx());
    expect(results[0]!.added).toBeDefined();
    expect(results[0]!.added).toBeGreaterThan(0);
  });
});

describe("1337x Movies adapter", () => {
  it("has correct metadata", () => {
    expect(x1337Movies.id).toBe("x1337-movies");
    expect(x1337Movies.groups).toContain("Movies");
    expect(x1337Movies.categories).toContain("Movie");
    expect(x1337Movies.reportsHealth).toBe(true);
    expect(x1337Movies.concurrency).toBe(4);
  });

  it("searches with Movies category", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      if (url.includes("/category-search")) return response(listing([
        row({ name: "Dune 2021", href: "/torrent/1/" }),
      ]));
      if (url.includes("/torrent/1/")) return response(`<a href="magnet:?xt=urn:btih:${HASH}&dn=Dune">m</a>`);
      return response("");
    });
    const results = await x1337Movies.search("dune", ctx());
    expect(results).toHaveLength(1);
    const listingUrl = urls.find((u) => u.includes("/category-search"))!;
    expect(listingUrl).toContain("/Movies/");
  });

  it("uses popular-movies for empty queries", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return response(listing([]));
    });
    try {
      await x1337Movies.search("", ctx());
    } catch {
      // Expected
    }
    const listingUrl = urls.find((u) => !u.includes("/torrent/"));
    expect(listingUrl).toContain("/popular-movies");
  });

  it("returns movie results with correct category", async () => {
    stubFetch((url) => {
      if (url.includes("/category-search")) return response(listing([
        row({ name: "Dune 2021 1080p", href: "/torrent/1/" }),
      ]));
      return response(`<a href="magnet:?xt=urn:btih:${HASH}&dn=Dune">m</a>`);
    });
    const results = await x1337Movies.search("dune", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.category).toBe("Movie");
    expect(results[0]!.infohash).toBe(HASH);
  });
});

describe("1337x TV adapter", () => {
  it("has correct metadata", () => {
    expect(x1337Tv.id).toBe("x1337-tv");
    expect(x1337Tv.groups).toContain("TV");
    expect(x1337Tv.categories).toContain("TV");
  });

  it("searches with TV category", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      if (url.includes("/category-search")) return response(listing([]));
      return response("");
    });
    try {
      await x1337Tv.search("breaking bad", ctx());
    } catch {
      // Expected
    }
    const listingUrl = urls.find((u) => u.includes("/category-search"));
    expect(listingUrl).toContain("/TV/");
  });

  it("uses popular-tv for empty queries", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return response(listing([]));
    });
    try {
      await x1337Tv.search("", ctx());
    } catch {
      // Expected
    }
    const listingUrl = urls.find((u) => !u.includes("/torrent/"));
    expect(listingUrl).toContain("/popular-tv");
  });

  it("returns TV results with correct category", async () => {
    stubFetch((url) => {
      if (url.includes("/category-search")) return response(listing([
        row({ name: "Breaking Bad S01E01", href: "/torrent/1/" }),
      ]));
      return response(`<a href="magnet:?xt=urn:btih:${HASH}&dn=Breaking+Bad">m</a>`);
    });
    const results = await x1337Tv.search("breaking bad", ctx());
    expect(results).toHaveLength(1);
    expect(results[0]!.category).toBe("TV");
  });
});

describe("1337x failure isolation", () => {
  it("handles mirror rotation when first host fails", async () => {
    let callCount = 0;
    stubFetch((url) => {
      callCount++;
      if (url.includes("1337x.to") && url.includes("/category-search")) {
        return response("", 500);
      }
      if (url.includes("1337x.st") && url.includes("/category-search")) {
        return response(listing([row({ name: "Test", href: "/torrent/1/" })]));
      }
      if (url.includes("/torrent/1/")) {
        return response(`<a href="magnet:?xt=urn:btih:${HASH}&dn=Test">m</a>`);
      }
      return response("", 500);
    });
    const results = await x1337Music.search("test", ctx());
    expect(results).toHaveLength(1);
    expect(callCount).toBeGreaterThan(1);
  });
});
