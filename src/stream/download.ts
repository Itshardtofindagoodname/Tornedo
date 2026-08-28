/**
 * Resumable HTTP download engine for the streaming "Watch" mode. Downloads a
 * stream URL into a destination with a `.part` file + `.part.json` sidecar
 * (mirroring the offsets MovieBox-Tui keeps), supports Range resume, ETag /
 * Last-Modified validation, bounded retries, progress callbacks and
 * cancellation.
 */
import { createWriteStream, type WriteStream } from "node:fs";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { StreamError } from "./models.js";

export interface DownloadProgress {
  receivedBytes: number;
  totalBytes: number | null;
  percent: number | null;
  rateBytesPerSec: number;
}

export interface DownloadOptions {
  url: string;
  headers?: Record<string, string>;
  dest: string;
  retries?: number;
  onProgress?: (progress: DownloadProgress) => void;
  signal?: AbortSignal;
}

export interface DownloadResult {
  path: string;
  bytes: number;
}

interface Sidecar {
  url: string;
  headers: Record<string, string>;
  expectedBytes: number | null;
  etag?: string;
  lastModified?: string;
  downloaded: number; // bytes already on disk
}

export class StreamDownloader {
  private active = new Set<AbortController>();

  cancelActive(): void {
    for (const controller of this.active) controller.abort();
    this.active.clear();
  }

  async download(opts: DownloadOptions): Promise<DownloadResult> {
    const { url, dest, headers = {}, retries = 3, signal } = opts;
    const partPath = `${dest}.part`;
    const metaPath = `${dest}.part.json`;
    await mkdir(dirname(dest), { recursive: true });

    const sidecar = await this.loadSidecar(metaPath);
    let resumeFrom = 0;
    let expectedBytes: number | null = null;
    let canResume = false;

    if (sidecar !== null && sidecar.url === url) {
      try {
        const info = await stat(partPath);
        if (info.size > 0 && info.size <= (sidecar.expectedBytes ?? 1e15)) {
          resumeFrom = info.size;
          expectedBytes = sidecar.expectedBytes;
          canResume = true;
        }
      } catch {
        // No partial file → start from scratch.
      }
    }

    const controller = new AbortController();
    this.active.add(controller);
    const onUserAbort = () => controller.abort();
    if (signal !== undefined) {
      if (signal.aborted) controller.abort();
      else signal.addEventListener("abort", onUserAbort, { once: true });
    }

    const startedAt = Date.now();
    let lastEmit = 0;
    let attempt = 0;
    let stream: WriteStream | null = null;

    const emit = (received: number, total: number | null) => {
      const now = Date.now();
      if (now - lastEmit < 250) return;
      lastEmit = now;
      opts.onProgress?.({
        receivedBytes: received,
        totalBytes: total,
        percent: total !== null && total > 0 ? received / total : null,
        rateBytesPerSec: now > startedAt ? (received - resumeFrom) / ((now - startedAt) / 1000) : 0,
      });
    };

    try {
      while (true) {
        attempt++;
        const requestHeaders: Record<string, string> = {
          "user-agent": "tornedo/5.0",
          accept: "*/*",
          ...headers,
        };
        if (resumeFrom > 0 && canResume) {
          requestHeaders["range"] = `bytes=${resumeFrom}-`;
          if (sidecar?.etag !== undefined) requestHeaders["if-range"] = sidecar.etag;
          else if (sidecar?.lastModified !== undefined) requestHeaders["if-range"] = sidecar.lastModified;
        }

        const res = await fetch(url, {
          method: "GET",
          headers: requestHeaders,
          signal: controller.signal,
          redirect: "follow",
        });

        const status = res.status;
        const isResumeAccepted = status === 206;
        const isFullBody = status === 200;

        if (status !== 200 && status !== 206) {
          throw new StreamError("unavailable", `download ${url} -> HTTP ${status}`);
        }
        if (resumeFrom > 0 && isFullBody && canResume) {
          // Server ignored our Range; restart the file.
          resumeFrom = 0;
          canResume = false;
          await rm(partPath, { force: true });
          continue;
        }

        const totalHeader =
          status === 206
            ? /bytes\s+\d+-\d+\/(\d+)/.exec(res.headers.get("content-range") ?? "")?.[1]
            : res.headers.get("content-length");
        expectedBytes = totalHeader !== undefined ? Number(totalHeader) : null;

        await writeFile(
          metaPath,
          JSON.stringify({
            url,
            headers,
            expectedBytes,
            etag: res.headers.get("etag") ?? undefined,
            lastModified: res.headers.get("last-modified") ?? undefined,
            downloaded: resumeFrom,
          } satisfies Sidecar),
        );

        if (stream === null) {
          stream = createWriteStream(partPath, { flags: resumeFrom > 0 ? "a" : "w" });
        }
        const reader = res.body?.getReader();
        if (reader === undefined) throw new StreamError("network", "no response body for stream download");

        let received = resumeFrom;
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (controller.signal.aborted) throw abortedError();
          const flushed = stream.write(Buffer.from(value));
          if (!flushed) {
            await new Promise<void>((resolve, reject) => {
              stream!.once("drain", resolve);
              stream!.once("error", reject);
            });
          }
          received += value.byteLength;
          emit(received, expectedBytes);
        }
        await finishStream(stream);
        stream = null;

        // Verify we got everything we expected.
        const finalSize = (await stat(partPath)).size;
        if (expectedBytes !== null && canResume && finalSize < expectedBytes) {
          // Server ended early; resume from where we are.
          resumeFrom = finalSize;
          expectedBytes = null;
          continue;
        }

        await rename(partPath, dest);
        await rm(metaPath, { force: true });
        opts.onProgress?.({
          receivedBytes: finalSize,
          totalBytes: finalSize,
          percent: 1,
          rateBytesPerSec: Date.now() > startedAt ? finalSize / ((Date.now() - startedAt) / 1000) : 0,
        });
        return { path: dest, bytes: finalSize };
      }
    } catch (err) {
      if (stream !== null) stream.destroy();
      if (controller.signal.aborted && !(err instanceof StreamError && err.kind === "rateLimited")) {
        throw new StreamError("unavailable", "download cancelled", { provider: undefined });
      }
      const retryable = err instanceof TypeError || (err instanceof StreamError && err.kind === "network");
      if (attempt <= retries && retryable) {
        await sleep(500 * attempt);
        return this.download(opts);
      }
      throw err;
    } finally {
      this.active.delete(controller);
      if (signal !== undefined) signal.removeEventListener("abort", onUserAbort);
    }
  }

  private async loadSidecar(path: string): Promise<Sidecar | null> {
    try {
      return JSON.parse(await readFile(path, "utf8")) as Sidecar;
    } catch {
      return null;
    }
  }
}

function abortedError(): StreamError {
  return new StreamError("unavailable", "download aborted");
}

function finishStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    stream.end((err?: Error | null) => {
      if (err !== undefined && err !== null) reject(err);
      else resolve();
    });
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}