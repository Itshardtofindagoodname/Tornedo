/**
 * Resilient HTTP helpers for source adapters: retries with backoff, per-request
 * timeouts, abort propagation, and a cancelled signal error for the engine.
 */
import { fetchWithDohFallback } from "./doh.js";

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

/**
 * Thrown when a source responded (HTML/JSON/RSS arrived) but the structure no
 * longer matches what the adapter knows how to parse. The engine classifies
 * this as a `parse` failure, distinct from timeouts / HTTP errors / outages.
 */
export class ParseError extends Error {
  constructor(message = "source structure could not be parsed") {
    super(message);
    this.name = "ParseError";
  }
}

/**
 * Thrown when a source is healthy but does not support the requested category
 * or query type (e.g. a Torznab endpoint with no `music` capability). The
 * engine classifies this as `unsupported` — a real, actionable signal, never
 * an empty result set.
 */
export class UnsupportedError extends Error {
  constructor(message = "source does not support this query type") {
    super(message);
    this.name = "UnsupportedError";
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
      // The DoH fallback gets its own fresh budget via opts.signal, so a
      // poisoned-DNS network cannot burn the whole per-attempt timeout before
      // the bypass transport is ever tried.
      const res = await fetchWithDohFallback(
        url,
        () => fetch(url, { headers: opts.headers, signal: controller.signal }),
        { headers: opts.headers, timeoutMs, signal: opts.signal },
      );
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

/**
 * Fetch from the first mirror that answers successfully. All mirrors are raced
 * concurrently so one slow or hanging domain can never consume the source's
 * entire timeout budget before a fallback is tried. Losing requests are
 * aborted once a winner is chosen; an outer abort cancels everything. The
 * winner's URL is returned so callers can resolve relative links against the
 * mirror that actually answered.
 */
export async function fetchFromFirstMirror(urls: string[], opts: FetchOptions = {}): Promise<{ url: string; body: string }> {
  if (urls.length === 0) throw new HttpError(0, "no mirrors configured");
  const outer = opts.signal;
  const controller = new AbortController();
  const onOuterAbort = (): void => controller.abort(outer?.reason);
  if (outer?.aborted) controller.abort(outer.reason);
  outer?.addEventListener("abort", onOuterAbort, { once: true });
  try {
    return await Promise.any(
      urls.map(async (url) => {
        const res = await fetchResilient(url, { ...opts, signal: controller.signal });
        return { url, body: await res.text() };
      }),
    );
  } catch (e) {
    if (outer?.aborted) throw new CancelledError();
    if (e instanceof AggregateError && e.errors.length > 0) throw e.errors[0];
    throw e;
  } finally {
    controller.abort();
    outer?.removeEventListener("abort", onOuterAbort);
  }
}

export async function fetchTextFromFirstMirror(urls: string[], opts: FetchOptions = {}): Promise<string> {
  return (await fetchFromFirstMirror(urls, opts)).body;
}

export async function fetchJsonFromFirstMirror<T>(urls: string[], opts: FetchOptions = {}): Promise<T> {
  const { body } = await fetchFromFirstMirror(urls, {
    ...opts,
    headers: { Accept: "application/json", ...(opts.headers ?? {}) },
  });
  return JSON.parse(body) as T;
}