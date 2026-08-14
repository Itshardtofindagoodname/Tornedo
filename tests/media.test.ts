import { describe, expect, it } from "vitest";
import { parseTitle, qualityTier } from "../src/media/title.js";
import { formatAudio, parseAudio } from "../src/media/audio.js";

describe("parseTitle", () => {
  it("parses a standard scene release", () => {
    const p = parseTitle("Interstellar.2014.1080p.BluRay.x264-RARBG");
    expect(p.title).toBe("Interstellar");
    expect(p.year).toBe(2014);
    expect(p.quality).toBe("1080p");
    expect(p.source).toBe("BluRay");
    expect(p.codec).toBe("x264");
    expect(p.group).toBe("RARBG");
  });

  it("parses season and episode", () => {
    const p = parseTitle("Game.Of.Thrones.S08E03.720p.HDTV.x264");
    expect(p.season).toBe(8);
    expect(p.episode).toBe(3);
    expect(p.quality).toBe("720p");
    expect(p.source).toBe("HDTV");
  });

  it("parses season word form", () => {
    const p = parseTitle("Stranger Things Season 4 1080p WEB-DL");
    expect(p.season).toBe(4);
  });

  it("parses 4K / UHD", () => {
    const p = parseTitle("Dune.2021.4K.BluRay.HEVC");
    expect(p.quality).toBe("2160p");
    expect(p.codec).toBe("hevc");
  });

  it("detects HDR and 3D", () => {
    const p = parseTitle("Avatar 3D 2010 1080p HDR BluRay");
    expect(p.is3d).toBe(true);
    expect(p.hdr).toBe(true);
  });

  it("extracts languages", () => {
    const p = parseTitle("Elite S01 1080p Spanish WEB-DL");
    expect(p.languages).toContain("Spanish");
  });

  it("extracts subtitles", () => {
    const p = parseTitle("Movie 2019 1080p WEBRip multi subs");
    expect(p.subtitles.length).toBeGreaterThan(0);
  });

  it("extracts edition tags", () => {
    const p = parseTitle("Blade Runner 2049 Extended Cut 1080p");
    expect(p.edition).toContain("Extended");
  });

  it("detects audio metadata", () => {
    const p = parseTitle("Concert FLAC 24bit 192kHz");
    expect(p.audio.lossless).toBe(true);
    expect(p.audio.bitDepth).toBe(24);
    expect(p.audio.sampleRate).toBe(192000);
  });

  it("handles parenthesized years", () => {
    const p = parseTitle("Inception (2010) 1080p");
    expect(p.year).toBe(2010);
  });

  it("normalizes title keys", () => {
    const a = parseTitle("The.Matrix.1999");
    const b = parseTitle("The Matrix 1999");
    expect(a.normalizedKey).toBe(b.normalizedKey);
    expect(a.normalizedKey).toBe("thematrix");
  });
});

describe("qualityTier", () => {
  it("orders qualities", () => {
    expect(qualityTier("2160p")).toBeGreaterThan(qualityTier("1080p"));
    expect(qualityTier("720p")).toBeGreaterThan(qualityTier("480p"));
    expect(qualityTier(undefined)).toBe(0);
  });
});

describe("audio formatting", () => {
  it("formats audio summary", () => {
    expect(formatAudio({ codec: "FLAC", channelsLabel: "5.1" })).toBe("FLAC 5.1");
    expect(formatAudio({ codec: "DTS", bitrate: 1536 })).toMatch(/DTS/);
    expect(formatAudio(undefined)).toBe("");
  });

  it("parses channel counts", () => {
    const p = parseAudio("DTS 5.1");
    expect(p.metadata.channels).toBe(6);
    expect(p.metadata.channelsLabel).toBe("5.1");
  });
});