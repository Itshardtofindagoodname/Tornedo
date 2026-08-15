import { afterEach, describe, expect, it, vi } from "vitest";
import type { InternetArchiveConfig } from "../src/config/config.js";
import { deriveSourceInfoHash, internetArchiveSource } from "../src/sources/internet-archive.js";
import type { SearchContext } from "../src/model/source.js";

function jsonResponse(body: unknown): Response {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: () => Promise.resolve(body),
  } as unknown as Response;
}

function ctx(): SearchContext {
  return { signal: new AbortController().signal, timeoutMs: 2000 };
}

const CONFIG: InternetArchiveConfig = { enabled: true, timeoutMs: 3000, maxResults: 5 };

function searchPayload(docs: unknown[]): unknown {
  return { response: { numFound: docs.length, docs } };
}

function metadataPayload(files: { name: string; format: string; size: number }[]): unknown {
  return {
    metadata: {
      identifier: "album-1978",
      title: "Album 1978",
      creator: ["Brian Eno"],
      collection: ["GratefulDead"],
      date: "1978-01-01",
      mediatype: "audio",
      licenseurl: "http://example.com/cc0",
    },
    files,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Internet Archive provider", () => {
  it("normalizes an item with downloadable audio into a SearchResult", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        calls.push(url);
        if (url.includes("advancedsearch")) {
          return jsonResponse(
            searchPayload([
              {
                identifier: "album-1978",
                title: "Album 1978",
                creator: ["Brian Eno"],
                date: "1978-01-01",
                downloads: 4321,
                mediatype: "audio",
              },
            ]),
          );
        }
        return jsonResponse(
          metadataPayload([
            { name: "track1.mp3", format: "MP3", size: 1000 },
            { name: "cover.jpg", format: "ItemTile", size: 10 },
          ]),
        );
      }),
    );
    const source = internetArchiveSource(CONFIG);
    const results = await source.search("album 1978", ctx());
    expect(results).toHaveLength(1);
    const r = results[0]!;
    expect(r.infohash).toBe(deriveSourceInfoHash("ia", "album-1978"));
    expect(r.title).toBe("Album 1978");
    expect(r.size).toBe(1000);
    expect(r.files).toBe(1);
    expect(r.category).toBe("Music");
    expect(r.magnet).toBe("ia://album-1978");
    expect(r.torrentUrl).toContain("archive.org/download/album-1978");
    expect(r.sourceMetadata?.identifier).toBe("album-1978");
    expect(r.sourceMetadata?.creators).toEqual(["Brian Eno"]);
    expect(r.sourceMetadata?.downloads).toBe(4321);
    expect(calls.filter((u) => u.includes("advancedsearch"))).toHaveLength(1);
  });

  it("quotes multi-word queries in the Lucene query", async () => {
    let searchUrl = "";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("advancedsearch")) {
          searchUrl = url;
          return jsonResponse(searchPayload([]));
        }
        return jsonResponse(metadataPayload([]));
      }),
    );
    const source = internetArchiveSource(CONFIG);
    await source.search("two words", ctx());
    const q = new URL(searchUrl).searchParams.get("q");
    expect(q).toContain('mediatype:audio AND ("two words")');
  });

  it("returns [] when the search yields no documents", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(searchPayload([]))));
    const source = internetArchiveSource(CONFIG);
    expect(await source.search("zzz nothing", ctx())).toEqual([]);
  });

  it("skips items whose files are not downloadable audio", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("advancedsearch")) {
          return jsonResponse(searchPayload([{ identifier: "tiles-only", title: "Tiles" }]));
        }
        return jsonResponse(metadataPayload([{ name: "cover.jpg", format: "ItemTile", size: 100 }]));
      }),
    );
    const source = internetArchiveSource(CONFIG);
    expect(await source.search("tiles", ctx())).toEqual([]);
  });

  it("skips (not fails) an item whose metadata is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (url.includes("advancedsearch")) {
          return jsonResponse(searchPayload([{ identifier: "gone", title: "Gone" }]));
        }
        return jsonResponse(metadataPayload([]));
      }),
    );
    const source = internetArchiveSource(CONFIG);
    expect(await source.search("gone", ctx())).toEqual([]);
  });

  it("is stable and collision-free per item identifier", () => {
    const a = deriveSourceInfoHash("ia", "album-1978");
    const b = deriveSourceInfoHash("ia", "album-1979");
    const c = deriveSourceInfoHash("ia", "album-1978");
    expect(a).toMatch(/^[0-9a-f]{40}$/);
    expect(a).toBe(c);
    expect(a).not.toBe(b);
  });
});