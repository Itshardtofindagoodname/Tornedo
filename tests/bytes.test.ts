import { describe, expect, it } from "vitest";
import { formatBytes, formatRate, formatPercent } from "../src/utils/bytes.js";

describe("formatBytes", () => {
  it("formats zero", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(undefined)).toBe("0 B");
  });

  it("formats bytes/kb/mb/gb", () => {
    expect(formatBytes(512)).toBe("512 B");
    expect(formatBytes(1024)).toBe("1.00 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.00 MB");
    expect(formatBytes(3 * 1024 * 1024 * 1024)).toBe("3.00 GB");
  });

  it("supports no-space output", () => {
    expect(formatBytes(1024, { space: false })).toBe("1.00KB");
  });
});

describe("formatRate", () => {
  it("appends /s", () => {
    expect(formatRate(2048)).toBe("2.00 KB/s");
  });
});

describe("formatPercent", () => {
  it("clamps to 0..100", () => {
    expect(formatPercent(-1)).toBe("0.0%");
    expect(formatPercent(2)).toBe("100%");
  });

  it("renders reasonable precision", () => {
    expect(formatPercent(0.5)).toBe("50.0%");
    expect(formatPercent(1)).toBe("100%");
  });
});