import { describe, expect, it } from "vitest";
import { piratebayMusic } from "../src/sources/piratebay.js";

describe("The Pirate Bay music adapter", () => {
  it("is scoped to the API's audio music and FLAC categories", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response(JSON.stringify([
      { id: "1", name: "Album FLAC", info_hash: "a".repeat(40), category: "104" },
      { id: "2", name: "Movie", info_hash: "b".repeat(40), category: "201" },
      { id: "3", name: "Album MP3", info_hash: "c".repeat(40), category: "101" },
    ]));
    try {
      const results = await piratebayMusic.search("album", {
        signal: new AbortController().signal,
        timeoutMs: 1000,
      });
      expect(results.map((result) => result.infohash)).toEqual(["a".repeat(40), "c".repeat(40)]);
      expect(results.every((result) => result.category === "Music" && result.magnet.startsWith("magnet:?xt=urn:btih:"))).toBe(true);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
