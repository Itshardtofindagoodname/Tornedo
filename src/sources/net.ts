/**
 * Resilient HTTP helpers for source adapters: retries with backoff, per-request
 * timeouts, abort propagation, and a cancelled signal error for the engine.
 */

export const USER_AGENT =
  "Tornedo/0.1 (+https://github.com/tornedo/tornedo; a federated torrent client)";

export class HttpError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

/** Thrown when a request is aborted (search cancelled). */
export class CancelledError extends Error {
  constructor(message = "request cancelled") {
    super(message);
    this.name = "CancelledError";
  }
}

export interface FetchOptions {
  headers?: Record<string, string>;
  signal?: AbortSignal;
  retries?: number;
  timeoutMs?: number;
  /** Abort when the content-length (when present) exceeds this many bytes. */
  maxBytes?: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function backoff(attempt: number): number {
  const base = 250 * 2 ** Math.min(attempt, 5);
  return base + Math.floor(Math.random() * 120);
}

/**
 * fetch() with retries, timeout and abort support. Throws HttpError for
 * non-2xx responses and CancelledError when the caller's signal aborts.
 */
export async function fetchResilient(url: string, opts: FetchOptions = {}): Promise<Response> {
  const retries = Math.max(0, opts.retries ?? 1);
  const timeoutMs = opts.timeoutMs ?? 15_000;
  let lastError: unknown = new HttpError(0, "request failed");

  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const propagate = (): void => {
      if (opts.signal?.aborted) controller.abort(opts.signal.reason);
    };
    propagate();
    opts.signal?.addEventListener("abort", propagate, { once: true });
    try {
      const res = await fetch(url, { headers: opts.headers, signal: controller.signal });
      if (opts.maxBytes !== undefined) {
        const len = Number(res.headers.get("content-length"));
        if (Number.isFinite(len) && len > opts.maxBytes) {
          throw new HttpError(res.status, `Response exceeds ${opts.maxBytes} bytes`);
        }
      }
      if (res.status >= 500 && attempt < retries) {
        await sleep(backoff(attempt));
        continue;
      }
      if (!res.ok) {
        throw new HttpError(res.status, `HTTP ${res.status}`);
      }
      return res;
    } catch (e) {
      if (opts.signal?.aborted) throw new CancelledError();
      if (attempt < retries && !(e instanceof HttpError)) {
        await sleep(backoff(attempt));
        lastError = e;
        continue;
      }
      lastError = e;
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", propagate);
    }
  }
  if (lastError instanceof Error) throw lastError;
  throw new HttpError(0, "request failed");
}

export async function fetchText(url: string, opts: FetchOptions = {}): Promise<string> {
  const res = await fetchResilient(url, opts);
  return res.text();
}

export async function fetchJson<T>(url: string, opts: FetchOptions = {}): Promise<T> {
  const res = await fetchResilient(url, {
    ...opts,
    headers: { Accept: "application/json", ...(opts.headers ?? {}) },
  });
  return (await res.json()) as T;
}