import { describe, expect, it } from "vitest";
import { parseTitle } from "../src/media/title.js";
import { classifyMedia } from "../src/media/classify.js";
import { normalizeResult } from "../src/media/normalize.js";
import { result } from "./helpers/fixtures.js";

function classify(raw: string, hint?: "Movie" | "TV" | "Anime" | "Game" | "Music") {
  const parsed = parseTitle(raw);
  return classifyMedia({ title: raw, parsed, hint });
}

describe("classifyMedia", () => {
  it("classifies movies by year", () => {
    expect(classify("Interstellar.2014.1080p")).toBe("Movie");
  });

  it("classifies TV by season/episode", () => {
    expect(classify("Game.of.Thrones.S08E03.1080p")).toBe("TV");
  });

  it("classifies games by scene keywords", () => {
    expect(classify("Cyberpunk.2077.Repack.by.FitGirl")).toBe("Game");
    expect(classify("Baldur.Gate.3.GOG.Rip")).toBe("Game");
  });

  it("classifies music by lossless codec", () => {
    expect(classify("Radiohead-OK Computer-1997-FLAC-24bit")).toBe("Music");
  });

  it("classifies music by discography/soundtrack signals with a year", () => {
    expect(classify("Hans Zimmer - Inception OST 2010")).toBe("Music");
  });

  it("classifies audiobooks and podcasts", () => {
    expect(classify("Some Book Audiobook Unabridged")).toBe("Audiobook");
    expect(classify("My Podcast Episode 12")).toBe("Podcast");
  });

  it("respects hint but lets signals win", () => {
    expect(classify("Cyberpunk.2077.Repack", "TV")).toBe("Game");
  });

  it("falls back to Other", () => {
    expect(classify("misc collection 2020")).toBe("Movie");
    expect(classify("random stuff here")).toBe("Other");
  });
});

describe("normalizeResult", () => {
  it("produces a normalized result with metadata", () => {
    const raw = result({
      infohash: "aa".repeat(20),
      title: "Dune.2021.1080p.BluRay.x264",
      size: 1024,
      seeders: 10,
      sourceId: "yts",
    });
    const n = normalizeResult(raw);
    expect(n.title).toBe("Dune");
    expect(n.infohash).toBe("aa".repeat(20));
    expect(n.metadata.year).toBe(2021);
    expect(n.metadata.quality).toBe("1080p");
    expect(n.sources).toEqual(["yts"]);
  });
});