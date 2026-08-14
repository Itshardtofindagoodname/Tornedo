import { describe, expect, it } from "vitest";
import { formatDuration, formatDate, relativeTime, progressBar, pad, truncate } from "../src/utils/duration.js";

describe("formatDuration", () => {
  it("handles invalid input", () => {
    expect(formatDuration(Number.NaN)).toBe("--");
    expect(formatDuration(-1)).toBe("--");
    expect(formatDuration(Infinity)).toBe("--");
  });

  it("formats durations", () => {
    expect(formatDuration(499)).toBe("<1s");
    expect(formatDuration(5000)).toBe("5s");
    expect(formatDuration(65_000)).toBe("1m 05s");
    expect(formatDuration(3_600_000 + 120_000)).toBe("1h 02m");
    expect(formatDuration(86400_000 * 3)).toBe("3d 0h");
  });
});

describe("formatDate", () => {
  it("formats unix seconds", () => {
    expect(formatDate(0)).toBe("");
    expect(formatDate(1735689600)).toBe("2025-01-01");
  });
});

describe("relativeTime", () => {
  it("formats relative time", () => {
    const now = Date.now();
    expect(relativeTime(Math.floor(now / 1000), now)).toBe("now");
    expect(relativeTime(Math.floor((now - 3600_000) / 1000), now)).toBe("1h ago");
    expect(relativeTime(undefined)).toBe("");
  });
});

describe("progressBar", () => {
  it("fills proportionally", () => {
    expect(progressBar(1, 4)).toBe("████");
    expect(progressBar(0, 4)).toBe("░░░░");
    expect(progressBar(0.5, 4)).toBe("██░░");
  });
});

describe("pad/truncate", () => {
  it("pads to width", () => {
    expect(pad("ab", 4)).toBe("ab  ");
  });

  it("truncates with ellipsis", () => {
    expect(truncate("abcdef", 4)).toBe("abc…");
    expect(truncate("abc", 4)).toBe("abc");
  });
});