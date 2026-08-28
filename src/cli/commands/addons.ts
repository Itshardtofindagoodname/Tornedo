/**
 * `tornedo addons [list|add|remove|clear]` — manage the Stremio addons used by
 * Watch mode. Addons enrich search/catalog results; only those whose manifest
 * lists a `stream` resource serve their own playable streams, so any addon
 * result whose provider has no streams falls back to MovieBox / 4KHDHub.
 */
import { FourKHDAddonsClient, type InstalledAddon } from "../../stream/addons.js";
import type { CliContext } from "../context.js";

export async function runAddons(ctx: CliContext, positional: readonly string[]): Promise<number> {
  const sub = positional[0] ?? "list";
  const app = ctx.app;
  switch (sub) {
    case "list":
      return list(ctx);
    case "add":
      return add(ctx, positional[1] ?? "");
    case "remove":
      return remove(ctx, positional[1] ?? "");
    case "clear":
      await app.setAddons([]);
      ctx.log("Installation addons cleared (Cinemeta returns as the default).");
      return 0;
    default:
      ctx.err(`tornedo addons: unknown subcommand "${sub}". Use: list | add <url> | remove <url|id> | clear`);
      return 1;
  }
}

interface RenderedAddon {
  id: string;
  name: string;
  streams: boolean;
  baseUrl: string;
}

async function rendered(list: InstalledAddon[]): Promise<RenderedAddon[]> {
  const client = new FourKHDAddonsClient(list);
  const rows = await Promise.all(
    list.map(async (a) => {
      const { manifest, streams } = await client.describe(a.baseUrl);
      return {
        id: manifest?.id ?? a.addonId ?? hostOf(a.baseUrl) ?? "addon",
        name: manifest?.name ?? "",
        streams,
        baseUrl: a.baseUrl,
      };
    }),
  );
  return rows;
}

async function list(ctx: CliContext): Promise<number> {
  const addons = ctx.app.streams.activeAddons.addons;
  const rows = await rendered(addons);
  if (ctx.args.json) {
    ctx.jsonOut(rows);
    return rows.length;
  }
  ctx.log(`Streaming addons (${rows.length}):`);
  for (const row of rows) {
    const capability = row.streams ? "streams: yes" : "streams: no (catalog/meta only)";
    ctx.log(`  ${row.id}  ${capability}  ${row.baseUrl}`);
  }
  if (rows.length > 0) {
    ctx.log("");
    ctx.log("Add another with: tornedo addons add <url>");
  }
  return rows.length;
}

async function add(ctx: CliContext, url: string): Promise<number> {
  const raw = url.trim();
  if (raw.length === 0 || !/^https?:\/\//.test(raw)) {
    ctx.err("tornedo addons add <url>  (an https Stremio addon manifest URL)");
    return 1;
  }
  const baseUrl = raw.replace(/\/+$/, "").replace(/\/manifest\.json$/, "");
  const client = new FourKHDAddonsClient([]);
  const info = await client.describe(baseUrl);
  if (info.manifest === null) {
    ctx.err(`No Stremio addon manifest found at ${baseUrl}/manifest.json`);
    return 1;
  }
  const current = ctx.app.streams.activeAddons.addons;
  if (current.some((a) => stripSlash(a.baseUrl) === baseUrl)) {
    ctx.log(`Addon already installed: ${info.manifest!.name ?? baseUrl}`);
    return 1;
  }
  const entry: InstalledAddon = {
    baseUrl,
    transportUrl: baseUrl,
    addonId: info.manifest.id ?? null,
  };
  await ctx.app.setAddons([...current, entry]);
  const manifest = info.manifest;
  ctx.log(`Installed addon "${manifest.name ?? baseUrl}" (${current.length + 1} total).`);
  if (info.streams) {
    ctx.log("This addon provides streams and will appear as a direct playback source.");
  } else {
    ctx.log("This addon is catalog/meta only — Watch mode will still find playable streams for its results on MovieBox / 4KHDHub.");
  }
  return 0;
}

async function remove(ctx: CliContext, query: string): Promise<number> {
  const q = query.trim().toLowerCase();
  if (q.length === 0) {
    ctx.err("tornedo addons remove <url|id>");
    return 1;
  }
  const current = ctx.app.streams.activeAddons.addons;
  const rest = current.filter((a) => {
    const host = hostOf(a.baseUrl)?.toLowerCase() ?? "";
    const id = a.addonId?.toLowerCase() ?? "";
    const base = stripSlash(a.baseUrl).toLowerCase();
    return !(base === q || base.includes(q) || id === q || id.includes(q) || host.includes(q));
  });
  const removed = current.length - rest.length;
  if (removed === 0) {
    ctx.log(`No installed addon matched "${query}".`);
    return 1;
  }
  await ctx.app.setAddons(rest);
  ctx.log(`Removed ${removed} addon${removed === 1 ? "" : "s"} (${rest.length} remain).`);
  return 0;
}

function stripSlash(base: string): string {
  return base.replace(/\/+$/, "");
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}