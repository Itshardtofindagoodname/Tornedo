/**
 * External media player support: detection, command construction and spawn.
 * Just like MovieBox-Tui we drive mpv / VLC / IINA, passing HTTP headers for
 * authenticated streams and a start offset for resuming. mpv additionally
 * gets a tiny Lua tracker script that records position/duration on exit so the
 * Watch history can restore "continue watching".
 */
import { access, mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir, platform, tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { generateHash } from "./crypto.js";

export interface Player {
  id: string;
  name: string;
  command: string;
  args?: string[];
}

export interface PlayOptions {
  url: string;
  /** Header name→value pairs applied to the stream. */
  headers: Record<string, string>;
  /** Local subtitle file path or remote subtitle URL. */
  subtitle?: string;
  startSeconds?: number;
  title?: string;
  /** Path to write mpv tracker state to (mpv only). */
  trackerStateFile?: string;
  macOsOpen?: boolean;
}

const PREFERRED_ORDER = ["mpv", "vlc", "iina"];

/* ----------------------------------------------------------------------------- *
 * Player detection — mirrors MovieBox-Tui's probing strategy: an explicit env
 * override wins, then well-known install locations per platform, then PATH.
 * This is what makes VLC/mpv visible when they were installed to their default
 * Windows/Homebrew/Flatpak/Snap locations without being on PATH.
 * ----------------------------------------------------------------------------- */

const ENV_OVERRIDES = { mpv: "TORNEDO_MPV_PATH", vlc: "TORNEDO_VLC_PATH", iina: "TORNEDO_IINA_PATH" } as const;

type PlayerId = "mpv" | "vlc" | "iina";

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function configuredExecutable(env: NodeJS.ProcessEnv, variable: string): string | null {
  const value = envValue(env, variable);
  if (value === undefined) return null;
  if (existsSync(value)) return value;
  if (findOnPath(value) !== null) return value;
  return null;
}

/** PATH probe honoring absolute paths; on Windows appends .exe/.cmd. */
function findOnPath(name: string): string | null {
  if (name.includes("/") || name.includes("\\")) {
    return existsSync(name) ? name : null;
  }
  const pathEnv = process.env.PATH ?? "";
  const entries = pathEnv.split(platform() === "win32" ? ";" : ":");
  const hasExt = /\.[a-zA-Z0-9]{1,4}$/.test(name);
  const candidates =
    platform() === "win32" && !hasExt ? [name, `${name}.exe`, `${name}.cmd`] : [name];
  for (const dir of entries) {
    if (dir.length === 0) continue;
    for (const candidate of candidates) {
      const full = join(dir, candidate);
      if (existsSync(full)) return full;
    }
  }
  return null;
}

/** Well-known install locations, matching the reference's probe order. */
function wellKnownPaths(id: PlayerId, env: NodeJS.ProcessEnv, platformOs: NodeJS.Platform): string[] {
  const home = envValue(env, "USERPROFILE") ?? envValue(env, "HOME") ?? homedir();
  if (platformOs === "win32") {
    const local = envValue(env, "LOCALAPPDATA") ?? "";
    const appdata = envValue(env, "APPDATA") ?? "";
    if (id === "vlc") {
      return [
        "C:\\Program Files\\VideoLAN\\VLC\\vlc.exe",
        "C:\\Program Files (x86)\\VideoLAN\\VLC\\vlc.exe",
        local !== "" ? `${local}\\Microsoft\\WindowsApps\\vlc.exe` : "",
        local !== "" ? `${local}\\Programs\\VLC\\vlc.exe` : "",
        appdata !== "" ? `${appdata}\\vlc\\vlc.exe` : "",
        `${home}\\scoop\\shims\\vlc.exe`,
        "C:\\ProgramData\\chocolatey\\bin\\vlc.exe",
      ].filter(Boolean);
    }
    if (id === "mpv") {
      return [
        "C:\\Program Files\\mpv\\mpv.exe",
        "C:\\Program Files (x86)\\mpv\\mpv.exe",
        local !== "" ? `${local}\\Programs\\mpv\\mpv.exe` : "",
        appdata !== "" ? `${appdata}\\mpv\\mpv.exe` : "",
        `${home}\\scoop\\shims\\mpv.exe`,
        "C:\\ProgramData\\chocolatey\\bin\\mpv.exe",
      ].filter(Boolean);
    }
    return [];
  }
  if (platformOs === "darwin") {
    if (id === "iina") return ["/Applications/IINA.app/Contents/MacOS/iina", `${home}/Applications/IINA.app/Contents/MacOS/iina`];
    if (id === "vlc") {
      return [
        "/Applications/VLC.app/Contents/MacOS/VLC",
        `${home}/Applications/VLC.app/Contents/MacOS/VLC`,
        "/opt/homebrew/bin/vlc",
        "/usr/local/bin/vlc",
      ];
    }
    return [
      "/opt/homebrew/bin/mpv",
      "/usr/local/bin/mpv",
      "/Applications/mpv.app/Contents/MacOS/mpv",
      `${home}/Applications/mpv.app/Contents/MacOS/mpv`,
    ];
  }
  // Linux / BSD / Android-ish.
  if (id === "vlc") {
    return [
      "/usr/bin/vlc",
      "/usr/local/bin/vlc",
      "/app/bin/vlc",
      `${home}/.local/share/flatpak/exports/bin/org.videolan.VLC`,
      "/var/lib/flatpak/exports/bin/org.videolan.VLC",
      "/snap/bin/vlc",
      "/var/lib/snapd/snap/bin/vlc",
    ];
  }
  if (id === "mpv") {
    return [
      "/usr/bin/mpv",
      "/usr/local/bin/mpv",
      "/app/bin/mpv",
      `${home}/.local/share/flatpak/exports/bin/io.mpv.Mpv`,
      "/var/lib/flatpak/exports/bin/io.mpv.Mpv",
      "/snap/bin/mpv",
      "/var/lib/snapd/snap/bin/mpv",
    ];
  }
  return [];
}

function binNames(id: PlayerId, platformOs: NodeJS.Platform): string[] {
  if (id === "iina") return platformOs === "darwin" ? ["iina", "iina-cli"] : [];
  if (platformOs === "win32") return id === "vlc" ? ["vlc.exe", "vlc"] : ["mpv.exe", "mpv"];
  return id === "vlc" ? ["vlc", "org.videolan.VLC"] : ["mpv", "io.mpv.Mpv"];
}

function resolvePlayer(id: PlayerId, env: NodeJS.ProcessEnv, platformOs: NodeJS.Platform): string | null {
  const override = configuredExecutable(env, ENV_OVERRIDES[id]);
  if (override !== null) return override;
  if (id === "iina" && platformOs !== "darwin") return null;
  const known = wellKnownPaths(id, env, platformOs);
  for (const candidate of known) if (existsSync(candidate)) return candidate;
  for (const bin of binNames(id, platformOs)) {
    const found = findOnPath(bin);
    if (found !== null) return found;
  }
  return null;
}

export function detectPlayers(
  platformOs: NodeJS.Platform = platform(),
  env: NodeJS.ProcessEnv = process.env,
): Player[] {
  const found: Player[] = [];
  for (const id of PREFERRED_ORDER as PlayerId[]) {
    const command = resolvePlayer(id, env, platformOs);
    if (command === null) continue;
    const names: Record<PlayerId, string> = { mpv: "mpv", vlc: "VLC", iina: "IINA" };
    found.push({ id, name: names[id], command });
  }
  return found;
}

export function pickPlayer(id: string | null | undefined): Player | null {
  const available = detectPlayers();
  if (id !== null && id !== undefined && id.length > 0) {
    const exact = available.find((p) => p.id === id);
    if (exact !== undefined) return exact;
  }
  return available[0] ?? null;
}

export const MPV_TRACKER_SCRIPT = `\
local function save()
  local path = os.getenv("TORNEDO_MPV_STATE")
  if not path then return end
  local f = io.open(path, "w")
  if not f then return end
  local pos = mp.get_property_number("time-pos") or 0
  local dur = mp.get_property_number("duration") or 0
  local p = mp.get_property("path") or ""
  f:write(string.format('[{"path":%q,"time":%f,"duration":%f}]', p, pos, dur))
  f:close()
end
mp.register_event("shutdown", save)
mp.observe_property("eof-reached", "bool", function(name, value)
  if value then save() end
end)
`;

/** Persist the mpv tracker Lua to a temp file so it can be passed with --script. */
export async function writeTrackerScript(dir?: string): Promise<string> {
  const target = join(dir ?? tmpdir(), `tornedo-tracker-${generateHash(8)}.lua`);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, MPV_TRACKER_SCRIPT, "utf8");
  return target;
}

function headerArgs(headers: Record<string, string>): string[] {
  const args: string[] = [];
  for (const [name, value] of Object.entries(headers)) {
    if (/^(user-agent|referer|accept|range|authorization)$/i.test(name)) {
      args.push(`--http-header-fields=${name}: ${value}`);
    }
  }
  return args;
}

/** Players choke on Windows backslash separators in --sub-file; normalize them. */
function normalizePath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function buildCommand(
  player: Player,
  opts: PlayOptions,
  platformOs: NodeJS.Platform = platform(),
): { command: string; argv: string[] } {
  switch (player.id) {
    case "mpv": {
      const args: string[] = [
        "--force-window=immediate",
        "--no-quiet",
        "--really-quiet",
        "--no-terminal",
        "--cache=yes",
        "--demuxer-max-bytes=512MiB",
        "--demuxer-readahead-secs=8",
      ];
      args.push(...headerArgs(opts.headers));
      if (opts.subtitle !== undefined) args.push(`--sub-file=${normalizePath(opts.subtitle)}`);
      if (opts.startSeconds !== undefined && opts.startSeconds > 0) {
        args.push(`--start=${Math.floor(opts.startSeconds)}`);
      }
      if (opts.title !== undefined && opts.title.length > 0) args.push(`--force-media-title=${opts.title}`);
      if (opts.trackerStateFile !== undefined) args.push(`--script=${opts.trackerStateFile}`);
      args.push(opts.url);
      return { command: player.command, argv: args };
    }
    case "vlc": {
      const args: string[] = ["--no-video-title-show", "--play-and-exit"];
      for (const [name, value] of Object.entries(opts.headers)) {
        if (/^user-agent$/i.test(name)) args.push(`--http-user-agent=${value}`);
        else if (/^referer$/i.test(name)) args.push(`--http-referrer=${value}`);
      }
      if (opts.subtitle !== undefined) args.push(`--sub-file=${normalizePath(opts.subtitle)}`);
      if (opts.startSeconds !== undefined && opts.startSeconds > 0) {
        args.push(`:start-time=${Math.floor(opts.startSeconds)}`);
      }
      args.push(opts.url);
      return { command: player.command, argv: args };
    }
    case "iina": {
      const args = ["-a", "IINA", "--"];
      if (platformOs === "darwin") {
        return { command: "open", argv: [...args, opts.url] };
      }
      return { command: player.command, argv: [...player.args ?? [], opts.url] };
    }
    default: {
      return { command: "mpv", argv: [opts.url] };
    }
  }
}

export function spawnPlayer(
  player: Player,
  opts: PlayOptions,
  platformOs: NodeJS.Platform = platform(),
): ChildProcess {
  const { command, argv } = buildCommand(player, opts, platformOs);
  const spawned = spawn(command, argv, { stdio: "ignore", cwd: homedir() });
  spawned.unref();
  return spawned;
}

/** Touch-check a folder exists (readiness helper for download targets). */
export async function ensurePlayable(file: string): Promise<boolean> {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

export async function writeFileQuiet(file: string, data: string): Promise<void> {
  await mkdir(dirname(file), { recursive: true }).catch(() => undefined);
  await writeFile(file, data, "utf8");
}