/**
 * Filtering and sorting of releases and groups. Deterministic. Operates purely
 * on normalized result data, so changing a filter never requires re-querying
 * sources.
 */
import type { MediaCategory, Release, ReleaseGroup } from "../model/search.js";
import { compareReleases } from "./rank.js";

export interface ReleaseFilter {
  category?: MediaCategory | null;
  /** Substring match on the clean title (case-insensitive). */
  query?: string | null;
  /** Drop releases with fewer seeders than this. 0 = any. */
  minSeeders?: number;
  /** Drop releases larger than this (bytes). 0 = any. */
  maxSize?: number;
  /** Only this exact quality tier ("1080p"...). */
  quality?: string | null;
  /** Only this exact resolution ("1920x1080"...). */
  resolution?: string | null;
  /** Only this reporting source id. */
  source?: string | null;
  /** Only this video codec ("h264", "h265", "xvid"...). */
  codec?: string | null;
  /** Only this audio codec family ("AAC", "FLAC", "DTS"...). */
  audioFormat?: string | null;
  /** Only releases with this spoken language. */
  language?: string | null;
  /**
   * Drop releases with seeders 0 ONLY when a health-reporting source
   * contributed (a real 0-seed result). Releases whose sources report no
   * health have seeders unknown and are never dropped.
   */
  aliveOnly?: boolean;
  healthSources?: ReadonlySet<string>;
}

export function releaseMatches(r: Release, f: ReleaseFilter): boolean {
  if (f.category && r.category !== f.category) return false;
  if (f.query) {
    const q = f.query.toLowerCase();
    const hay = `${r.title} ${r.rawTitle} ${r.metadata.artist ?? ""} ${r.metadata.album ?? ""}`.toLowerCase();
    if (!hay.includes(q)) return false;
  }
  if (f.minSeeders && (r.seeders ?? 0) < f.minSeeders) return false;
  if (f.maxSize && (r.size ?? 0) > f.maxSize) return false;
  if (f.quality && r.metadata.quality !== f.quality) return false;
  if (f.resolution && r.metadata.resolution !== f.resolution) return false;
  if (f.source && !r.sources.includes(f.source)) return false;
  if (f.codec && r.metadata.codec !== f.codec) return false;
  if (f.audioFormat) {
    const audio = r.metadata.audio?.codec?.toLowerCase();
    if (!audio || audio !== f.audioFormat.toLowerCase()) return false;
  }
  if (f.language && !(r.metadata.languages ?? []).some((l) => l.toLowerCase() === f.language!.toLowerCase())) {
    return false;
  }
  if (f.aliveOnly && (r.seeders ?? 0) === 0) {
    const healthSources = f.healthSources;
    const contributedHealth = r.sources.some((s) => healthSources?.has(s));
    if (contributedHealth) return false;
  }
  return true;
}

export function filterReleases(list: readonly Release[], f: ReleaseFilter): Release[] {
  return list.filter((r) => releaseMatches(r, f));
}

export type SortKey =
  | "score"
  | "seeders"
  | "size"
  | "added"
  | "downloadSpeed"
  | "source"
  | "title";

export interface SortSpec {
  by: SortKey;
  dir: "asc" | "desc";
}

/** Named sort presets shown in the TUI / CLI. */
export interface SortOption {
  id: string;
  label: string;
  spec: SortSpec;
}

export const SORT_OPTIONS: readonly SortOption[] = [
  { id: "best", label: "Best Match", spec: { by: "score", dir: "desc" } },
  { id: "high-seeds", label: "High Seeds", spec: { by: "seeders", dir: "desc" } },
  { id: "low-seeds", label: "Low Seeds", spec: { by: "seeders", dir: "asc" } },
  { id: "high-speed", label: "High Download Speed", spec: { by: "downloadSpeed", dir: "desc" } },
  { id: "low-speed", label: "Low Download Speed", spec: { by: "downloadSpeed", dir: "asc" } },
  { id: "high-size", label: "High Size", spec: { by: "size", dir: "desc" } },
  { id: "low-size", label: "Low Size", spec: { by: "size", dir: "asc" } },
  { id: "newest", label: "Newest", spec: { by: "added", dir: "desc" } },
  { id: "oldest", label: "Oldest", spec: { by: "added", dir: "asc" } },
  { id: "source", label: "Source", spec: { by: "source", dir: "asc" } },
  { id: "title", label: "Title", spec: { by: "title", dir: "asc" } },
];

export function defaultSortSpec(): SortSpec {
  return { by: "score", dir: "desc" };
}

export function sortReleases(list: readonly Release[], spec: SortSpec = defaultSortSpec()): Release[] {
  const out = [...list];
  const dir = spec.dir === "asc" ? 1 : -1;
  out.sort((a, b) => {
    let cmp = 0;
    switch (spec.by) {
      case "score":
        cmp = a.score - b.score;
        break;
      case "seeders":
        cmp = (a.seeders ?? 0) - (b.seeders ?? 0);
        break;
      case "size":
        cmp = (a.size ?? 0) - (b.size ?? 0);
        break;
      case "added":
        cmp = (a.added ?? 0) - (b.added ?? 0);
        break;
      case "downloadSpeed":
        // Search results have no download speed yet (0); the deterministic
        // fallback keeps the order stable and honest.
        cmp = ((a as { downloadSpeed?: number }).downloadSpeed ?? 0) - ((b as { downloadSpeed?: number }).downloadSpeed ?? 0);
        break;
      case "source":
        cmp = (a.sources[0] ?? "").localeCompare(b.sources[0] ?? "");
        break;
      case "title":
        cmp = a.title.localeCompare(b.title);
        break;
    }
    if (cmp !== 0) return cmp * dir;
    // Deterministic fallback.
    return compareReleases(a, b);
  });
  return out;
}

export function filterGroups(list: readonly ReleaseGroup[], f: ReleaseFilter): ReleaseGroup[] {
  return list
    .map((g) => ({
      ...g,
      releases: filterReleases(g.releases, f),
    }))
    .filter((g) => g.releases.length > 0);
}

/** Human summary of the active filters, for the status chip row. */
export function describeFilter(f: ReleaseFilter): string[] {
  const parts: string[] = [];
  if (f.category) parts.push(`category:${f.category.toLowerCase()}`);
  if (f.query) parts.push(`"${f.query}"`);
  if (f.minSeeders) parts.push(`≥${f.minSeeders} seeds`);
  if (f.maxSize) parts.push(`≤${(f.maxSize / (1 << 30)).toFixed(1)}G`);
  if (f.quality) parts.push(`quality:${f.quality}`);
  if (f.resolution) parts.push(`res:${f.resolution}`);
  if (f.source) parts.push(`src:${f.source}`);
  if (f.codec) parts.push(`codec:${f.codec}`);
  if (f.audioFormat) parts.push(`audio:${f.audioFormat}`);
  if (f.language) parts.push(`lang:${f.language}`);
  if (f.aliveOnly) parts.push("alive only");
  return parts;
}

/** Human label for a sort preset/spec, for the status chip row. */
export function sortLabel(spec: SortSpec, customLabel?: string): string {
  if (customLabel) return customLabel;
  const preset = SORT_OPTIONS.find((o) => o.spec.by === spec.by && o.spec.dir === spec.dir);
  if (preset) return preset.label;
  return `${spec.by} ${spec.dir}`;
}

const SIZE_RE = /^(\d+(?:\.\d+)?)([kmgt]?b?)$/i;

function parseSize(raw: string): number | undefined {
  const m = SIZE_RE.exec(raw.trim());
  if (!m) return undefined;
  const value = Number(m[1]);
  const unit = (m[2] ?? "b").toLowerCase().replace("b", "");
  const mult: Record<string, number> = { "": 1, k: 1 << 10, m: 1 << 20, g: 1 << 30, t: 1 << 40 };
  return Math.round(value * (mult[unit] ?? 1));
}

/**
 * Parse free-form filter text into a `ReleaseFilter`. Grammar (space
 * separated): `min:<seeders> max:<size> src:<id> res:<res> codec:<codec>
 * audio:<audio> lang:<lang> quality:<q>`. Unknown tokens are ignored so
 * partial typing is safe.
 */
export function parseFilterText(text: string): ReleaseFilter {
  const out: ReleaseFilter = {};
  for (const tok of text.trim().split(/\s+/)) {
    if (!tok) continue;
    const eq = tok.indexOf(":");
    if (eq === -1) continue;
    const key = tok.slice(0, eq).toLowerCase();
    const value = tok.slice(eq + 1);
    if (!value) continue;
    switch (key) {
      case "min": {
        const n = Number(value);
        if (Number.isFinite(n) && n > 0) out.minSeeders = Math.floor(n);
        break;
      }
      case "max": {
        const size = parseSize(value);
        if (size && size > 0) out.maxSize = size;
        break;
      }
      case "src":
        out.source = value;
        break;
      case "res":
        out.resolution = value;
        break;
      case "codec":
        out.codec = value;
        break;
      case "audio":
        out.audioFormat = value;
        break;
      case "lang":
        out.language = value;
        break;
      case "quality":
        out.quality = value;
        break;
      default:
        break;
    }
  }
  return out;
}

/** Serialize a filter back to filter-text form (round-trips parseFilterText). */
export function filterToQueryText(f: ReleaseFilter): string {
  const parts: string[] = [];
  if (f.minSeeders) parts.push(`min:${f.minSeeders}`);
  if (f.maxSize) parts.push(`max:${(f.maxSize / (1 << 20)).toFixed(0)}m`);
  if (f.quality) parts.push(`quality:${f.quality}`);
  if (f.resolution) parts.push(`res:${f.resolution}`);
  if (f.source) parts.push(`src:${f.source}`);
  if (f.codec) parts.push(`codec:${f.codec}`);
  if (f.audioFormat) parts.push(`audio:${f.audioFormat}`);
  if (f.language) parts.push(`lang:${f.language}`);
  return parts.join(" ");
}