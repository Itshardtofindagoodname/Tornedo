/**
 * TorrentStreamer: plays a Watch-mode torrent by streaming it through a local
 * HTTP server. The WebTorrent engine is constructed lazily (dynamic import) so
 * a search-only session never pays for it. When the user plays a "torrent"
 * release, the engine is created, the torrent added, metadata awaited, the best
 * video file selected, and a Range-capable HTTP server on 127.0.0.1 serves the
 * file — mpv/VLC plays it over HTTP while pieces download in priority order.
 *
 * Everything is self-contained: it does not touch the managed download client,
 * and all streamed torrents are torn down by disposeAll().
 */
import http from "node:http";
import { mkdir } from "node:fs/promises";
import type { AddressInfo } from "node:net";
import type { Readable } from "node:stream";

export interface ServeOptions {
  /** Magnet URI (or bare infohash) to stream. */
  magnet: string;
  /** Directory that receives downloaded pieces (must exist / will be created). */
  destination: string;
  /** Optional display-name hint used to prefer a matching file. */
  fileHint?: string;
  /** How long to wait for metadata before giving up (ms). */
  timeoutMs?: number;
  /**
   * How long to wait for the selected file to buffer at least one byte before
   * handing the URL to the player (ms). Keeps VLC/mpv from opening on a blank
   * screen that "never shows up". Defaults to the metadata timeout.
   */
  bufferingTimeoutMs?: number;
  signal?: AbortSignal;
  /** Live playback-preparation progress, e.g. for a status banner in the UI. */
  onProgress?: (stage: string, fraction?: number) => void;
}

/** Structural WebTorrent `File` surface the streamer depends on. */
export interface StreamableFile {
  name: string;
  path?: string;
  length: number;
  progress?: number;
  downloaded?: number;
  done?: boolean;
  select?(): void;
  deselect?(): void;
  createReadStream(opts?: { start?: number; end?: number }): Readable;
}

interface EngineLike {
  add(
    source: string,
    opts: { path: string; deselect: boolean },
    onReady: (torrent: TorrentLike) => void,
  ): TorrentLike;
  destroy(): void;
}

interface TorrentLike {
  readonly name: string;
  readonly files: StreamableFile[];
  on(event: "error", cb: (err: Error) => void): void;
  destroy(): void;
}

interface ActiveEntry {
  torrent: TorrentLike;
  server: http.Server;
}

export interface ServeResult {
  url: string;
  file: string;
}

const VIDEO_EXT = /\.(mp4|mkv|webm|mov|ts|avi|m4v|mp3|m4a)(\?|#|$)/i;

export class TorrentStreamer {
  private client: EngineLike | null = null;
  private enginePromise: Promise<EngineLike> | null = null;
  private readonly active = new Set<ActiveEntry>();
  /** Torrents whose metadata is already loaded (added with deselect, nothing downloaded). */
  private readonly metadataByKey = new Map<string, Promise<TorrentLike>>();
  /** Serves in flight / completed, keyed by magnet+destination. */
  private readonly servedByKey = new Map<string, Promise<ServeResult>>();

  private async engine(): Promise<EngineLike> {
    if (this.client !== null) return this.client;
    if (this.enginePromise === null) {
      this.enginePromise = import("webtorrent")
        .then((m) => {
          const Ctor = (m.default as unknown) ?? m;
          this.client = new (Ctor as new () => EngineLike)();
          return this.client;
        })
        .catch((err) => {
          this.enginePromise = null;
          throw err;
        });
    }
    return this.enginePromise;
  }

  /**
   * Preload the engine (import + construct) without touching any torrents. Call
   * this as early as a search returns torrent results so the expensive module
   * load is already paid by the time the user presses enter.
   */
  warmEngine(): void {
    void this.engine().catch(() => undefined);
  }

  /**
   * Fetch a torrent's metadata in the background and pre-select its best video
   * file so pieces start buffering while the user browses — a later serve()
   * then hands over a stream that is already ready to play, instead of waiting
   * for the first bytes. Fire-and-forget and memoized by magnet, so repeated
   * hugs are cheap (and never re-add).
   */
  warm(opts: ServeOptions): void {
    void this.warmAndSelect(opts).catch(() => undefined);
  }

  /** Warm the engine + metadata and pre-select the video file (no server). */
  private async warmAndSelect(opts: ServeOptions): Promise<void> {
    const torrent = await this.metadata(opts);
    const file = pickVideoFile(torrent.files, opts.fileHint);
    if (file === null) return;
    selectOnly(torrent.files, file);
  }

  /**
   * Start streaming a torrent and return the local playback URL. Memoized by
   * magnet+destination: the same magnet served twice shares one server/entry,
   * and a prior warm() makes this resolve immediately.
   */
  serve(opts: ServeOptions): Promise<ServeResult> {
    const key = keyFor(opts);
    const existing = this.servedByKey.get(key);
    if (existing !== undefined) return existing;
    const pending = this.prepare(opts);
    this.servedByKey.set(key, pending);
    void pending.catch(() => {
      if (this.servedByKey.get(key) === pending) this.servedByKey.delete(key);
    });
    return pending;
  }

  /** Resolve (and cache) the torrent object for a magnet, loading metadata if needed. */
  private async metadata(opts: ServeOptions): Promise<TorrentLike> {
    const key = keyFor(opts);
    const existing = this.metadataByKey.get(key);
    if (existing !== undefined) return existing;
    await mkdir(opts.destination, { recursive: true });
    const client = await this.engine();
    const raw = this.addAndWait(client, opts);
    let tracked: Promise<TorrentLike> | undefined;
    tracked = raw.catch((err: unknown) => {
      // Forget a failed metadata load so a retry can start fresh.
      if (this.metadataByKey.get(key) === tracked) this.metadataByKey.delete(key);
      throw err;
    });
    this.metadataByKey.set(key, tracked);
    return tracked;
  }

  private async prepare(opts: ServeOptions): Promise<ServeResult> {
    opts.onProgress?.("fetching metadata", 0);
    const torrent = await this.metadata(opts);
    const file: StreamableFile | null = pickVideoFile(torrent.files, opts.fileHint);
    if (file === null) {
      this.safeDestroy(torrent);
      throw new Error("no playable video file found in this torrent");
    }
    // Stream only the chosen file: deselect everything else so we never fill
    // the disk with the rest of the torrent while playing.
    selectOnly(torrent.files, file);
    const { server, url } = await serveFile(file);
    const entry: ActiveEntry = { torrent, server };
    this.active.add(entry);
    const cleanup = (): void => this.stop(entry);
    if (opts.signal !== undefined) {
      if (opts.signal.aborted) cleanup();
      else opts.signal.addEventListener("abort", cleanup, { once: true });
    }
    // Buffer actually-playable bytes before telling the player to open, so VLC
    // doesn't sit on an empty/black stream that looks like a hang. Ignored when
    // the engine exposes no measurable progress (keeps fake/test engines fast).
    await this.waitForBuffered(file, opts, torrent);
    return { url, file: file.name };
  }

  /**
   * Wait until the selected file has at least one readable byte (so the player
   * opens on real video instead of a frozen black screen), reporting progress
   * to the UI. Files that expose no progress gauge resolve immediately.
   */
  private async waitForBuffered(
    file: StreamableFile,
    opts: ServeOptions,
    torrent: TorrentLike,
  ): Promise<void> {
    const measurable =
      (typeof file.progress === "number" && file.progress >= 0) ||
      (typeof file.downloaded === "number" && file.downloaded >= 0);
    if (!measurable) return;
    const initiallyDone = file.done === true;
    const emit = (stage: string, fraction?: number): void => opts.onProgress?.(stage, fraction);
    if ((typeof file.downloaded === "number" && file.downloaded > 0) || initiallyDone || file.progress === 1) return;

    const overallMs = opts.bufferingTimeoutMs ?? opts.timeoutMs ?? 45_000;
    const deadline = Date.now() + overallMs;
    emit("connecting & buffering", 0);
    while (Date.now() < deadline) {
      const downloaded = typeof file.downloaded === "number" ? file.downloaded : 0;
      const progress = typeof file.progress === "number" ? file.progress : 0;
      const done = file.done === true;
      const fraction = file.length > 0 ? Math.min(1, downloaded / file.length) : progress;
      if (downloaded > 0 || done || progress >= 1) {
        emit("buffered", Math.max(0.001, fraction));
        return;
      }
      if (opts.signal?.aborted) return;
      if (fraction > 0) emit("buffering", Math.min(0.999, fraction));
      await new Promise<void>((r) => setTimeout(r, 350));
    }
    // We hit the deadline with zero bytes: don't block playback forever — hand
    // the URL over anyway so the player can try (VLC will retry), but let the
    // UI know we timed out waiting to buffer.
    emit("buffering timed out", 0);
    void torrent; // keep reference for FAQ / future diagnostics
  }

  /** Stop streaming everything and destroy the engine. Idempotent. */
  async disposeAll(): Promise<void> {
    for (const entry of [...this.active]) this.stop(entry);
    this.active.clear();
    this.servedByKey.clear();
    this.metadataByKey.clear();
    const client = this.client;
    this.client = null;
    this.enginePromise = null;
    if (client !== null) {
      try {
        client.destroy();
      } catch {
        /* best effort */
      }
    }
  }

  private stop(entry: ActiveEntry): void {
    this.active.delete(entry);
    try {
      entry.server.close();
    } catch {
      /* best effort */
    }
    this.safeDestroy(entry.torrent);
  }

  private safeDestroy(torrent: TorrentLike): void {
    try {
      torrent.destroy();
    } catch {
      /* best effort */
    }
  }

  private addAndWait(client: EngineLike, opts: ServeOptions): Promise<TorrentLike> {
    return new Promise((resolve, reject) => {
      const timeoutMs = opts.timeoutMs ?? 45_000;
      let settled = false;
      const timer = setTimeout(() => {
        if (!settled) {
          settled = true;
          detach();
          reject(new Error("timed out waiting for torrent metadata (no peers or trackers reached)"));
        }
      }, timeoutMs);
      const onAbort = (): void => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(new Error("torrent stream aborted"));
        }
      };
      const detach = (): void => {
        clearTimeout(timer);
        if (opts.signal !== undefined) opts.signal.removeEventListener("abort", onAbort);
      };
      const finishOk = (torrent: TorrentLike): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        detach();
        resolve(torrent);
      };
      const finishErr = (err: Error): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        detach();
        reject(err);
      };
      if (opts.signal !== undefined) {
        if (opts.signal.aborted) {
          onAbort();
          return;
        }
        opts.signal.addEventListener("abort", onAbort, { once: true });
      }
      let torrent: TorrentLike;
      try {
        torrent = client.add(opts.magnet, { path: opts.destination, deselect: true }, (t) => finishOk(t));
      } catch (err) {
        finishErr(err instanceof Error ? err : new Error(String(err)));
        return;
      }
      torrent.on("error", (err: Error) => {
        try {
          torrent.destroy();
        } catch {
          /* best effort */
        }
        finishErr(err instanceof Error ? err : new Error(String(err)));
      });
    });
  }
}

/**
 * Pick the file to stream: the most specific match for the fileHint, otherwise
 * the largest file. Prefers video extensions, falling back to any file.
 */
export function pickVideoFile(files: StreamableFile[], fileHint?: string): StreamableFile | null {
  if (!files || files.length === 0) return null;
  const videos = files.filter((f) => VIDEO_EXT.test(f.name ?? "") || VIDEO_EXT.test(f.path ?? ""));
  const pool = videos.length > 0 ? videos : files;
  const hint = (fileHint ?? "").trim();
  if (hint.length > 0) {
    const normalized = stemOf(hint);
    const ext = hint.replace(/^\./, "").toLowerCase();
    const matched = pool.filter((f) => {
      if (ext.length > 0 && String(f.name).toLowerCase().endsWith(`.${ext}`)) return true;
      if (normalized.length === 0) return false;
      return stemOf(f.name).includes(normalized);
    });
    if (matched.length > 0) return largest(matched);
  }
  return largest(pool);
}

/**
 * Deselect every file except `file` then select `file`, so the engine fetches
 * exactly the playable video and never fills the disk with the rest of the
 * torrent. Idempotent and best-effort (safe for structural mocks).
 */
function selectOnly(files: StreamableFile[], file: StreamableFile): void {
  for (const f of files) {
    if (f === file) continue;
    try {
      (f as { deselect?: () => void }).deselect?.();
    } catch {
      /* best effort */
    }
  }
  try {
    (file as { select?: () => void }).select?.();
  } catch {
    /* best effort */
  }
}

function stemOf(name: string): string {
  return stripExt(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function stripExt(name: string): string {
  return name.replace(/\.[^.]+$/, "");
}

function largest(files: StreamableFile[]): StreamableFile {
  return files.reduce((a, b) => ((b.length ?? 0) > (a.length ?? 0) ? b : a));
}

function keyFor(opts: ServeOptions): string {
  return `${opts.magnet}\u0000${opts.destination}`;
}

/** Serve a file over HTTP with Range support (what mpv/VLC send first). */
export async function serveFile(
  file: StreamableFile,
): Promise<{ server: http.Server; url: string }> {
  const server: http.Server = http.createServer((req, res) => {
    const total = file.length ?? 0;
    const range = req.headers.range;
    try {
      if (total > 0 && typeof range === "string" && /^bytes=\d*-\d*$/.test(range)) {
        const m = /^bytes=(\d*)-(\d*)$/.exec(range);
        let start = m![1] === "" ? 0 : Number(m![1]);
        let end = m![2] === "" ? total - 1 : Number(m![2]);
        if (start > end || start >= total || start < 0) {
          res.writeHead(416, { "content-range": `bytes */${total}` });
          res.end();
          return;
        }
        if (end >= total) end = total - 1;
        res.writeHead(206, {
          "content-type": "video/mp4",
          "accept-ranges": "bytes",
          "content-range": `bytes ${start}-${end}/${total}`,
          "content-length": String(end - start + 1),
        });
        const stream = file.createReadStream({ start, end });
        pipeTolerant(stream, req, res);
        return;
      }
      res.writeHead(200, {
        "content-type": "video/mp4",
        "accept-ranges": "bytes",
        "content-length": String(total),
      });
      const stream = file.createReadStream();
      pipeTolerant(stream, req, res);
    } catch {
      if (!res.headersSent) res.writeHead(500);
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (server.address() as AddressInfo).port;
  return { server, url: `http://127.0.0.1:${port}/` };
}

/**
 * Pipe a (WebTorrent streamx) Readable to the HTTP response tolerantly. When a
 * player aborts mid-stream — seeking to a new range or closing the connection —
 * the response closes prematurely and the pipe destroys the read side with a
 * PREMATURE_CLOSE error. Without an error handler that surfaces as an uncaught
 * exception and kills the whole app; here it's a normal, expected condition.
 */
function pipeTolerant(stream: Readable, req: http.IncomingMessage, res: http.ServerResponse): void {
  stream.on("error", () => {
    // Player disconnected (or the source failed). Nothing to tell an aborted
    // response; swallow so the process doesn't crash on PREMATURE_CLOSE.
    if (!res.destroyed && !res.writableEnded) {
      try {
        res.end();
      } catch {
        /* best effort */
      }
    }
  });
  stream.pipe(res);
  req.on("close", () => stream.destroy());
  res.on("close", () => stream.destroy());
}