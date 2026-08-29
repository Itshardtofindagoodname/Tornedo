/**
 * OS-appropriate data/config/download paths. Honors TORNEDO_STATE_DIR (used by
 * the test suite and useful for portable installs).
 */
import os from "node:os";
import path from "node:path";

export const APP_NAME = "tornedo";

export function stateRoot(): string {
  const override = process.env.TORNEDO_STATE_DIR;
  if (override && override.length > 0) return override;
  const home = os.homedir();
  const platform = process.platform;
  if (platform === "win32") {
    return path.join(process.env.APPDATA ?? path.join(home, "AppData", "Roaming"), APP_NAME);
  }
  if (platform === "darwin") {
    return path.join(home, "Library", "Application Support", APP_NAME);
  }
  const xdg = process.env.XDG_DATA_HOME;
  if (xdg && xdg.length > 0) return path.join(xdg, APP_NAME);
  return path.join(home, ".local", "share", APP_NAME);
}

export function configRoot(): string {
  const override = process.env.TORNEDO_STATE_DIR;
  if (override && override.length > 0) return override;
  const home = os.homedir();
  if (process.platform === "win32") return stateRoot();
  const xdg = process.env.XDG_CONFIG_HOME;
  if (xdg && xdg.length > 0) return path.join(xdg, APP_NAME);
  return path.join(home, ".config", APP_NAME);
}

export function dataDir(): string {
  return stateRoot();
}

export function configFile(): string {
  return path.join(configRoot(), "config.json");
}

export function dbFile(): string {
  return path.join(dataDir(), "tornedo.sqlite");
}

export function defaultDownloadDir(): string {
  return path.join(os.homedir(), "Downloads");
}

export function watchStateFile(): string {
  return path.join(dataDir(), "watch-state.json");
}

/** Root folder for streaming ("Watch") support data. */
export function streamDataDir(): string {
  return path.join(dataDir(), "stream");
}

/** Watch-mode favorites file. */
export function favoritesFile(): string {
  return path.join(streamDataDir(), "favorites.json");
}

/** Watch-mode watch-history file. */
export function streamHistoryFile(): string {
  return path.join(streamDataDir(), "history.json");
}

/** User-installed Stremio addons list. */
export function addonsFile(): string {
  return path.join(streamDataDir(), "addons.json");
}

/** Live-TV playlist sources (urls or local file paths). */
export function tvFile(): string {
  return path.join(streamDataDir(), "tv.json");
}

/** Poster byte cache (base64 within a single TTL JSON file). */
export function posterCacheFile(): string {
  return path.join(streamDataDir(), "posters.json");
}