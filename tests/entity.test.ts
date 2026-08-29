import { describe, expect, it } from "vitest";
import { toMediaEntity, formatEntity } from "../src/media/entity.js";
import { normalizeResult } from "../src/media/normalize.js";
import type { MediaCategory } from "../src/model/search.js";
import { result } from "./helpers/fixtures.js";

function entityFor(title: string, category: MediaCategory) {
  const normalized = normalizeResult(
    result({ infohash: "aa".repeat(20), title, category, sourceId: "yts" }),
  );
  return normalized.entity;
}

describe("toMediaEntity", () => {
  it("extracts movie title and year from a cleaned title", () => {
    const e = entityFor("Dune.Part.Two.2024.1080p.BluRay", "Movie");
    expect(e?.kind).toBe("movie");
    expect(e?.title).toBe("Dune Part Two");
    expect(e?.year).toBe(2024);
  });

  it("extracts TV season + episode range", () => {
    const e = entityFor("Severance.S02E01-E03.720p.WEBRip", "TV");
    expect(e?.kind).toBe("tv");
    expect(e?.title).toBe("Severance");
    expect(e?.season).toBe(2);
    expect(e?.episode).toBe(1);
    expect(e?.episodeRange).toBe("1-3");
  });

  it("extracts game platform and version", () => {
    const e = entityFor("Cyberpunk.2077.PS5.v2.1.Repack", "Game");
    expect(e?.kind).toBe("game");
    expect(e?.title).toContain("Cyberpunk");
    expect(e?.platform).toBeDefined();
    expect(e?.platform).toMatch(/ps5/i);
    expect(e?.version).toBe("2.1");
  });

  it("extracts music artist / album", () => {
    const e = entityFor("Brian.Eno.-.Ambient.1.Music.for.Airports.FLAC", "Music");
    expect(e?.kind).toBe("music");
    expect(e?.artist).toBe("Brian Eno");
    expect(e?.album).toContain("Ambient 1");
  });

  it("returns a generic entity when nothing can be parsed", () => {
    const e = entityFor("misc random files", "Other");
    expect(e?.kind).toBe("other");
    expect(e?.title).toBe("misc random files");
  });

  it("is stable across common noise tokens", () => {
    const a = entityFor("The.Matrix.1999.2160p.UHD.BluRay.x265", "Movie");
    const b = entityFor("The Matrix 1999", "Movie");
    expect(a?.title).toBe(b?.title);
    expect(a?.year).toBe(1999);
  });
});

describe("formatEntity", () => {
  it("formats a movie entity", () => {
    const e = entityFor("Dune.2021.1080p", "Movie");
    const text = formatEntity(e);
    expect(text).toContain("2021");
    expect(text).toContain("1080p");
  });

  it("formats a game entity with platform and version", () => {
    const e = entityFor("Elden.Ring.PS5.v1.02", "Game");
    const text = formatEntity(e);
    expect(text).toMatch(/ps5/i);
    expect(text).toContain("1.02");
  });

  it("returns the title alone when nothing else is known", () => {
    const e = entityFor("Some.Show.S01", "TV");
    const text = formatEntity(e);
    expect(text).toContain("S01");
  });
});

describe("toMediaEntity round-trip via normalize", () => {
  it("attaches the entity on the normalized result", () => {
    const normalized = normalizeResult(
      result({ infohash: "bb".repeat(20), title: "Severance.S02E03", sourceId: "yts" }),
    );
    expect(normalized.entity?.kind).toBe("tv");
    expect(normalized.metadata.episodeRange).toBeUndefined();
  });
});