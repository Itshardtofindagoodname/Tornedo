/**
 * Path/filename sanitization. All remote-derived names pass through here before
 * touching the filesystem: no traversal, no control chars, no reserved names.
 */
import { join } from "node:path";

const ILLEGAL_CHARS = /[<>:"/\\|?*\x00-\x1f]/g;
const TRAVERSAL = /(^|[\\/])\.\.([\\/]|$)/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function clean(base: string): string {
  return base
    .replace(ILLEGAL_CHARS, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "");
}

/** Sanitize a single filename/path segment. Returns null when unusable. */
export function sanitizeSegment(name: string): string | null {
  const cleaned = clean(name);
  if (!cleaned || cleaned === "." || cleaned === "..") return null;
  if (RESERVED.test(cleaned)) return null;
  if (cleaned.length > 200) return cleaned.slice(0, 200);
  return cleaned;
}

/** Sanitize a display name for use as the top-level download folder. */
export function safeFolderName(name: string): string {
  return sanitizeSegment(name) ?? "download";
}

/** True when a relative path stays inside its base (no absolute/traversal). */
export function isSafeRelativePath(p: string): boolean {
  if (!p || p.length === 0) return false;
  if (p.startsWith("/") || /^[a-zA-Z]:[\\/]/.test(p)) return false;
  if (TRAVERSAL.test(p.replace(/\\/g, "/"))) return false;
  return true;
}

/**
 * Join a base directory with a remote-derived relative path. Returns null when
 * the result would escape the base or contain unsafe segments.
 */
export function joinSafe(base: string, relPath: string): string | null {
  const normalized = relPath.replace(/\\/g, "/");
  if (!isSafeRelativePath(normalized)) return null;
  const segments = normalized.split("/").filter((s) => s.length > 0);
  const safeSegments: string[] = [];
  for (const seg of segments) {
    const s = sanitizeSegment(seg);
    if (!s) return null;
    safeSegments.push(s);
  }
  if (safeSegments.length === 0) return null;
  return join(base, ...safeSegments);
}