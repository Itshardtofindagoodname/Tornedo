/** Time/duration formatting helpers. */

/** Format milliseconds as a compact duration: "3m 42s", "1h 05m", "9d". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "--";
  const totalSecs = Math.round(ms / 1000);
  if (totalSecs < 1) return "<1s";
  const days = Math.floor(totalSecs / 86400);
  const hours = Math.floor((totalSecs % 86400) / 3600);
  const minutes = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(secs).padStart(2, "0")}s`;
  return `${secs}s`;
}

/** Format a Unix-seconds timestamp as a short date "2024-05-01". */
export function formatDate(unixSeconds: number | undefined): string {
  if (!unixSeconds) return "";
  const d = new Date(unixSeconds * 1000);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString().slice(0, 10);
}

export function relativeTime(unixSeconds: number | undefined, now = Date.now()): string {
  if (!unixSeconds) return "";
  const diffMs = now - unixSeconds * 1000;
  const mins = Math.round(diffMs / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.round(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.round(days / 30);
  if (months < 12) return `${months}mo ago`;
  return `${Math.round(months / 12)}y ago`;
}

/** Progress bar of `width` cells using block characters. */
export function progressBar(progress: number, width: number): string {
  const p = Math.max(0, Math.min(1, progress));
  const filled = Math.floor(p * width);
  const rest = width - filled;
  if (filled >= width) return "█".repeat(width);
  return "█".repeat(filled) + "░".repeat(rest);
}

export function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

export function truncate(value: string, width: number): string {
  if (value.length <= width) return value;
  if (width <= 1) return value.slice(0, width);
  return value.slice(0, Math.max(0, width - 1)) + "…";
}