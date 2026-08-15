import { describe, expect, it } from "vitest";
import { parseRssItem, splitItems, unescapeEntities } from "../src/sources/rss.js";

const HASH = "23DDF6E1CAA62C1A716E27A7372F35DD0120EEA0".toLowerCase();

describe("RSS parsing", () => {
  it("unescapes HTML-entity-encoded ampersands inside FitGirl magnets", () => {
    // FitGirl (WordPress) emits magnets exactly like this: the `&#038;` between
    // params survives into the extracted href and must be decoded to `&`.
    const item =
      `<item>` +
      `<title>Game &#038; Soundtrack (FitGirl)</title>` +
      `<link>https://fitgirl.site/post/123</link>` +
      `<pubDate>Sat, 15 Aug 2026 12:00:00 +0000</pubDate>` +
      `<description><a href="magnet:?xt=urn:btih:${HASH}&#038;dn=Game+%26+Soundtrack&#038;tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce">magnet</a></description>` +
      `</item>`;

    const parsed = parseRssItem(item);
    // The bug: `&#038;` left in the magnet mangled every `tr`/`dn` parameter.
    expect(parsed.magnet).toContain("&dn=");
    expect(parsed.magnet).toContain("&tr=udp%3A%2F%2Ftracker.opentrackr.org%3A1337%2Fannounce");
    expect(parsed.magnet!.match(/urn:btih:([a-zA-Z0-9]+)/i)![1]!.toLowerCase()).toBe(HASH);
  });

  it("unescapes the classic FitGirl double-encoding for titles and descriptions", () => {
    expect(unescapeEntities("Crysis &#038; Warhead &#8211; &#8217;best&#8217; &lt;v2&gt;")).toBe(
      "Crysis & Warhead - 'best' <v2>",
    );
  });

  it("splits items and parses infohash-safe magnets", () => {
    const xml = `<rss><channel><item><title>T</title><link>L</link><description><a href="magnet:?xt=urn:btih:${HASH}">m</a></description></item></channel></rss>`;
    const frags = splitItems(xml);
    expect(frags.length).toBe(1);
    const parsed = parseRssItem(frags[0]!);
    expect(parsed.magnet).toContain(`urn:btih:${HASH}`);
  });
});