/**
 * ISP DNS-blocking countermeasures. Some networks poison public DNS answers
 * for torrent indexes (every blocked domain resolves to the same bogus IP), so
 * connections hang or reset and every source appears to "time out". This
 * module detects such connection-level failures and transparently retries the
 * request over DNS-over-HTTPS resolution: the hostname is resolved through
 * Google/Cloudflare DoH JSON APIs and the HTTP(S) request is made directly to
 * the real IP with correct SNI and certificate validation. Once a host is
 * known to need this treatment, all later requests skip the doomed direct
 * attempt entirely.
 */
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

const DOH_ENDPOINTS = [
  "https://dns.google/resolve",
  "https://cloudflare-dns.com/dns-query",
];
/** Connection-class errors that indicate DNS poisoning / network interference. */
const CONNECT_CODES = new Set([
  "UND_ERR_CONNECT_TIMEOUT",
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "ETIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "EAI_AGAIN",
]);

export function isConnectError(e: unknown): boolean {
  if (!(e instanceof Error)) return false;
  const cause = (e as { cause?: { code?: string } }).cause;
  const code = cause?.code ?? (e as { code?: string }).code;
  return typeof code === "string" && CONNECT_CODES.has(code);
}

// --- DoH resolution ---------------------------------------------------------

interface DohEntry {
  ips: string[];
  expires: number;
}

const dohCache = new Map<string, DohEntry>();
const DOH_TTL_MS = 10 * 60 * 1000;

/** Hostnames whose DoH resolution recently failed (dead or unresolvable). */
const dohFailures = new Map<string, number>();
const DOH_FAILURE_TTL_MS = 3 * 60 * 1000;

/**
 * One DoH query over a raw node https request. Deliberately avoids global
 * fetch: the resolution channel must stay independent of the application's
 * HTTP stack (and its abort semantics) to be a reliable fallback.
 */
function rawJsonGet(url: URL, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const secure = url.protocol === "https:";
    const req = (secure ? httpsRequest : httpRequest)(
      {
        host: url.hostname,
        servername: secure ? url.hostname : undefined,
        method: "GET",
        path: `${url.pathname}${url.search}`,
        headers: { Accept: "application/dns-json" },
        timeout: timeoutMs,
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
      },
    );
    req.on("timeout", () => req.destroy(new Error("DoH query timed out")));
    req.on("error", reject);
    req.end();
  });
}

async function queryDoh(endpoint: string, hostname: string): Promise<string[]> {
  const url = new URL(`${endpoint}?name=${encodeURIComponent(hostname)}&type=A`);
  const body = await rawJsonGet(url, 3_000);
  if (!body) return [];
  const json = JSON.parse(body) as { Answer?: Array<{ type?: number; data?: string }> };
  return (json.Answer ?? [])
    .filter((a) => a.type === 1 && typeof a.data === "string")
    .map((a) => a.data!)
    .filter((ip) => /^\d{1,3}(\.\d{1,3}){3}$/.test(ip));
}

/**
 * Resolve a hostname through DNS-over-HTTPS, bypassing the local resolver.
 * Results are cached for 10 minutes and recent failures for 3 minutes so dead
 * domains fail instantly instead of stalling every search. Throws when both
 * DoH providers fail.
 */
export async function dohResolve(hostname: string): Promise<string[]> {
  if (hostname.startsWith("[") && hostname.endsWith("]")) hostname = hostname.slice(1, -1);
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(hostname)) return [hostname];

  const cached = dohCache.get(hostname);
  if (cached && cached.expires > Date.now()) return cached.ips;

  const failedAt = dohFailures.get(hostname);
  if (failedAt !== undefined && Date.now() - failedAt < DOH_FAILURE_TTL_MS) {
    throw new Error(`DoH resolution for ${hostname} recently failed`);
  }

  for (const endpoint of DOH_ENDPOINTS) {
    try {
      const ips = await queryDoh(endpoint, hostname);
      if (ips.length > 0) {
        dohCache.set(hostname, { ips, expires: Date.now() + DOH_TTL_MS });
        dohFailures.delete(hostname);
        return ips;
      }
    } catch {
      // provider unreachable — fall through to the next one
    }
  }
  dohFailures.set(hostname, Date.now());
  throw new Error(`DoH resolution failed for ${hostname}`);
}

// --- Hosts known to require the DoH transport -------------------------------

const needsDoh = new Set<string>();

/**
 * Once several distinct hosts have required the bypass, the network itself is
 * almost certainly DNS-poisoned; skip the doomed direct attempt for every
 * later host instead of re-learning it one host at a time.
 */
let poisonedNetwork = false;

/** Test hook: clear all memoized state. */
export function resetDohState(): void {
  dohCache.clear();
  dohFailures.clear();
  needsDoh.clear();
  poisonedNetwork = false;
}

// --- Raw IP-directed request ------------------------------------------------

interface IpRequestResult {
  status: number;
  headers: Record<string, string>;
  text: string;
}

const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_BODY_BYTES = 8 * 1024 * 1024;

function ipRequest(
  target: URL,
  ip: string,
  headers: Record<string, string>,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<IpRequestResult> {
  return new Promise((resolve, reject) => {
    const secure = target.protocol === "https:";
    const requestOpts = {
      host: ip,
      servername: secure ? target.hostname : undefined,
      method: "GET",
      path: `${target.pathname}${target.search}`,
      headers,
      timeout: Math.max(1, timeoutMs),
      setHost: false,
    };
    const req: import("node:http").ClientRequest = secure
      ? httpsRequest(requestOpts, (res) => void responseHandler(res))
      : httpRequest(requestOpts, (res) => void responseHandler(res));

    function responseHandler(res: import("node:http").IncomingMessage): void {
      const chunks: Buffer[] = [];
      let size = 0;
      let done = false;
      res.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
          done = true;
          res.destroy();
          reject(new Error(`DoH response exceeds ${MAX_BODY_BYTES} bytes`));
          return;
        }
        chunks.push(chunk);
      });
      res.on("end", () => {
        if (done) return;
        done = true;
        const flat = Buffer.concat(chunks);
        const out: Record<string, string> = {};
        for (const [k, v] of Object.entries(res.headers)) {
          if (typeof v === "string") out[k.toLowerCase()] = v;
          else if (Array.isArray(v) && v.length > 0) out[k.toLowerCase()] = v.join(", ");
        }
        resolve({ status: res.statusCode ?? 0, headers: out, text: flat.toString("utf8") });
      });
      res.on("error", (err) => {
        if (!done) {
          done = true;
          reject(err);
        }
      });
    }
    req.setHeader("Host", target.hostname);
    const onAbort = (): void => {
      req.destroy(new Error("request cancelled"));
    };
    if (signal?.aborted) onAbort();
    signal?.addEventListener("abort", onAbort, { once: true });
    req.on("timeout", () => {
      req.destroy(new Error(`connect timed out after ${timeoutMs}ms`));
    });
    req.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      reject(err);
    });
    req.on("close", () => signal?.removeEventListener("abort", onAbort));
    req.end();
  });
}

/**
 * Fetch `url` using DoH-resolved IPs with correct SNI/cert validation,
 * following redirects (each hop re-resolved). Returns a standard Response.
 */
export async function fetchViaDoh(url: string, opts: { headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal }): Promise<globalThis.Response> {
  const timeoutMs = opts.timeoutMs ?? 15_000;
  const started = Date.now();
  let current = new URL(url);

  for (let hop = 0; hop <= 4; hop++) {
    if (opts.signal?.aborted) throw new Error("request cancelled");
    const ips = await dohResolve(current.hostname);
    const remaining = Math.max(1_000, timeoutMs - (Date.now() - started));
    const headers: Record<string, string> = {
      "User-Agent": BROWSER_UA,
      Accept: "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...(opts.headers ?? {}),
    };
    delete headers.Host;

    // Individual IPs can be selectively blocked even when the domain is fine;
    // try a few addresses, sharing this hop's remaining time budget between
    // them so retries cannot stretch past the caller's deadline.
    const deadline = Date.now() + remaining;
    const candidates = [...ips].sort(() => Math.random() - 0.5).slice(0, 3);
    let result: IpRequestResult | null = null;
    let lastError: unknown = null;
    for (const ip of candidates) {
      if (opts.signal?.aborted) throw new Error("request cancelled");
      const budget = Date.now() < deadline ? deadline - Date.now() : 1_000;
      try {
        result = await ipRequest(current, ip, headers, budget, opts.signal);
        break;
      } catch (e) {
        lastError = e;
        if (opts.signal?.aborted) throw e;
      }
    }
    if (!result) {
      throw lastError instanceof Error ? lastError : new Error(`all ${candidates.length} addresses failed for ${current.hostname}`);
    }

    if ([301, 302, 303, 307, 308].includes(result.status)) {
      const location = result.headers.location;
      if (location && hop < 4) {
        current = new URL(location, current);
        continue;
      }
    }
    const body = new TextEncoder().encode(result.text);
    const responseHeaders = new Headers();
    for (const [k, v] of Object.entries(result.headers)) {
      if (k !== "transfer-encoding" && k !== "content-length") responseHeaders.set(k, v);
    }
    return new Response(body, { status: result.status, headers: responseHeaders });
  }
  throw new Error(`too many redirects fetching ${url}`);
}

/**
 * Fetch with automatic ISP-block bypass: try the normal stack first (fast
 * paths stay fast on healthy networks); if the connection itself fails, mark
 * the host and retry — and serve all future requests for it — over DoH.
 */
export async function fetchWithDohFallback(
  url: string,
  doFetch: () => Promise<Response>,
  opts: { headers?: Record<string, string>; timeoutMs?: number; signal?: AbortSignal },
): Promise<Response> {
  const hostname = new URL(url).hostname;
  if (!needsDoh.has(hostname) && !poisonedNetwork) {
    try {
      return await doFetch();
    } catch (e) {
      // An inner AbortError while the outer signal is still live means our own
      // deadline fired before the connection was ever established — the same
      // "cannot reach this host" class as a connect failure.
      const timedOut = e instanceof Error && e.name === "AbortError";
      if (opts.signal?.aborted || (!isConnectError(e) && !timedOut)) throw e;
      needsDoh.add(hostname);
      if (needsDoh.size >= 2) poisonedNetwork = true;
      return fetchViaDoh(url, { headers: opts.headers, timeoutMs: opts.timeoutMs, signal: opts.signal });
    }
  }
  if (!poisonedNetwork || needsDoh.has(hostname)) {
    // This host is known to need the bypass (or the network is clean enough
    // that we never got here without a direct attempt).
    return fetchViaDoh(url, { headers: opts.headers, timeoutMs: opts.timeoutMs, signal: opts.signal });
  }
  // Poisoned network, unproven host: race both transports and let the fastest
  // answer win. Healthy hosts keep their fast path; blocked ones no longer pay
  // the full connect-timeout penalty before the bypass kicks in.
  return Promise.any([
    doFetch(),
    fetchViaDoh(url, { headers: opts.headers, timeoutMs: opts.timeoutMs, signal: opts.signal }),
  ]);
}
