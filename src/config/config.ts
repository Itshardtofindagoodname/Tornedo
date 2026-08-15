/**
 * Human-readable local configuration. Written as JSON at <configRoot>/config.json.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import { configFile, defaultDownloadDir } from "./paths.js";

export type KeyAction =
  | "up"
  | "down"
  | "pageup"
  | "pagedown"
  | "home"
  | "end"
  | "confirm"
  | "download"
  | "downloadTo"
  | "pause"
  | "resume"
  | "remove"
  | "toggleSeed"
  | "filter"
  | "copyMagnet"
  | "help"
  | "back"
  | "quit"
  | "search"
  | "downloads"
  | "toggleDetails";

export const KEY_ACTIONS: readonly KeyAction[] = [
  "up",
  "down",
  "pageup",
  "pagedown",
  "home",
  "end",
  "confirm",
  "download",
  "downloadTo",
  "pause",
  "resume",
  "remove",
  "toggleSeed",
  "filter",
  "copyMagnet",
  "help",
  "back",
  "quit",
  "search",
  "downloads",
  "toggleDetails",
];

export interface RankingConfig {
  /** Multiplier applied to the log of (seeders + 1). */
  seedersWeight: number;
  /** Multiplier applied to normalized quality tier (0..1). */
  qualityWeight: number;
  /** Multiplier applied to 1 for sources that report real health. */
  healthWeight: number;
  /** Prefer larger files within a release group when sizes differ. */
  preferLarger: boolean;
}

/**
 * A user-configured Torznab-compatible endpoint (a local indexer such as a
 * Prowlarr/Jackett instance or any Newznab/Torznab server). Tornedo never
 * assumes a specific tracker; the endpoint reports its own capabilities.
 */
export interface TorznabProviderConfig {
  /** Optional stable id; defaults to `torznab:<index>` in the list. */
  id?: string;
  /** Human-readable name shown in source lists. */
  name?: string;
  /** Base URL of the Torznab API (e.g. http://localhost:9117/api/v1). */
  baseUrl: string;
  /** API key (apikey param). Optional for endpoints that need none. */
  apiKey?: string;
  /** Whether this provider participates in searches. */
  enabled: boolean;
  /** Media categories to search. Empty = all the endpoint reports. */
  categories?: string[];
  /** Per-request timeout in ms (falls back to sourceTimeoutMs). */
  timeoutMs?: number;
  /** Search priority: lower runs first when multiple providers compete. */
  priority?: number;
}

export interface InternetArchiveConfig {
  /** Whether the Internet Archive provider participates in searches. */
  enabled: boolean;
  /** Per-request timeout in ms. */
  timeoutMs: number;
  /** Max results to return per search. */
  maxResults: number;
}

export interface TornedoConfig {
  downloadDir: string;
  /** 0 = unlimited concurrent active downloads. */
  maxActiveDownloads: number;
  /** Bytes/sec; 0 = unlimited. */
  maxDownloadSpeed: number;
  /** Bytes/sec; 0 = unlimited. */
  maxUploadSpeed: number;
  /** Per-source timeout in ms. */
  sourceTimeoutMs: number;
  /** sourceId -> enabled. */
  sources: Record<string, boolean>;
  /** Default seeding behavior after completion. */
  seedAfterComplete: boolean;
  ranking: RankingConfig;
  theme: string;
  /** action -> list of key names (see src/ui/keys.ts). */
  keybindings: Partial<Record<KeyAction, string[]>>;
  /** Watch-mode poll interval in ms. */
  watchIntervalMs: number;
  /** User-configured Torznab-compatible endpoints. */
  torznabProviders: TorznabProviderConfig[];
  /** Internet Archive provider settings. */
  internetArchive: InternetArchiveConfig;
}

export function defaultKeybindings(): Partial<Record<KeyAction, string[]>> {
  return {
    up: ["up", "k"],
    down: ["down", "j"],
    pageup: ["pageup"],
    pagedown: ["pagedown"],
    home: ["home"],
    end: ["end"],
    confirm: ["enter"],
    download: ["d"],
    downloadTo: ["shift+d"],
    pause: ["p"],
    resume: ["r"],
    remove: ["x"],
    toggleSeed: ["s"],
    filter: ["ctrl+f"],
    copyMagnet: ["y"],
    help: ["?"],
    back: ["esc"],
    quit: ["q"],
    search: ["/"],
    downloads: ["v"],
    toggleDetails: ["i"],
  };
}

export function defaultConfig(): TornedoConfig {
  return {
    downloadDir: defaultDownloadDir(),
    maxActiveDownloads: 3,
    maxDownloadSpeed: 0,
    maxUploadSpeed: 0,
    sourceTimeoutMs: 15_000,
    sources: {},
    seedAfterComplete: true,
    ranking: {
      seedersWeight: 1,
      qualityWeight: 1,
      healthWeight: 0.5,
      preferLarger: false,
    },
    theme: "default",
    keybindings: defaultKeybindings(),
    watchIntervalMs: 2_000,
    torznabProviders: [],
    internetArchive: {
      enabled: false,
      timeoutMs: 15_000,
      maxResults: 30,
    },
  };
}

const SOURCE_KEYS: (keyof TornedoConfig)[] = [
  "downloadDir",
  "maxActiveDownloads",
  "maxDownloadSpeed",
  "maxUploadSpeed",
  "sourceTimeoutMs",
  "seedAfterComplete",
  "theme",
  "watchIntervalMs",
];

function isRanking(v: unknown): v is RankingConfig {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.seedersWeight === "number" &&
    typeof r.qualityWeight === "number" &&
    typeof r.healthWeight === "number" &&
    typeof r.preferLarger === "boolean"
  );
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === "string");
}

function isKeybindings(v: unknown): v is Partial<Record<KeyAction, string[]>> {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  for (const key of Object.keys(r)) {
    if (!KEY_ACTIONS.includes(key as KeyAction)) return false;
    if (!isStringArray(r[key])) return false;
  }
  return true;
}

export function normalizeConfig(raw: unknown): TornedoConfig {
  const d = defaultConfig();
  if (!raw || typeof raw !== "object") return d;
  const r = raw as Record<string, unknown>;
  const out: TornedoConfig = { ...d };

  for (const key of SOURCE_KEYS) {
    const v = r[key];
    if (key === "downloadDir") {
      if (typeof v === "string" && v.trim()) out.downloadDir = v.trim();
    } else if (typeof v === "number" && Number.isFinite(v) && v >= 0) {
      (out as unknown as Record<string, unknown>)[key as string] = v;
    }
  }

  if (r.sources && typeof r.sources === "object" && !Array.isArray(r.sources)) {
    for (const [id, enabled] of Object.entries(r.sources as Record<string, unknown>)) {
      if (typeof enabled === "boolean") out.sources[id] = enabled;
    }
  }

  if (isRanking(r.ranking)) out.ranking = r.ranking;
  if (isKeybindings(r.keybindings)) out.keybindings = r.keybindings;

  if (Array.isArray(r.torznabProviders)) {
    out.torznabProviders = r.torznabProviders.filter(isTorznabProvider).map((p) => ({
      id: p.id?.trim() || undefined,
      name: p.name?.trim() || undefined,
      baseUrl: p.baseUrl.trim().replace(/\/+$/, ""),
      apiKey: p.apiKey?.trim() || undefined,
      enabled: p.enabled !== false,
      categories: Array.isArray(p.categories) ? p.categories.map((c) => String(c)).filter(Boolean) : undefined,
      timeoutMs: positiveOrUndefined(p.timeoutMs),
      priority: positiveOrUndefined(p.priority),
    }));
  }

  if (r.internetArchive && typeof r.internetArchive === "object") {
    const ia = r.internetArchive as Record<string, unknown>;
    out.internetArchive = {
      enabled: typeof ia.enabled === "boolean" ? ia.enabled : out.internetArchive.enabled,
      timeoutMs: positiveOrUndefined(ia.timeoutMs) ?? out.internetArchive.timeoutMs,
      maxResults: clampInt(ia.maxResults, 1, 200, out.internetArchive.maxResults),
    };
  }

  return out;
}

function isTorznabProvider(v: unknown): v is TorznabProviderConfig {
  if (!v || typeof v !== "object") return false;
  const p = v as Record<string, unknown>;
  return typeof p.baseUrl === "string" && p.baseUrl.trim().length > 0;
}

function positiveOrUndefined(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : undefined;
}

function clampInt(v: unknown, min: number, max: number, fallback: number): number {
  if (typeof v !== "number" || !Number.isFinite(v)) return fallback;
  return Math.max(min, Math.min(max, Math.round(v)));
}

export async function loadConfig(): Promise<TornedoConfig> {
  let raw: string;
  try {
    raw = await fs.readFile(configFile(), "utf8");
  } catch {
    return defaultConfig();
  }
  try {
    return normalizeConfig(JSON.parse(raw) as unknown);
  } catch {
    return defaultConfig();
  }
}

export async function saveConfig(config: TornedoConfig): Promise<void> {
  await fs.mkdir(path.dirname(configFile()), { recursive: true });
  const tmp = `${configFile()}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(config, null, 2), "utf8");
  await fs.rename(tmp, configFile());
}

/** Merge any newly-introduced keys into an on-disk config and persist if needed. */
export async function ensureConfigMigrated(): Promise<TornedoConfig> {
  const cfg = await loadConfig();
  const merged = normalizeConfig(cfg as unknown);
  // Persist when the normalized form differs so new defaults materialize.
  if (JSON.stringify(merged) !== JSON.stringify(cfg)) {
    await saveConfig(merged);
  }
  return merged;
}