import { describe, expect, it } from "vitest";
import { parseArgs, CliArgError } from "../src/cli/args.js";

describe("parseArgs", () => {
  it("parses a command and positionals", () => {
    const args = parseArgs(["search", "interstellar", "--json"]);
    expect(args.command).toBe("search");
    expect(args.positional).toEqual(["interstellar"]);
    expect(args.json).toBe(true);
  });

  it("rejects unknown commands", () => {
    expect(() => parseArgs(["bogus"])).toThrow(CliArgError);
  });

  it("rejects unknown flags", () => {
    expect(() => parseArgs(["search", "--nope"])).toThrow(/Unknown flag/);
  });

  it("parses --flag=value forms", () => {
    const args = parseArgs(["search", "--limit=5", "--source=fitgirl"]);
    expect(args.limit).toBe(5);
    expect(args.sources).toEqual(["fitgirl"]);
  });

  it("parses repeated --source flags", () => {
    const args = parseArgs(["search", "x", "--source", "yts", "--source", "nyaa"]);
    expect(args.sources).toEqual(["yts", "nyaa"]);
  });

  it("parses short flags", () => {
    const args = parseArgs(["-j", "search", "q"]);
    expect(args.json).toBe(true);
    expect(args.command).toBe("search");
  });

  it("handles --no-seed and --seed", () => {
    expect(parseArgs(["magnet", "m:", "--no-seed"]).seed).toBe(false);
    expect(parseArgs(["magnet", "m:", "--seed"]).seed).toBe(true);
  });

  it("handles --no-wait", () => {
    expect(parseArgs(["magnet", "m:", "--no-wait"]).wait).toBe(false);
  });

  it("parses --dir", () => {
    expect(parseArgs(["file", "x.torrent", "--dir", "/tmp"]).dir).toBe("/tmp");
  });

  it("handles -- separator", () => {
    const args = parseArgs(["search", "--", "--weird"]);
    expect(args.positional).toEqual(["--weird"]);
  });

  it("throws on missing flag value", () => {
    expect(() => parseArgs(["search", "--limit"])).toThrow(CliArgError);
  });

  it("parses the new commands", () => {
    expect(parseArgs(["history"]).command).toBe("history");
    expect(parseArgs(["history", "--clear"]).command).toBe("history");
    expect(parseArgs(["files", "x.torrent"]).command).toBe("files");
    expect(parseArgs(["clear"]).command).toBe("clear");
    expect(parseArgs(["uninstall"]).command).toBe("uninstall");
    expect(parseArgs(["uninstall", "--clear"]).command).toBe("uninstall");
  });

  it("parses the tv playlists command", () => {
    const list = parseArgs(["tv"]);
    expect(list.command).toBe("tv");
    expect(list.positional).toEqual([]);
    const add = parseArgs(["tv", "add", "https://iptv.example/pl.m3u8", "iptv"]);
    expect(add.command).toBe("tv");
    expect(add.positional).toEqual(["add", "https://iptv.example/pl.m3u8", "iptv"]);
    expect(parseArgs(["tv", "clear"]).positional).toEqual(["clear"]);
  });

  it("parses --clear without a command", () => {
    const args = parseArgs(["--clear"]);
    expect(args.command).toBeNull();
    expect(args.clear).toBe(true);
  });

  it("parses --yes and -y", () => {
    expect(parseArgs(["clear", "--yes"]).yes).toBe(true);
    expect(parseArgs(["uninstall", "-y"]).yes).toBe(true);
  });

  it("parses --select as repeatable and comma-separated", () => {
    const args = parseArgs(["file", "x.torrent", "--select", "a.mkv", "--select", "subs/en.srt,b.mp4"]);
    expect(args.select).toEqual(["a.mkv", "subs/en.srt", "b.mp4"]);
  });
});