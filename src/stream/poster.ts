/**
 * Poster byte-cache + decode + render store. Posters are fetched once (by URL),
 * cached on disk under the stream cache dir and decoded to RGBA in memory; a
 * single decoded image serves every grid size via box-average sampling in
 * image.ts. Subscribers (React hooks) are notified when a requested URL is
 * ready so rows re-render as art arrives.
 */
import { decodeImage, RgbaImage } from "./image.js";
import { TtlByteCache } from "./store.js";

export type PosterListener = (url: string) => void;

export class PosterStore {
  private readonly disk: TtlByteCache;
  private readonly memory = new Map<string, RgbaImage>();
  private readonly inflight = new Map<string, Promise<RgbaImage | null>>();
  private readonly requested = new Set<string>();
  private readonly listeners = new Set<PosterListener>();
  private readonly refcounts = new Map<string, number>();

  constructor(cacheFile: string) {
    this.disk = new TtlByteCache(cacheFile, 14 * 24 * 60 * 60 * 1000);
  }

  subscribe(listener: PosterListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Synchronously available image, or null (triggers background load). */
  get(url: string): RgbaImage | null {
    if (url.length === 0) return null;
    const mem = this.memory.get(url);
    if (mem !== undefined) return mem;
    void this.load(url, false);
    return null;
  }

  /** Ask the store to ensure a URL is fetched+decoded and notify when ready. */
  request(url: string): void {
    if (url.length === 0) return;
    void this.load(url, true);
  }

  addRef(url: string): void {
    this.refcounts.set(url, (this.refcounts.get(url) ?? 0) + 1);
    void this.load(url, true);
  }

  release(url: string): void {
    const count = this.refcounts.get(url) ?? 0;
    if (count <= 1) {
      this.refcounts.delete(url);
      // Keep decoded image in memory; the disk cache handles eviction.
    } else {
      this.refcounts.set(url, count - 1);
    }
  }

  private async load(url: string, notify: boolean): Promise<RgbaImage | null> {
    if (this.memory.has(url)) return this.memory.get(url)!;
    const existing = this.inflight.get(url);
    if (existing !== undefined) return existing;
    this.requested.add(url);
    const promise = this.fetchAndDecode(url)
      .then((img) => {
        if (img !== null) {
          this.memory.set(url, img);
          if (notify) this.emit(url);
        }
        return img;
      })
      .finally(() => {
        this.inflight.delete(url);
      });
    this.inflight.set(url, promise);
    return promise;
  }

  private async fetchAndDecode(url: string): Promise<RgbaImage | null> {
    try {
      let bytes = await this.disk.get(url);
      if (bytes === null) {
        const res = await fetch(url, {
          headers: { "user-agent": "tornedo/5.0", accept: "image/*" },
          redirect: "follow",
        });
        if (!res.ok) return null;
        bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.length === 0) return null;
        await this.disk.set(url, bytes);
      }
      return decodeImage(bytes);
    } catch {
      return null;
    }
  }

  private emit(url: string): void {
    for (const listener of this.listeners) {
      try {
        listener(url);
      } catch {
        // Subscriber errors must never break the store.
      }
    }
  }

  /** For tests/diagnostics: size of the in-memory decode cache. */
  get memorySize(): number {
    return this.memory.size;
  }
}