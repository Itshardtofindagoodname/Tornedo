import { afterEach, describe, expect, it, vi } from "vitest";
import { parseRows, parseSizeSafe, x1337Movies, x1337Tv, x1337Music } from "../src/sources/x1337.js";
import { fetchViaFlareSolverr, HttpError, looksLikeCloudflareChallenge } from "../src/sources/net.js";
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

/** A real Cloudflare interstitial, served 403 with the cf-mitigated header. */
function challengePage(): string {
  return `<!DOCTYPE html><html><head><title>Just a moment...</title></head>
<body><div id="cf-wrapper"><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>
<script>window._cf_chl_opt={cType:'managed'};</script>
<div id="cf-please-wait">Checking your browser before accessing 1337x.to.</div></div></body></html>`;
}

function jsonResponse(payload: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: () => null },
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(JSON.stringify(payload)),
  } as unknown as Response;
}

function stubFetch(urlToBody: (url: string, init?: RequestInit) => Response | Promise<Response>): void {
  vi.stubGlobal("fetch", vi.fn(async (url: string, init?: RequestInit) => urlToBody(url, init)));
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

describe("looksLikeCloudflareChallenge", () => {
  it("detects the interstitial on its 403 challenge status", () => {
    expect(looksLikeCloudflareChallenge(403, challengePage())).toBe(true);
  });

  it("detects the cf-browser-verification challenge script on 503", () => {
    const body = `<html><head><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/jsch/v1"></script>
<script src="/cdn-cgi/cf-browser-verification"></script></head><body></body></html>`;
    expect(looksLikeCloudflareChallenge(503, body)).toBe(true);
  });

  it("detects the _cf_chl_opt_ bootstrap inline on a 200 challenge", () => {
    expect(looksLikeCloudflareChallenge(200, "<script>window._cf_chl_opt={cType:'managed'};</script>")).toBe(true);
  });

  it("detects a cf-mitigated error page", () => {
    expect(looksLikeCloudflareChallenge(403, '<html><body>cf-mitigated: challenge</body></html>')).toBe(true);
  });

  it("accepts a real 200 listing page", () => {
    expect(looksLikeCloudflareChallenge(200, listing([row({})]))).toBe(false);
  });

  it("accepts an ordinary 403 that is not a challenge", () => {
    expect(looksLikeCloudflareChallenge(403, "<html><head><title>Forbidden</title></head><body>Access denied</body></html>")).toBe(false);
  });

  it("does not mistake a torrent title starting with 'Just a Moment' for a challenge", () => {
    const html = `<html><head><title>Just a Moment in Time (2021) 1080p</title></head><body>${listing([row({})])}</body></html>`;
    expect(looksLikeCloudflareChallenge(200, html)).toBe(false);
  });

  it("treats an empty body as no challenge", () => {
    expect(looksLikeCloudflareChallenge(403, "")).toBe(false);
  });
});

describe("fetchViaFlareSolverr", () => {
  const BASE = "http://localhost:8191";

  it("POSTs request.get to /v1 and returns the solved body and status", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    stubFetch((url, init) => {
      calls.push({ url, init });
      return jsonResponse({
        status: "ok",
        message: "Challenge solved",
        solution: { url: "https://1337x.to/category-search", status: 200, response: "<html>solved</html>" },
      });
    });
    const out = await fetchViaFlareSolverr("https://1337x.to/category-search/album/Music/1/", {
      baseUrl: BASE,
      timeoutMs: 1234,
    });
    expect(out).toEqual({ body: "<html>solved</html>", status: 200 });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${BASE}/v1`);
    expect(calls[0]!.init?.method).toBe("POST");
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({
      cmd: "request.get",
      url: "https://1337x.to/category-search/album/Music/1/",
      maxTimeout: 1234,
    });
  });

  it("tolerates a trailing slash on the configured base URL", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return jsonResponse({ status: "ok", solution: { status: 200, response: "ok" } });
    });
    await fetchViaFlareSolverr("https://1337x.to/", { baseUrl: `${BASE}/` });
    expect(urls[0]).toBe(`${BASE}/v1`);
  });

  it("defaults the solution status to 200 when the solver omits it", async () => {
    stubFetch(() => jsonResponse({ status: "ok", solution: { response: "<html>solved</html>" } }));
    const out = await fetchViaFlareSolverr("https://1337x.to/", { baseUrl: BASE });
    expect(out).toEqual({ body: "<html>solved</html>", status: 200 });
  });

  it("throws an HttpError with the solver's message when status is not ok", async () => {
    stubFetch(() =>
      jsonResponse({ status: "error", message: "Error solving challenge. Timeout after 30000 milliseconds." }),
    );
    await expect(fetchViaFlareSolverr("https://1337x.to/", { baseUrl: BASE })).rejects.toThrow(HttpError);
    await expect(fetchViaFlareSolverr("https://1337x.to/", { baseUrl: BASE })).rejects.toThrow(
      /could not solve .*Timeout after 30000/,
    );
  });

  it("throws when the solver answers with a non-2xx HTTP status", async () => {
    stubFetch(() => jsonResponse({ status: "ok", solution: { response: "" } }, 500));
    await expect(fetchViaFlareSolverr("https://1337x.to/", { baseUrl: BASE })).rejects.toThrow(
      /FlareSolverr at .* returned HTTP 500/,
    );
  });

  it("throws an HttpError when the proxy is unreachable", async () => {
    stubFetch(() => {
      throw new TypeError("fetch failed");
    });
    const err = await fetchViaFlareSolverr("https://1337x.to/", { baseUrl: BASE }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(0);
    expect((err as Error).message).toMatch(/fetch failed/);
  });

  it("raises a CancelledError when the caller's signal aborts", async () => {
    const controller = new AbortController();
    controller.abort();
    stubFetch(() => jsonResponse({ status: "ok", solution: { status: 200, response: "" } }));
    await expect(
      fetchViaFlareSolverr("https://1337x.to/", { baseUrl: BASE, signal: controller.signal }),
    ).rejects.toThrow("request cancelled");
  });

  it("never runs more than three solves at once, queuing the rest", async () => {
    let inFlight = 0;
    let peak = 0;
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    stubFetch(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await gate;
      inFlight--;
      return jsonResponse({ status: "ok", solution: { status: 200, response: "ok" } });
    });
    const all = Promise.all(
      Array.from({ length: 8 }, (_, i) => fetchViaFlareSolverr(`https://1337x.to/${i}`, { baseUrl: BASE })),
    );
    // Let the first batch reach the (stubbed) transport before releasing.
    await new Promise((r) => setTimeout(r, 0));
    expect(peak).toBe(3);
    release!();
    await all;
    // 8 solves through a cap of 3 all completed, so no slot was stranded.
    expect(peak).toBe(3);
  });

  it("releases its slot when a solve fails, so a bad one cannot deadlock the queue", async () => {
    let calls = 0;
    stubFetch(() => {
      calls++;
      if (calls === 1) throw new TypeError("fetch failed");
      return jsonResponse({ status: "ok", solution: { status: 200, response: "ok" } });
    });
    const results = await Promise.allSettled([
      fetchViaFlareSolverr("https://1337x.to/0", { baseUrl: BASE }),
      fetchViaFlareSolverr("https://1337x.to/1", { baseUrl: BASE }),
      fetchViaFlareSolverr("https://1337x.to/2", { baseUrl: BASE }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
  });
});

describe("1337x Cloudflare handling", () => {
  function fsCtx(): SearchContext {
    return {
      signal: new AbortController().signal,
      timeoutMs: 2000,
      flaresolverr: { enabled: true, url: "http://localhost:8191", timeoutMs: 5000 },
    };
  }

  it("replays the challenged mirror through FlareSolverr and returns real results", async () => {
    const calls: { url: string; init?: RequestInit }[] = [];
    stubFetch((url, init) => {
      calls.push({ url, init });
      // Every mirror serves the interstitial, but only FlareSolverr can solve it.
      if (url.includes("/v1")) {
        return jsonResponse({
          status: "ok",
          solution: {
            status: 200,
            response: listing([row({ name: "Album Solved", href: "/torrent/1/" })]) +
              `<a href="magnet:?xt=urn:btih:${HASH}&dn=Solved">m</a>`,
          },
        });
      }
      if (url.includes("/torrent/1/")) return response(`<a href="magnet:?xt=urn:btih:${HASH}">m</a>`);
      return response(challengePage());
    });
    const results = await x1337Music.search("album", fsCtx());
    expect(results).toHaveLength(1);
    expect(results[0]!.title).toBe("Album Solved");
    const solverCall = calls.find((c) => c.url === "http://localhost:8191/v1");
    expect(solverCall).toBeDefined();
    expect(JSON.parse(String(solverCall!.init?.body)).cmd).toBe("request.get");
  });

  it("falls back to an actionable error when FlareSolverr is disabled", async () => {
    stubFetch(() => response(challengePage(), 403));
    await expect(x1337Music.search("album", ctx())).rejects.toThrow(
      "x1337-music: blocked by Cloudflare — enable FlareSolverr in config to bypass",
    );
  });

  it("never contacts FlareSolverr when it is not enabled", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      return response(challengePage(), 403);
    });
    await expect(x1337Music.search("album", ctx())).rejects.toThrow("blocked by Cloudflare");
    expect(urls.some((u) => u.includes("/v1"))).toBe(false);
  });

  it("solves challenged detail pages, not just the listing", async () => {
    let solved = 0;
    stubFetch((url) => {
      if (url.includes("/v1")) {
        solved++;
        return jsonResponse({
          status: "ok",
          solution: { status: 200, response: `<a href="magnet:?xt=urn:btih:${HASH}&dn=Solved">m</a>` },
        });
      }
      // The listing is served, but every detail page is challenged.
      if (url.includes("/category-search")) return response(listing([row({ name: "Album", href: "/torrent/1/" })]));
      return response(challengePage(), 403);
    });
    const results = await x1337Music.search("album", fsCtx());
    expect(results).toHaveLength(1);
    expect(results[0]!.infohash).toBe(HASH);
    expect(solved).toBe(1);
  });

  it("treats a 200 interstitial detail page as a block, not a parse failure", async () => {
    stubFetch((url) => {
      if (url.includes("/category-search")) return response(listing([row({ name: "Album", href: "/torrent/1/" })]));
      return response(challengePage());
    });
    await expect(x1337Music.search("album", ctx())).rejects.toThrow(
      "x1337-music: blocked by Cloudflare — enable FlareSolverr in config to bypass",
    );
  });

  it("does not spend a solve when every detail page is rate limited", async () => {
    const urls: string[] = [];
    stubFetch((url) => {
      urls.push(url);
      if (url.includes("/category-search")) return response(listing([row({ name: "Album", href: "/torrent/1/" })]));
      return response("Too many requests", 429);
    });
    await expect(x1337Music.search("album", fsCtx())).rejects.toThrow("all 1 detail pages failed to load");
    expect(urls.some((u) => u.includes("/v1"))).toBe(false);
  });

  it("bounds the listing fan-out so a blocked race cannot spend every mirror", async () => {
    let solves = 0;
    stubFetch((url) => {
      if (url.includes("/v1")) {
        solves++;
        return jsonResponse({ status: "error", message: "Timeout" });
      }
      return response(challengePage(), 403);
    });
    await expect(x1337Music.search("album", fsCtx())).rejects.toThrow();
    // 4 mirrors are refused but only MAX_SOLVED_MIRRORS are ever replayed.
    expect(solves).toBeGreaterThan(0);
    expect(solves).toBeLessThanOrEqual(2);
  });

  describe("does not escalate failures that a solve cannot fix", () => {
    /** Each case must leave FlareSolverr untouched and surface the real cause. */
    const cases: { name: string; respond: () => Response; expect: RegExp }[] = [
      { name: "rate limited (429)", respond: () => response("Too many requests", 429), expect: /HTTP 429/ },
      { name: "not found (404)", respond: () => response("nope", 404), expect: /HTTP 404/ },
      { name: "origin outage (500)", respond: () => response("boom", 500), expect: /HTTP 500/ },
    ];
    for (const c of cases) {
      it(`on the listing: ${c.name}`, async () => {
        const urls: string[] = [];
        stubFetch((url) => {
          urls.push(url);
          return c.respond();
        });
        await expect(x1337Music.search("album", fsCtx())).rejects.toThrow(c.expect);
        expect(urls.some((u) => u.includes("/v1"))).toBe(false);
      });
    }
  });
});
