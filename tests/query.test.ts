import { describe, expect, it } from "vitest";
import { analyzeQuery, describeInference, isConfident } from "../src/media/query.js";

describe("analyzeQuery", () => {
  it("detects a movie title with year", () => {
    const q = analyzeQuery("Dune 2021");
    expect(q.mediaType).toBe("Movie");
    expect(q.title).toContain("Dune");
    expect(q.year).toBe(2021);
    expect(isConfident(q)).toBe(true);
  });

  it("detects a TV episode (SxxExx) and season", () => {
    const q = analyzeQuery("Severance S02E03");
    expect(q.mediaType).toBe("TV");
    expect(q.season).toBe(2);
    expect(q.episode).toBe(3);
    expect(q.title).toContain("Severance");
    expect(isConfident(q)).toBe(true);
  });

  it("splits music into artist / album on ' - '", () => {
    const q = analyzeQuery("Brian Eno - Ambient 1");
    expect(q.mediaType).toBe("Music");
    expect(q.artist).toBe("Brian Eno");
    expect(q.album).toBe("Ambient 1");
    expect(q.title).toBe("Ambient 1");
    expect(isConfident(q)).toBe(true);
  });

  it("detects games by platform signal", () => {
    const q = analyzeQuery("Cyberpunk 2077 ps5");
    expect(q.mediaType).toBe("Game");
    expect(q.title).toContain("Cyberpunk");
    expect(q.platform).toMatch(/ps5/i);
  });

  it("detects anime", () => {
    const q = analyzeQuery("Frieren Beyond Journeys End anime 1080p");
    expect(q.mediaType).toBe("Anime");
    expect(q.title).toContain("Frieren");
  });

  it("detects audiobooks", () => {
    const q = analyzeQuery("Meditations Marcus Aurelius audiobook");
    expect(q.mediaType).toBe("Audiobook");
    expect(q.title).toContain("Meditations");
  });

  it("detects podcasts", () => {
    const q = analyzeQuery("lex fridman podcast episode 400");
    expect(q.mediaType).toBe("Podcast");
  });

  it("falls back to a low-confidence generic query", () => {
    const q = analyzeQuery("interstellar travel notes");
    expect(q.mediaType).toBeUndefined();
    expect(isConfident(q)).toBe(false);
    expect(describeInference(q)).toContain("interstellar travel notes");
  });

  it("is case-insensitive and trims whitespace", () => {
    const q = analyzeQuery("  MANDALORIAN S02E01  ");
    expect(q.title?.toLowerCase()).toContain("mandalorian");
    expect(q.season).toBe(2);
  });
});

describe("describeInference", () => {
  it("renders a human summary", () => {
    const q = analyzeQuery("Dune Part Two 2024 4k");
    const text = describeInference(q);
    expect(text).toContain("Dune");
    expect(text).toContain("2024");
  });
});