/** Byte formatting helpers. */

export function formatBytes(bytes: number | undefined, opts?: { space?: boolean }): string {
  const b = bytes ?? 0;
  if (b <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB"];
  const i = Math.min(units.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  const value = b / 1024 ** i;
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  const sep = opts?.space === false ? "" : " ";
  return `${value.toFixed(digits)}${sep}${units[i]}`;
}

export function formatRate(bytesPerSec: number | undefined): string {
  return `${formatBytes(bytesPerSec)}/s`;
}

export function formatPercent(progress: number): string {
  const p = Math.max(0, Math.min(1, progress));
  return `${(p * 100).toFixed(p >= 0.995 ? 0 : 1)}%`;
}