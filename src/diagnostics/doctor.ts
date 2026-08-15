/**
 * `tornedo doctor` — self-diagnostics for the local installation.
 *
 * Inspects configuration, the database, the download directory, filesystem
 * permissions, disk space, the torrent engine, network connectivity, DHT,
 * trackers, source availability and corrupted/inconsistent state, and reports
 * each check with an actionable fix. Never crashes: every check swallows its
 * own errors and reports them as a failing check.
 */
import { constants } from "node:fs";
import { access, readFile, statfs } from "node:fs/promises";
import type { Application } from "../app/application.js";
import { currentSchemaVersion, isOpen } from "../database/db.js";
import { latestSchemaVersion } from "../database/migrations.js";
import { configFile } from "../config/paths.js";

export interface DoctorCheck {
  id: string;
  label: string;
  /** True when everything is fine. */
  ok: boolean;
  /** Non-fatal issue worth surfacing. */
  warning: boolean;
  detail: string;
  fix?: string;
}

export interface DoctorReport {
  checks: DoctorCheck[];
  /** False when any check failed (excluding warnings). */
  healthy: boolean;
}

const PROBE_URL = "https://tracker.tamersunion.org:443/announce";
const PROBE_TIMEOUT_MS = 5_000;

/** Run every check. `probeSources` toggles live per-source reachability probes. */
export async function runDoctor(app: Application, opts: { probeSources?: boolean } = {}): Promise<DoctorReport> {
  const cfg = app.getConfig();
  const checks: DoctorCheck[] = [];

  checks.push(await checkConfiguration());
  checks.push(await checkDatabase(app));
  checks.push(await checkDownloadDirectory(cfg.downloadDir));
  checks.push(await checkDiskSpace(cfg.downloadDir, cfg.diskSpaceWarningMb));
  checks.push(await checkEngine(app));
  checks.push(await checkNetwork());
  checks.push(await checkDht(app));
  checks.push(await checkTrackers(app));
  checks.push(await checkSources(app, opts.probeSources ?? false));
  checks.push(checkConsistency(app));
  checks.push(checkInterrupted(app));

  const failed = checks.some((c) => !c.ok && !c.warning);
  return { checks, healthy: !failed };
}

async function checkConfiguration(): Promise<DoctorCheck> {
  try {
    const raw = await readFile(configFile(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") {
      return fail("configuration", "Config file exists but is not an object.", "Re-run `tornedo config` or delete the file to regenerate it.");
    }
    return ok("configuration", `Config file is valid JSON (${configFile()}).`);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "ENOENT") {
      return ok("configuration", "No config file yet — defaults are in effect.");
    }
    return fail("configuration", `Config file is unreadable or invalid: ${msg(e)}`, "Delete or repair the config file, then run `tornedo config`.");
  }
}

async function checkDatabase(app: Application): Promise<DoctorCheck> {
  const db = app.db.db;
  try {
    if (!isOpen(db)) return fail("database", "Database handle is closed.", "Restart tornedo.");
    let integrity = "ok";
    try {
      const row = db.prepare("PRAGMA integrity_check").get() as { integrity_check: string };
      integrity = row?.integrity_check ?? "ok";
    } catch {
      integrity = "unreadable";
    }
    const version = currentSchemaVersion(db);
    const latest = latestSchemaVersion();
    if (integrity !== "ok") {
      return fail(
        "database",
        `SQLite integrity check failed: ${integrity}.`,
        "Restore the database from a backup, or remove it to start fresh (downloads in flight will be lost).",
      );
    }
    if (version !== latest) {
      return fail("database", `Schema version ${version} is behind latest (${latest}).`, "Run a newer tornedo version so migrations apply.");
    }
    return ok("database", `SQLite database healthy (schema v${version}, WAL).`);
  } catch (e) {
    return fail("database", `Database check threw: ${msg(e)}`, "Restart tornedo; if it persists, restore from backup.");
  }
}

async function checkDownloadDirectory(dir: string): Promise<DoctorCheck> {
  try {
    await access(dir, constants.R_OK | constants.W_OK);
    return ok("download-dir", `Download directory exists and is writable: ${dir}`);
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === "ENOENT") {
      return fail("download-dir", `Download directory does not exist: ${dir}`, "Create it (`mkdir -p`) or run `tornedo config set downloadDir <dir>`.");
    }
    if (code === "EACCES" || code === "EPERM") {
      return fail("download-dir", `Download directory is not writable: ${dir}`, "Fix its permissions or choose another directory.");
    }
    return fail("download-dir", `Download directory check failed: ${msg(e)}`, "Fix the path or its permissions.");
  }
}

async function checkDiskSpace(dir: string, warningMb: number): Promise<DoctorCheck> {
  try {
    const stats = await statfs(dir);
    const freeBytes = stats.bavail * stats.bsize;
    const freeMb = Math.floor(freeBytes / (1 << 20));
    if (freeMb < warningMb) {
      return warn(
        "disk-space",
        `Only ${freeMb} MiB free on the download volume.`,
        `Free up space or raise diskSpaceWarningMb. Downloads may fail below ${warningMb} MiB.`,
      );
    }
    return ok("disk-space", `${freeMb} MiB free on the download volume.`);
  } catch (e) {
    return warn("disk-space", `Could not stat the download volume: ${msg(e)}`, "Check the download directory path.");
  }
}

async function checkEngine(app: Application): Promise<DoctorCheck> {
  const client = app.getClient();
  try {
    const stats = client.stats();
    const port = client.listenPort();
    const detail = `Engine "${client.kind}" responding (${stats.active} active, listening port ${port ?? "n/a"}).`;
    return port === null
      ? warn("engine", `${detail} No listening port bound yet — peers may be discoverable via DHT only.`, "Allow the engine a moment to bind; on restricted networks enable UPnP/NAT-PMP.")
      : ok("engine", detail);
  } catch (e) {
    return fail("engine", `Torrent engine failed: ${msg(e)}`, "Restart tornedo; if it persists, reinstall webtorrent.");
  }
}

async function checkNetwork(): Promise<DoctorCheck> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
    try {
      const res = await fetch(PROBE_URL, { method: "GET", signal: controller.signal });
      if (res.status >= 400 && res.status < 500) {
        return fail("network", `Tracker endpoint returned HTTP ${res.status}.`, "The tracker may block non-BitTorrent clients; treat this as a reachability signal only.");
      }
      return ok("network", `Outbound network reachable (tracker responded ${res.status}).`);
    } finally {
      clearTimeout(timer);
    }
  } catch (e) {
    return fail("network", `Outbound network unreachable: ${msg(e)}`, "Check your internet connection, proxy or firewall. DHT/tracker discovery needs UDP and TCP egress.");
  }
}

function checkDht(app: Application): DoctorCheck {
  const items = app.manager.list();
  const snapshots = items.map((i) => i.diagnostics).filter(Boolean) as NonNullable<(typeof items)[number]["diagnostics"]>[];
  const latest = snapshots[snapshots.length - 1];
  if (!latest) {
    return ok("dht", "No active torrents to sample DHT from yet.");
  }
  if (latest.dht === "ready") {
    return ok("dht", `DHT ready (${latest.dhtRoutingNodes} routing nodes, ${latest.dhtResponses} responses).`);
  }
  if (latest.dht === "disabled") {
    return warn("dht", "DHT is disabled for this client.", "DHT gives you peer discovery without trackers; enable it if available.");
  }
  if (latest.dht === "failed") {
    return fail("dht", "DHT failed to start.", "A firewall or blocked UDP may be interfering; check that UDP egress is allowed.");
  }
  return warn("dht", `DHT still ${latest.dht} (${latest.dhtRoutingNodes} routing nodes).`, "This is normal right after startup; it should reach `ready` within a minute.");
}

function checkTrackers(app: Application): DoctorCheck {
  const items = app.manager.list();
  let total = 0;
  let healthy = 0;
  for (const it of items) {
    total += it.diagnostics?.trackerTotal ?? 0;
    healthy += it.diagnostics?.trackerHealthy ?? 0;
  }
  if (total === 0) {
    return ok("trackers", "No active torrents to sample trackers from yet.");
  }
  if (healthy >= total) {
    return ok("trackers", `${healthy}/${total} trackers healthy.`);
  }
  if (healthy === 0) {
    return warn("trackers", `0/${total} trackers responded across active torrents.`, "Trackers may be temporarily down; DHT/PEX usually still find peers.");
  }
  return ok("trackers", `${healthy}/${total} trackers healthy.`);
}

async function checkSources(app: Application, probe: boolean): Promise<DoctorCheck> {
  const enabled = app.sources.filter((s) => app.isSourceEnabled(s.id));
  if (enabled.length === 0) {
    return fail("sources", "No sources are enabled.", "Enable sources via `tornedo config set sources.<id> true`.");
  }
  if (!probe) {
    return ok("sources", `${enabled.length} sources enabled (${app.sources.length} installed). Run \`tornedo sources --check\` for per-endpoint capability probes.`);
  }
  let healthyCount = 0;
  const failures: string[] = [];
  const results = await Promise.allSettled(
    enabled.map(async (s) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
      try {
        const res = await fetch(s.homepage, { signal: controller.signal });
        clearTimeout(timer);
        if (res.ok || res.status === 404 || res.status === 403 || res.status === 429) {
          healthyCount++;
        } else {
          failures.push(`${s.id} (HTTP ${res.status})`);
        }
      } catch {
        clearTimeout(timer);
        failures.push(s.id);
      }
    }),
  );
  void results;
  if (failures.length === 0) {
    return ok("sources", `${healthyCount}/${enabled.length} sources reachable.`);
  }
  return warn(
    "sources",
    `${healthyCount}/${enabled.length} sources reachable; ${failures.join(", ")} unreachable.`,
    "Unreachable sources are skipped per-search, so results never break — check each site or your network.",
  );
}

function checkConsistency(app: Application): DoctorCheck {
  const issues: string[] = [];
  for (const it of app.manager.list()) {
    if (it.progress < 0 || it.progress > 1) issues.push(`${it.name}: progress ${it.progress}`);
    if (it.downloaded < 0) issues.push(`${it.name}: negative downloaded`);
    if (it.status === "error" && it.error) issues.push(`${it.name}: error state (${it.error})`);
  }
  if (issues.length === 0) {
    return ok("state", "No corrupted or inconsistent download state detected.");
  }
  return warn("state", `${issues.length} item(s) with inconsistent state: ${issues.slice(0, 3).join("; ")}.`, "Retry the affected items from the downloads view, or remove and re-add them.");
}

function checkInterrupted(app: Application): DoctorCheck {
  const recovery = app.manager.lastRecovery();
  const interrupted = app.manager.list().filter((it) => ACTIVE_STATUSES.has(it.status));
  if (recovery) {
    const notes = [
      `Previous run recovered: ${recovery.resumed.length} resumed, ${recovery.completed.length} verified complete, ${recovery.failed.length} failed.`,
      ...recovery.notes,
    ];
    return recovery.failed.length > 0
      ? warn("recovery", notes[0]!, "See the recovered items in the downloads view; failed items may need a manual retry.")
      : ok("recovery", notes.join(" "));
  }
  if (interrupted.length > 0) {
    return warn("recovery", `${interrupted.length} download(s) are mid-flight and will resume.`, "This is expected after a restart; progress is preserved.");
  }
  return ok("recovery", "No interrupted downloads.");
}

const ACTIVE_STATUSES = new Set(["downloading", "starting", "waiting_metadata", "ready", "stalled", "checking"]);

function ok(id: string, label: string): DoctorCheck {
  return { id, label, ok: true, warning: false, detail: label };
}

function warn(id: string, detail: string, fix: string): DoctorCheck {
  return { id, label: detail, ok: true, warning: true, detail, fix };
}

function fail(id: string, detail: string, fix: string): DoctorCheck {
  return { id, label: detail, ok: false, warning: false, detail, fix };
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/** Render a doctor report for the terminal. */
export function renderDoctor(report: DoctorReport, opts: { width?: number } = {}): string {
  const lines: string[] = [];
  for (const check of report.checks) {
    const marker = check.ok ? (check.warning ? "⚠" : "✓") : "✕";
    lines.push(`  ${marker} ${check.detail}`);
    if (!check.ok || check.warning) {
      if (check.fix) lines.push(`      ${check.fix}`);
    }
  }
  const failed = report.checks.filter((c) => !c.ok && !c.warning).length;
  const warnings = report.checks.filter((c) => c.warning).length;
  lines.push("");
  lines.push(
    failed === 0
      ? warnings === 0
        ? "  ✓ Tornedo is healthy."
        : `  ⚠ Tornedo is healthy with ${warnings} warning(s).`
      : `  ✕ ${failed} problem(s) found — see above for fixes.`,
  );
  return lines.join("\n");
}