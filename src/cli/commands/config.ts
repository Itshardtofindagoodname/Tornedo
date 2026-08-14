/**
 * `tornedo config` — inspect and update configuration.
 */
import type { TornedoConfig } from "../../config/config.js";
import { configFile } from "../../config/paths.js";
import type { CliContext } from "../context.js";

export async function runConfig(ctx: CliContext, positional: string[]): Promise<number> {
  const [sub, key, ...rest] = positional;

  if (sub === "path") {
    ctx.stdout(configFile());
    return 0;
  }
  if (sub === "get") {
    if (!key) throw new Error("config get requires a key: tornedo config get <key>");
    const value = getPath(ctx.app.getConfig(), key);
    if (value === undefined) throw new Error(`Unknown config key "${key}"`);
    ctx.jsonOut(value);
    return 0;
  }
  if (sub === "set") {
    if (!key || rest.length === 0) {
      throw new Error('config set requires a key and value: tornedo config set <key> <value>');
    }
    const value = coerce(rest.join(" "));
    const config = structuredClone(ctx.app.getConfig());
    setPath(config, key, value);
    await ctx.app.updateConfig(config);
    ctx.jsonOut({ [key]: value });
    return 0;
  }

  // Default: print the whole config.
  if (ctx.args.json) {
    ctx.jsonOut(ctx.app.getConfig());
  } else {
    ctx.stdout(JSON.stringify(ctx.app.getConfig(), null, 2));
  }
  return 0;
}

function coerce(raw: string): unknown {
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(raw)) return Number(raw);
  return raw;
}

function getPath(config: TornedoConfig, key: string): unknown {
  const segments = key.split(".");
  let current: unknown = config;
  for (const seg of segments) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

function setPath(config: TornedoConfig, key: string, value: unknown): void {
  const segments = key.split(".");
  let current: Record<string, unknown> = config as unknown as Record<string, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i]!;
    const next = current[seg];
    if (next === null || typeof next !== "object") {
      const fresh: Record<string, unknown> = {};
      current[seg] = fresh;
      current = fresh;
    } else {
      current = next as Record<string, unknown>;
    }
  }
  current[segments[segments.length - 1]!] = value;
}