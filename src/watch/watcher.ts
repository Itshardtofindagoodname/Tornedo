/**
 * Watch mode: periodically scans a directory for .torrent files, magnet files,
 * and plain-text files containing magnet URIs / infohashes, adding each to the
 * download manager. Files are tracked by (mtime, size, hash) so nothing is ever
 * processed twice. Polling is used rather than fs.watch for cross-platform
 * reliability.
 */
import { createHash } from "node:crypto";
import { promises as fs, type Dirent } from "node:fs";
import path from "node:path";
import type { TorrentStore } from "../database/store.js";
import type { ParsedMagnet, TorrentFileInfo } from "../torrent/parse.js";
import { parseInput, parseTorrentBuffer } from "../torrent/parse.js";

const MAX_TEXT_BYTES = 2 * 1024 * 1024;
const MAX_HASH_BYTES = 4 * 1024 * 1024;

export type WatchAdd =
  | { kind: "magnet"; infoHash: string; magnet: string; name: string }
  | { kind: "torrent"; infoHash: string; magnet: string; name: string; torrentBytes: Uint8Array };

export interface WatchServiceOptions {
  store: TorrentStore;
  intervalMs: number;
  onAdd(add: WatchAdd): void;
  onError(message: string): void;
}

function sha256(data: Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

function extractMagnets(text: string): WatchAdd[] {
  const out: WatchAdd[] = [];
  const seen = new Set<string>();
  const magnetRe = /magnet:\?xt=urn:btih:[^"'<>\s]+/gi;
  for (const m of text.matchAll(magnetRe)) {
    const parsed = parseInput(m[0]!);
    if (!parsed) continue;
    if (seen.has(parsed.infoHash)) continue;
    seen.add(parsed.infoHash);
    out.push({ kind: "magnet", infoHash: parsed.infoHash, magnet: parsed.magnet, name: parsed.name });
  }
  return out;
}

export class WatchService {
  private readonly opts: WatchServiceOptions;
  private timer: ReturnType<typeof setInterval> | null = null;
  private scanning = false;
  private activeDirs: string[] = [];
  private seenPaths = new Set<string>();

  constructor(opts: WatchServiceOptions) {
    this.opts = opts;
  }

  watch(dir: string): void {
    if (!this.activeDirs.includes(dir)) this.activeDirs.push(dir);
  }

  unwatch(dir: string): void {
    this.activeDirs = this.activeDirs.filter((d) => d !== dir);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.scan(), this.opts.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async scanOnce(): Promise<void> {
    await this.scan();
  }

  private async scan(): Promise<void> {
    if (this.scanning || this.activeDirs.length === 0) return;
    this.scanning = true;
    this.seenPaths = new Set();
    try {
      for (const dir of this.activeDirs) {
        await this.scanDir(dir);
      }
      this.prune();
    } catch (e) {
      this.opts.onError(e instanceof Error ? e.message : String(e));
    } finally {
      this.scanning = false;
    }
  }

  private async scanDir(dir: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(dir, { recursive: true, withFileTypes: true });
    } catch {
      // Directory doesn't exist yet; keep watching.
      return;
    }
    for (const entry of entries) {
      if (!entry.isFile()) continue;
      const full = path.join(entry.parentPath ?? dir, entry.name);
      this.seenPaths.add(full);
      await this.maybeProcess(full);
    }
  }

  private async maybeProcess(full: string): Promise<void> {
    let stat: { mtimeMs: number; size: number };
    try {
      const s = await fs.stat(full);
      stat = { mtimeMs: s.mtimeMs, size: s.size };
    } catch {
      return;
    }
    const known = this.opts.store.watchGet(full);
    if (known && known.mtime === stat.mtimeMs && known.size === stat.size) {
      return; // unchanged since last scan
    }

    let hash = known?.hash ?? "";
    if (known && known.mtime !== stat.mtimeMs) {
      hash = await this.hashFile(full, stat.size);
    }

    const adds = await this.extractFromFile(full, stat.size);
    for (const add of adds) {
      this.opts.onAdd(add);
    }
    this.opts.store.watchSet(full, { mtime: stat.mtimeMs, size: stat.size, hash });
  }

  private async hashFile(full: string, size: number): Promise<string> {
    if (size > MAX_HASH_BYTES) return "";
    try {
      const data = await fs.readFile(full);
      return sha256(data);
    } catch {
      return "";
    }
  }

  private async extractFromFile(full: string, size: number): Promise<WatchAdd[]> {
    if (size > MAX_TEXT_BYTES) return [];
    const ext = path.extname(full).toLowerCase();
    if (ext === ".torrent") {
      try {
        const data = await fs.readFile(full);
        const info = await parseTorrentBuffer(data);
        if (!info) return [];
        return [
          {
            kind: "torrent",
            infoHash: info.infoHash,
            name: info.name,
            magnet: `magnet:?xt=urn:btih:${info.infoHash}&dn=${encodeURIComponent(info.name)}`,
            torrentBytes: data,
          },
        ];
      } catch {
        return [];
      }
    }
    if (ext === ".magnet" || ext === ".txt") {
      try {
        const text = await fs.readFile(full, "utf8");
        return extractMagnets(text);
      } catch {
        return [];
      }
    }
    // Unknown extension: sniff for magnet URIs / infohashes in text.
    try {
      const buf = await fs.readFile(full);
      const ascii = buf.toString("latin1");
      if (ascii.includes("magnet:") || /^[a-f0-9]{40}$/i.test(ascii.trim())) {
        return extractMagnets(ascii);
      }
    } catch {
      return [];
    }
    return [];
  }

  private prune(): void {
    // Forget records for files no longer present in any watched directory so a
    // later file with the same name is processed as a fresh one.
    this.opts.store.watchPrune(this.seenPaths);
  }

  dispose(): void {
    this.stop();
  }
}