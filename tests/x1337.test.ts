import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRows, parseSizeSafe, x1337Music } from "../src/sources/x1337.js";
import type { SearchContext } from "../src/model/source.js";

function ctx(): SearchContext {
  return { signal: new AbortController().signal, timeoutMs: 2000 };
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
});

describe("1337x music search", () => {
  it("throws a parse failure (not empty results) when rows exist but cannot be parsed", async () => {
    // /torrent/ links are present but every anchor is icon-only, so the parser
    // finds zero usable rows → loud parse failure, never a silent empty set.
    const html = `<div id="table-list"><table class="table-list"><tbody><tr>
<td class="coll-1 name"><a href="/torrent/1-abc/" class="ic-16x16"><i class="ic-fa"></i></a></td>
</tr></tbody></table></div>`;
    const hrefs: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string) => {
      hrefs.push(url);
      return {
        ok: true,
        status: 200,
        headers: { get: () => null },
        text: () => Promise.resolve(html),
      } as unknown as Response;
    }));
    await expect(x1337Music.search("album", ctx())).rejects.toThrow("listing structure unrecognized");
    expect(hrefs.length).toBeGreaterThan(0);
  });

  it("reports zero results (not an error) for a genuinely empty page", async () => {
    const html = `<div id="table-list"><table class="table-list"><tbody><tr><td class="empty">No torrents found.</td></tr></tbody></table></div>`;
    vi.stubGlobal("fetch", vi.fn(async () => ({
      ok: true,
      status: 200,
      headers: { get: () => null },
      text: () => Promise.resolve(html),
    } as unknown as Response)));
    const results = await x1337Music.search("zzz nothing", ctx());
    expect(results).toEqual([]);
  });
});