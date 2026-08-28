/**
 * MovieBox (the "moviebox" streaming provider) HTTP client.
 *
 * Implements the signed request flow described in the provider research report:
 *  - a pool of rotating base hosts (failing hosts are skipped until later);
 *  - a bootstrapping token obtained from the `x-user` response header on the
 *    first `tab-operating` request;
 *  - request signing with a base64 HMAC-MD5 signature over a canonical string;
 *  - `data`-key unwrapping so adapters work with the payload shape directly.
 */
import { StreamError } from "./models.js";
import { canonicalQuery, generateHash, generateUuid, md5Hex, signMovieBox } from "./crypto.js";

export const MOVIEBOX_SECRET_KEY = "76iRl07s0xSN9jqmEWAt79EBJZulIQIsV64FZr2O";

const HOST_POOL = [
  "https://sanbb5.1000vusvta4.com",
  "https://ybtr4q.owq9k6tzkw.com",
  "https://kw2pu.ww4sb6x8.com",
  "https://ffttnm.947632416z.com",
  "https://jr6ctj.onmfu72ivybq.com",
  "https://hph8yc.msq3gpnqd4.com",
  "https://vamjt.wxwjubcqwqc.com",
];

const RETRYABLE_STATUS = new Set([403, 406, 407, 429, 500, 502, 503, 504]);
const PER_ATTEMPT_TIMEOUT_MS = 12000;

/* ------------------------------------------------------------------ */
/* Wire types                                                          */
/* ------------------------------------------------------------------ */

export interface MbCover {
  url?: string;
  refUrl?: string;
  purl?: string;
  useProxy?: boolean;
}

export interface MbPager {
  page?: number;
  perPage?: number;
  total?: number;
}

export interface MbSubject {
  subjectId?: string;
  /** 1 = movie, 2 = series. */
  subjectType?: number | string;
  stype?: number | string;
  title?: string;
  releaseDate?: string | number;
  cover?: MbCover;
  season?: number;
  maxEp?: number;
  description?: string;
  intro?: string;
  tagline?: string;
  imdbRatingValue?: string | number;
  genre?: string | string[];
  duration?: string;
  director?: string;
  stars?: string;
  prints?: string;
  audios?: string;
}

export interface MbResContent {
  list?: MbSubject[];
  pager?: MbPager;
}

export interface MbSeasonBlock {
  se?: number | string;
  maxEp?: number | string;
  episodeNumbers?: number[] | string[];
}

export interface MbSeasonInfo {
  seasons?: MbSeasonBlock[];
}

export interface MbExtCaption {
  url?: string;
  lanName?: string;
}

export interface MbResource {
  subjectId?: string | number;
  subjectType?: number | string;
  season?: number | string;
  seasonCount?: number | string;
  episode?: number | string;
  title?: string;
  fileName?: string;
  size?: string | number;
  resolution?: string | number;
  codecName?: string;
  language?: string;
  sourceCount?: number | string;
  resourceId?: string;
  resourceLink?: string;
  uploadBy?: string;
  extCaptions?: MbExtCaption[];
}

export interface MbResourcePage {
  list?: MbResource[];
  collectionResolutions?: { resolution?: string | number }[];
  sourceCount?: number;
  pager?: MbPager;
}

export interface MbCaptionsPage {
  list?: MbExtCaption[];
  pager?: MbPager;
}

/* ------------------------------------------------------------------ */
/* Client                                                              */
/* ------------------------------------------------------------------ */

interface ClientInfo {
  "X-Comm-Class": string;
  "X-Comm-Sem": string;
  "X-Comm-Sub": string;
  "X-Package-Name": string;
  "X-Package-Version-Code": number;
  "X-Package-Version-Name": string;
  "X-Play-Mode": string;
  "X-Player-Codec": string;
  "X-Security-Suit": string;
  osv: string;
  dId: string;
  languages: string;
  locale: string;
  width: number;
  height: number;
  density: number;
  mname: string;
  vers: string;
  is: string;
  jco: string[];
  "X-Software-Information": string;
  "A-Member": string;
  "B-Code": string;
  "A-Debug": string;
  "K-Code": string;
  "X-Debug": string;
  "X-Allow-3-dot-3-dot-5-Split": string;
  "X-Watch-Point-Force": string;
  "X-Refund": string;
  "X-Action-Type": string;
  "X-Update": string;
  "X-Identity-Force": string;
  "X-Display-Av": string;
  "X-Access-IE": string;
  "X-Proxy-Mode": string;
  "X-Wall-Paper-URL": string;
  "X-Drm-Fetch-URL": string;
  "X-Skin-URL": string;
  "X-Host-Confirm": string;
  "X-Player-Info": string;
  "X-Local-Ad": string;
  "X-Share-Config": string;
  "X-Extra-Domain": string;
  "X-User-Has-Advice": string;
  "X-Client-AB": string;
  "X-Play-Business": string;
  "X-Play-Business-2": string;
  "X-Play-Config": string;
  "X-Data-Session-Owner": string;
  "X-Json-Mode": string;
  "X-Token-Update-Mode": string;
  "X-Sub-Info": string;
  "X-Sgn-Param": string;
  "X-Chunk-Sno": string;
  "X-Cooldown-Type": string;
  "X-Remote-Encryption": string;
  "X-Request-Pack-Id": string;
  "X-Request-Pack-Key": string;
  "X-Request-bizTag": string;
  "X-Request-Flow-Id": string;
  "X-No-Ad-Show": string;
  "X-No-Red-Envelope": string;
}

function buildClientInfo(): { json: string; ua: string; advisoryRating: string } {
  const osVersion = "14";
  const model = ["Pixel 7 Pro", "Pixel 8 Pro", "SM-S918B", "SM-G991B", "Redmi K50 Pro"][Math.floor(Math.random() * 5)]!;
  const buildId = ["UA3A.240508.004", "AP2A.240505.005", "T3BF3F.240501.001"][Math.floor(Math.random() * 3)]!;
  const ua = `com.community.oneroom/101 (Linux; U; Android ${osVersion}; en_US; ${model}; Build/${buildId}; Cronet/135.0.7012.3)`;

  const info: ClientInfo = {
    "X-Comm-Class": "com.transsion.alwaysmoney",
    "X-Comm-Sem": "0",
    "X-Comm-Sub": "",
    "X-Package-Name": "com.community.oneroom",
    "X-Package-Version-Code": 10011,
    "X-Package-Version-Name": "101",
    "X-Play-Mode": "2",
    "X-Player-Codec": "2",
    "X-Security-Suit": "1",
    osv: osVersion,
    dId: generateHash(16),
    languages: "en_US",
    locale: "en_US",
    width: 1080,
    height: 2400,
    density: 2,
    mname: model,
    vers: buildId,
    is: "CN",
    jco: ["mp4", "m3u8"],
    "X-Software-Information": "",
    "A-Member": "",
    "B-Code": "",
    "A-Debug": "",
    "K-Code": "",
    "X-Debug": "",
    "X-Allow-3-dot-3-dot-5-Split": "",
    "X-Watch-Point-Force": "",
    "X-Refund": "",
    "X-Action-Type": "",
    "X-Update": "",
    "X-Identity-Force": "",
    "X-Display-Av": "",
    "X-Access-IE": "",
    "X-Proxy-Mode": "",
    "X-Wall-Paper-URL": "",
    "X-Drm-Fetch-URL": "",
    "X-Skin-URL": "",
    "X-Host-Confirm": "",
    "X-Player-Info": "",
    "X-Local-Ad": "",
    "X-Share-Config": "",
    "X-Extra-Domain": "",
    "X-User-Has-Advice": "",
    "X-Client-AB": "",
    "X-Play-Business": "",
    "X-Play-Business-2": "",
    "X-Play-Config": "",
    "X-Data-Session-Owner": "",
    "X-Json-Mode": "",
    "X-Token-Update-Mode": "",
    "X-Sub-Info": "",
    "X-Sgn-Param": "",
    "X-Chunk-Sno": "",
    "X-Cooldown-Type": "",
    "X-Remote-Encryption": "",
    "X-Request-Pack-Id": "",
    "X-Request-Pack-Key": "",
    "X-Request-bizTag": "",
    "X-Request-Flow-Id": "",
    "X-No-Ad-Show": "",
    "X-No-Red-Envelope": "",
  };
  const advisoryRating =
    Math.random() < 0.5
      ? {
          name: "A1",
          value: 1,
          skinImages: [{ url: "", useProxy: false }],
          status: 1,
          defaultAdId: "",
          valid: true,
          type: 3,
          hideAdaForm: false,
        }
      : { name: "", value: 0, status: 2, defaultAdId: "", valid: false, type: 1, hideAdaForm: true };
  void advisoryRating;

  return { json: JSON.stringify(info), ua, advisoryRating: JSON.stringify(advisoryRating) };
}

interface RequestOptions {
  method?: "GET" | "POST";
  query?: [string, string][];
  body?: string;
  signal?: AbortSignal;
}

export class MovieBoxClient {
  private activeHostIdx = 0;
  private token: string | null = null;
  private readonly info: ReturnType<typeof buildClientInfo>;
  private readonly gaid = generateUuid();
  private readonly deviceId = generateHash(32);

  constructor() {
    this.info = buildClientInfo();
  }

  get hasToken(): boolean {
    return this.token !== null;
  }

  /* ------------------------------------------------------------ */
  /* Public API                                                    */
  /* ------------------------------------------------------------ */

  async search(keyword: string, page = 1, signal?: AbortSignal): Promise<MbResContent> {
    return this.requestJson("POST", "/wefeed-mobile-bff/subject-api/search/v2", {
      body: JSON.stringify({ keyword, page, perPage: 20, subjectType: "All", tabId: "All" }),
      signal,
    }) as Promise<MbResContent>;
  }

  async getHomepage(tabId = 0, page = 1, signal?: AbortSignal): Promise<unknown> {
    return this.requestJson("GET", "/wefeed-mobile-bff/tab-operating", {
      query: [
        ["page", String(page)],
        ["tabId", String(tabId)],
        ["version", ""],
      ],
      signal,
    });
  }

  async getDetails(subjectId: string, signal?: AbortSignal): Promise<Record<string, unknown>> {
    return this.requestJson("GET", "/wefeed-mobile-bff/subject-api/get", {
      query: [["subjectId", subjectId]],
      signal,
    }) as Promise<Record<string, unknown>>;
  }

  async getSeasonInfo(subjectId: string, signal?: AbortSignal): Promise<MbSeasonInfo> {
    return this.requestJson("GET", "/wefeed-mobile-bff/subject-api/season-info", {
      query: [["subjectId", subjectId]],
      signal,
    }) as Promise<MbSeasonInfo>;
  }

  async getResources(
    subjectId: string,
    season: number,
    episode: number,
    resolution: string,
    page = 1,
    perPage = 20,
    signal?: AbortSignal,
  ): Promise<MbResourcePage> {
    const query: [string, string][] = [
      ["subjectId", subjectId],
      ["se", String(season)],
      ["ep", String(episode)],
      ["page", String(page)],
      ["perPage", String(perPage)],
    ];
    if (resolution.length > 0) query.push(["resolution", resolution]);
    return this.requestJson("GET", "/wefeed-mobile-bff/subject-api/resource", {
      query,
      signal,
    }) as Promise<MbResourcePage>;
  }

  async getExtCaptions(subjectId: string, resourceId: string, signal?: AbortSignal): Promise<MbCaptionsPage> {
    return this.requestJson("GET", "/wefeed-mobile-bff/subject-api/get-ext-captions", {
      query: [
        ["subjectId", subjectId],
        ["resourceId", resourceId],
      ],
      signal,
    }) as Promise<MbCaptionsPage>;
  }

  /* ------------------------------------------------------------ */
  /* Internal request machinery                                    */
  /* ------------------------------------------------------------ */

  private async init(signal?: AbortSignal): Promise<void> {
    if (this.token !== null) return;
    let lastError: Error | null = null;
    for (const host of HOST_POOL) {
      try {
        await this.attemptHost(host, "GET", "/wefeed-mobile-bff/tab-operating", {
          query: [
            ["page", "1"],
            ["tabId", "0"],
            ["version", ""],
          ],
          signal,
        }, HOST_POOL.length + 1);
        if (this.token !== null) return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));
        if (err instanceof StreamError && !isRetryable(err)) throw err;
      }
    }
    throw lastError ?? new StreamError("network", "moviebox bootstrap failed", { provider: "moviebox" });
  }

  private async requestJson(method: "GET" | "POST", path: string, opts: RequestOptions): Promise<unknown> {
    let lastError: Error | null = null;
    let attempts = 0;
    for (let pass = 0; pass < 3; pass++) {
      for (let i = 0; i < HOST_POOL.length; i++) {
        attempts++;
        const hostIdx = (this.activeHostIdx + i) % HOST_POOL.length;
        const host = HOST_POOL[hostIdx]!;
        try {
          const value = await this.attemptHost(host, method, path, opts, attempts);
          this.activeHostIdx = hostIdx;
          return value;
        } catch (err) {
          lastError = err instanceof Error ? err : new StreamError("network", String(err), { provider: "moviebox" });
          if (!(err instanceof StreamError) || !isRetryable(err)) throw err;
          await sleep(backoffMs(err) + Math.floor(Math.random() * 80));
        }
      }
      // No token yet → bootstrap once, then retry the request with auth.
      if (this.token !== null || pass > 0) break;
      try {
        await this.init(opts?.signal);
      } catch (err) {
        if (err instanceof StreamError && !isRetryable(err)) throw err;
      }
    }
    throw (
      lastError ??
      new StreamError("network", "moviebox request failed after retries", { provider: "moviebox" })
    );
  }

  private async attemptHost(
    host: string,
    method: "GET" | "POST",
    path: string,
    opts: RequestOptions,
    attemptCount: number,
  ): Promise<unknown> {
    const query = canonicalQuery(opts.query ?? []);
    const body = opts.body ?? "";
    const bodyLength = method === "POST" ? Buffer.byteLength(body) : 0;
    const bodySlice = method === "POST" ? body.slice(0, 102400) : "";
    const bodyHash = method === "POST" ? md5Hex(bodySlice) : "";
    const ts = Date.now();
    const url = `${host}${path}${query.length > 0 ? `?${query}` : ""}`;

    const sig = signMovieBox(MOVIEBOX_SECRET_KEY, {
      method,
      accept: "application/json",
      contentType: "application/json",
      bodyLength,
      timestampMs: ts,
      bodyHash,
      scheme: "https",
      host: new URL(host).host,
      pathname: path,
      query,
    });

    const xClientInfo = this.info.json;
    const ip = `${90 + Math.floor(Math.random() * 100)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}.${Math.floor(Math.random() * 255)}`;

    const headers: Record<string, string> = {
      "x-client-info": xClientInfo,
      "x-client-token": `${ts},${ts.toString(16).toUpperCase()}`,
      "x-forwarded-for": ip,
      "user-agent": this.info.ua,
      accept: "application/json",
      "content-type": "application/json",
      "x-tr-signature": `${ts}|2|${sig}`,
      "x-tr-gaid": this.gaid,
      "x-tr-q-time": md5Hex(String(ts)),
    };
    if (this.token !== null) headers["authorization"] = `Bearer ${this.token}`;

    const response = await fetchWithTimeout(url, {
      method,
      headers,
      body: method === "POST" ? body : undefined,
      signal: opts?.signal,
    });

    const status = response.status;
    if (status === 200) {
      const text = await readBounded(response);
      await this.captureUserToken(response);
      return unwrapBody(text);
    }
    if (RETRYABLE_STATUS.has(status)) {
      const retryAfter = Number(response.headers.get("retry-after") ?? "0") * 1000;
      throw new StreamError("rateLimited", `moviebox ${host} responded ${status} (attempt ${attemptCount})`, {
        provider: "moviebox",
        retryAfterMs: Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : undefined,
      });
    }
    const text = await response.text().catch(() => "");
    throw new StreamError("network", `moviebox ${host} responded ${status}: ${text.slice(0, 160)}`, {
      provider: "moviebox",
    });
  }

  private async captureUserToken(response: Response): Promise<void> {
    if (this.token !== null) return;
    const header = response.headers.get("x-user");
    if (header === null || header.length === 0) return;
    try {
      const parsed = JSON.parse(header) as { token?: string };
      if (typeof parsed.token === "string" && parsed.token.length > 0) {
        this.token = parsed.token;
      }
    } catch {
      // Body is not JSON; ignore.
    }
  }
}

function isRetryable(err: StreamError): boolean {
  return err.kind === "rateLimited" || err.kind === "network";
}

function backoffMs(err: StreamError): number {
  if (err.retryAfterMs !== undefined) return Math.min(err.retryAfterMs, 5000);
  return err.kind === "rateLimited" ? 400 : 200;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string; signal?: AbortSignal },
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
  const userSnap = setTimeout(() => controller.abort(), 0);
  void userSnap;
  const onUserAbort = () => controller.abort();
  if (init.signal !== undefined) {
    if (init.signal.aborted) controller.abort();
    else init.signal.addEventListener("abort", onUserAbort, { once: true });
  }
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timer);
    if (init.signal !== undefined) init.signal.removeEventListener("abort", onUserAbort);
  }
}

async function readBounded(response: Response): Promise<string> {
  const text = await response.text();
  return text;
}

function unwrapBody(text: string): unknown {
  let parsed: unknown = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new StreamError("parsing", "moviebox returned non-JSON payload", { provider: "moviebox" });
  }
  if (parsed !== null && typeof parsed === "object" && "data" in (parsed as Record<string, unknown>)) {
    return (parsed as Record<string, unknown>)["data"];
  }
  return parsed;
}