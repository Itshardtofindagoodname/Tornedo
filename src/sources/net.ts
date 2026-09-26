/**
 * Resilient HTTP helpers for source adapters: retries with backoff, per-request
 * timeouts, abort propagation, and a cancelled signal error for the engine.
 * Also carries the opt-in FlareSolverr escape hatch used by sources that sit
 * behind Cloudflare's JS challenge.
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
 * engine classifies this as `unsupported` - a real, actionable signal, never
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

/**
 * Markers Cloudflare leaves in a challenge interstitial. `cf-mitigated` is the
 * response header mirrored into some error pages; the others are script/style
 * URLs and the `_cf_chl_opt` bootstrap global the solver has to satisfy.
 */
const CF_CHALLENGE_MARKERS = /cf-mitigated|_cf_chl_|cf-browser-verification/i;

/**
 * The interstitial titles itself `Just a moment...`. Requiring the trailing
 * ellipsis (ASCII or U+2026) keeps it from matching ordinary titles that merely
 * start the same way - a torrent literally called "Just a Moment in Time".
 */
const CF_CHALLENGE_TITLE = /<title>\s*just a moment(?:\.{1,3}|…)/i;

/**
 * Whether a response is a Cloudflare JS challenge rather than real content.
 *
 * Only meaningful for the 403/503 statuses Cloudflare answers challenges with,
 * but the body markers are authoritative on their own: some interstitials are
 * served as 200 with the challenge markup, and a source that only ever sees
 * those would otherwise parse them into a silent, empty result.
 */
export function looksLikeCloudflareChallenge(status: number, body: string): boolean {
  if (typeof body !== "string" || body === "") return false;
  if (CF_CHALLENGE_MARKERS.test(body)) return true;
  if (CF_CHALLENGE_TITLE.test(body)) return true;
  // A trimmed-down interstitial with no <title>: only trust the loose match on
  // the statuses Cloudflare actually uses for challenges.
  return (status === 403 || status === 503) && /just a moment/i.test(body);
}

export interface FlareSolverrOptions {
  /** Base URL of the FlareSolverr instance, without the `/v1` suffix. */
  baseUrl: string;
  /** Per-request timeout in ms; also sent to FlareSolverr as `maxTimeout`. */
  timeoutMs?: number;
  signal?: AbortSignal;
}

interface FlareSolverrEnvelope {
  status?: string;
  message?: string;
  solution?: {
    status?: number;
    response?: string;
  };
}

/**
 * Fetch a URL through a FlareSolverr instance, which runs a real browser and
 * returns the post-challenge HTML.
 *
 * This deliberately does NOT go through `fetchResilient`: FlareSolverr speaks a
 * POST-with-JSON-body protocol, while `FetchOptions` is a GET-only contract used
 * by every existing call site. Widening that shared contract would ripple through
 * the whole source layer for one opt-in feature, so the abort/timeout plumbing
 * is mirrored locally instead. The client deadline is a little longer than the
 * `maxTimeout` we hand the solver so that a solver-side timeout reports a real
 * reason rather than a bare client abort.
 */
/**
 * Ceiling on in-flight FlareSolverr solves, independent of any adapter's own
 * concurrency field. Every solve asks the container for a headless browser, and
 * FlareSolverr will happily start another one per request rather than queue, so
 * an adapter fanning out over several detail pages could otherwise ask for half
 * a dozen Chromes at once and exhaust the host's memory.
 *
 * Solves past the cap wait their turn, and that wait is charged to the caller's
 * timeout - so an adapter that fans out must leave room for the queued solves,
 * not just the first one. Module-level on purpose: the limit belongs to the
 * proxy, not to any one source, and two sources searching at once should share
 * the same budget.
 */
const MAX_CONCURRENT_SOLVES = 3;

let activeSolves = 0;
const solveWaiters: (() => void)[] = [];

function acquireSolveSlot(): Promise<void> {
  if (activeSolves < MAX_CONCURRENT_SOLVES) {
    activeSolves++;
    return Promise.resolve();
  }
  return new Promise<void>((resolve) => solveWaiters.push(resolve));
}

function releaseSolveSlot(): void {
  const next = solveWaiters.shift();
  // Hand the slot straight to the next waiter; only free it if nobody is left.
  if (next) next();
  else activeSolves--;
}

/**
 * Fetch a URL through a FlareSolverr instance, which runs a real browser and
 * returns the post-challenge HTML.
 *
 * This deliberately does NOT go through `fetchResilient`: FlareSolverr speaks a
 * POST-with-JSON-body protocol, while `FetchOptions` is a GET-only contract used
 * by every existing call site. Widening that shared contract would ripple through
 * the whole source layer for one opt-in feature, so the abort/timeout plumbing
 * is mirrored locally instead. The client deadline is a little longer than the
 * `maxTimeout` we hand the solver so that a solver-side timeout reports a real
 * reason rather than a bare client abort. Callers are still bound by their own
 * signal: whichever of the two is shorter wins.
 */
export async function fetchViaFlareSolverr(
  url: string,
  opts: FlareSolverrOptions,
): Promise<{ body: string; status: number }> {
  const endpoint = `${opts.baseUrl.replace(/\/+$/, "")}/v1`;
  const timeoutMs = opts.timeoutMs && opts.timeoutMs > 0 ? opts.timeoutMs : 60_000;
  const outer = opts.signal;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const propagate = (): void => {
    if (outer?.aborted) controller.abort(outer.reason);
  };
  propagate();
  outer?.addEventListener("abort", propagate, { once: true });
  let acquired = false;
  try {
    // Checked up front, not just in the catch: a pre-aborted signal must not be
    // able to enter the queue and then claim a slot nobody will give back.
    if (controller.signal.aborted) throw new CancelledError();
    await acquireSolveSlot();
    acquired = true;
    // The signal may have fired while this call sat in the queue; re-check
    // before spending a browser page load on it.
    if (controller.signal.aborted) throw new CancelledError();
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ cmd: "request.get", url, maxTimeout: timeoutMs }),
      signal: controller.signal,
    });
    if (!res.ok) {
      throw new HttpError(res.status, `FlareSolverr at ${opts.baseUrl} returned HTTP ${res.status}`);
    }
    const payload = (await res.json()) as FlareSolverrEnvelope | null;
    if (payload?.status !== "ok") {
      // No solution exists to inspect, so surface the solver's own reason and
      // 502: the proxy answered fine, the upstream fetch it performed did not.
      throw new HttpError(502, `FlareSolverr could not solve ${url}: ${payload?.message ?? "unknown error"}`);
    }
    const solution = payload.solution ?? {};
    return { body: solution.response ?? "", status: solution.status ?? 200 };
  } catch (e) {
    if (outer?.aborted) throw new CancelledError();
    if (e instanceof HttpError) throw e;
    throw new HttpError(0, `FlareSolverr request to ${endpoint} failed: ${e instanceof Error ? e.message : String(e)}`);
  } finally {
    // Released unconditionally once held: an aborted or failed solve must not
    // strand a slot and deadlock every solve queued behind it. Never released
    // when it was not held, or a pre-aborted call would free someone else's.
    if (acquired) releaseSolveSlot();
    clearTimeout(timer);
    outer?.removeEventListener("abort", propagate);
  }
}
