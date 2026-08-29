import path from "node:path";
import { describe, expect, it } from "vitest";
import { sanitizeSegment, safeFolderName, isSafeRelativePath, joinSafe } from "../src/utils/sanitize.js";

describe("sanitizeSegment", () => {
  it("rejects empty and dot segments", () => {
    expect(sanitizeSegment("")).toBeNull();
    expect(sanitizeSegment(".")).toBeNull();
    expect(sanitizeSegment("..")).toBeNull();
    expect(sanitizeSegment("   ")).toBeNull();
  });

  it("strips illegal characters", () => {
    expect(sanitizeSegment('a:b<c>d"e\\f/g|h?i*j')).toBe("a b c d e f g h i j");
  });

  it("rejects reserved Windows names", () => {
    expect(sanitizeSegment("CON")).toBeNull();
    expect(sanitizeSegment("com1")).toBeNull();
    expect(sanitizeSegment("NUL.txt")).not.toBeNull();
  });

  it("trims trailing dots and spaces", () => {
    expect(sanitizeSegment("movie...")).toBe("movie");
    expect(sanitizeSegment("movie ")).toBe("movie");
  });
});

describe("safeFolderName", () => {
  it("falls back for unsafe names", () => {
    expect(safeFolderName("..")).toBe("download");
  });
});

describe("isSafeRelativePath", () => {
  it("rejects traversal and absolute paths", () => {
    expect(isSafeRelativePath("../x")).toBe(false);
    expect(isSafeRelativePath("a/../../b")).toBe(false);
    expect(isSafeRelativePath("/etc/passwd")).toBe(false);
    expect(isSafeRelativePath("C:\\Windows")).toBe(false);
  });

  it("accepts safe relative paths", () => {
    expect(isSafeRelativePath("folder/file.mkv")).toBe(true);
  });
});

describe("joinSafe", () => {
  it("joins within base", () => {
    const joined = joinSafe("/data", "folder/file.mkv");
    expect(joined).toBe(path.join("/data", "folder", "file.mkv"));
  });

  it("returns null for escaping paths", () => {
    expect(joinSafe("/data", "../escape")).toBeNull();
    expect(joinSafe("/data", "a/../../b")).toBeNull();
    expect(joinSafe("/data", "/abs")).toBeNull();
  });

  it("rejects unsafe segments inside", () => {
    expect(joinSafe("/data", "a/CON/b")).toBeNull();
  });
});