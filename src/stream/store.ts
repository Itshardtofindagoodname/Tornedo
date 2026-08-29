/**
 * JSON file persistence and a TTL disk cache used across the streaming
 * providers (favorites, watch history, addon/tv config, fetched poster bytes,
 * cached provider responses).
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { sha256Hex } from "./crypto.js";

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

/** Crash-safe JSON read/write to a single file (tmp + atomic rename). */
export class JsonStore<T> {
  private readonly file: string;
  private cached: T | null | undefined = undefined;

  constructor(file: string) {
    this.file = file;
  }

  get path(): string {
    return this.file;
  }

  async read(): Promise<T | null> {
    if (this.cached !== undefined) return this.cached;
    try {
      const text = await readFile(this.file, "utf8");
      this.cached = JSON.parse(text) as T;
    } catch {
      this.cached = null;
    }
    return this.cached;
  }

  async write(value: T): Promise<void> {
    this.cached = value;
    await ensureDir(dirname(this.file));
    const tmp = `${this.file}.tmp`;
    await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
    await rename(tmp, this.file);
  }

  async clear(): Promise<void> {
    this.cached = null;
    await rmQuiet(this.file);
  }
}

async function rmQuiet(file: string): Promise<void> {
  const { rm } = await import("node:fs/promises");
  await rm(file, { force: true });
}

export interface TtlEntryBytes {
  value: Buffer;
  expiresAt: number; // epoch ms
}

/** Disk-backed TTL cache keyed by sha256 of the key string. */
export class TtlByteCache {
  private readonly file: string;
  private cache: Record<string, TtlEntryBytes> | null = null;
  private readonly defaultTtlMs: number;

  constructor(file: string, defaultTtlMs = 24 * 60 * 60 * 1000) {
    this.file = file;
    this.defaultTtlMs = defaultTtlMs;
  }

  private async load(): Promise<Record<string, TtlEntryBytes>> {
    if (this.cache !== null) return this.cache;
    try {
      const text = await readFile(this.file, "utf8");
      const parsed = JSON.parse(text, (key, value) =>
        key === "value" && typeof value === "string" ? Buffer.from(value, "base64") : value,
      ) as Record<string, TtlEntryBytes>;
      this.cache = parsed;
    } catch {
      this.cache = {};
    }
    return this.cache;
  }

  async get(key: string): Promise<Buffer | null> {
    const hashed = sha256Hex(key);
    const map = await this.load();
    const entry = map[hashed];
    if (entry === undefined) return null;
    if (entry.expiresAt <= Date.now()) {
      delete map[hashed];
      void this.flush();
      return null;
    }
    return entry.value;
  }

  async has(key: string, ttlMs?: number): Promise<boolean> {
    const map = await this.load();
    const entry = map[sha256Hex(key)];
    if (entry === undefined) return false;
    if (entry.expiresAt <= Date.now()) return false;
    const ttl = ttlMs ?? this.defaultTtlMs;
    return entry.expiresAt > Date.now() - ttl;
  }

  async set(key: string, value: Buffer, ttlMs = this.defaultTtlMs): Promise<void> {
    const map = await this.load();
    map[sha256Hex(key)] = { value, expiresAt: Date.now() + ttlMs };
    await this.flush();
  }

  async delete(key: string): Promise<void> {
    const map = await this.load();
    delete map[sha256Hex(key)];
    await this.flush();
  }

  async flush(): Promise<void> {
    await ensureDir(dirname(this.file));
    const tmp = `${this.file}.tmp`;
    await writeFile(
      tmp,
      JSON.stringify(this.cache ?? {}, (_, value) => Buffer.isBuffer(value) ? value.toString("base64") : value),
      "utf8",
    );
    await rename(tmp, this.file);
  }

  /** Memory-only view of live entries (for stats). */
  get size(): number {
    const now = Date.now();
    return Object.values(this.cache ?? {}).filter((e) => e.expiresAt > now).length;
  }
}

/** Tiny in-process memo with TTL for JSON responses. */
export class MemoCache {
  private readonly map = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly defaultTtlMs = 10 * 60 * 1000) {}

  async wrap<T>(key: string, producer: () => Promise<T>, ttlMs = this.defaultTtlMs): Promise<T> {
    const now = Date.now();
    const hit = this.map.get(key);
    if (hit !== undefined && hit.expiresAt > now) return hit.value as T;
    if (hit !== undefined && hit.expiresAt <= now) this.map.delete(key);
    const value = await producer();
    this.map.set(key, { value, expiresAt: now + ttlMs });
    return value;
  }

  invalidate(key: string): void {
    this.map.delete(key);
  }

  clear(): void {
    this.map.clear();
  }
}

/** Simple concurrency dedupe for the same in-flight key. */
export class InflightTable<T> {
  private readonly inflight = new Map<string, Promise<T>>();

  run(key: string, producer: () => Promise<T>): Promise<T> {
    const existing = this.inflight.get(key);
    if (existing !== undefined) return existing;
    const p = producer().finally(() => {
      this.inflight.delete(key);
    });
    this.inflight.set(key, p);
    return p;
  }
}

/** Join a data subfolder in a state root. */
export function dataFile(root: string, ...parts: string[]): string {
  return join(...[root, ...parts]);
}