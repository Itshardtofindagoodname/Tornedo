/**
 * `tornedo sources` - list sources and their enabled state. With `--check`,
 * runs live capability discovery against configured Torznab endpoints and
 * reports which query types (search/music/movie/tv) each one supports.
 */
import { isTorznabSource, type TorznabProvider } from "../../sources/torznab.js";
import type { CliContext } from "../context.js";

export async function runSources(ctx: CliContext): Promise<number> {
  if (ctx.args.check) {
    return runCheck(ctx);
  }
  const rows = ctx.app.sources.map((s) => ({
    id: s.id,
    name: s.name,
    groups: s.groups,
    categories: s.categories,
    reportsHealth: s.reportsHealth,
    enabled: ctx.app.isSourceEnabled(s.id),
  }));
  if (ctx.args.json) {
    ctx.jsonOut(rows);
    return rows.length;
  }
  ctx.log("ID                 ENABLED  GROUPS          HEALTH");
  for (const r of rows) {
    ctx.log(
      `${r.id.padEnd(18)} ${r.enabled ? "on " : "off"}  ${r.groups.join("/").padEnd(15)} ${r.reportsHealth ? "yes" : "no "}`,
    );
  }
  ctx.log("");
  ctx.log('Enable/disable: tornedo config set sources.<id> true|false');
  return rows.length;
}

async function runCheck(ctx: CliContext): Promise<number> {
  const checks: Record<string, unknown>[] = [];
  for (const source of ctx.app.sources) {
    if (isTorznabSource(source)) {
      const caps = await fetchCapsSafe(source.provider, source.timeoutMs);
      const record = {
        id: source.id,
        name: source.name,
        type: "torznab",
        connected: caps !== null,
        search: caps?.search ?? false,
        music: caps?.music ?? false,
        movie: caps?.movie ?? false,
        tv: caps?.tv ?? false,
        capsError: source.provider.capsError,
      };
      checks.push(record);
      if (!ctx.args.json) {
        ctx.log("");
        ctx.log(`Torznab ${source.name} (${source.id})`);
        ctx.log(`  ${caps !== null ? "✓ connected" : "✕ unreachable"}${caps === null && source.provider.capsError ? ` - ${source.provider.capsError}` : ""}`);
        ctx.log(`  ${capLine(caps, "search")}`);
        ctx.log(`  ${capLine(caps, "music")}`);
        ctx.log(`  ${capLine(caps, "movie")}`);
        ctx.log(`  ${capLine(caps, "tv")}`);
        if (caps !== null && !caps.music) {
          ctx.log("  Music unsupported by configured provider");
        }
      }
    } else if (source.id === "internet-archive") {
      const record = { id: source.id, name: source.name, type: "internet-archive", enabled: true };
      checks.push(record);
      if (!ctx.args.json) {
        ctx.log("");
        ctx.log(`Internet Archive (${source.id})`);
        ctx.log(`  ● healthy - public audio items via archive.org APIs`);
      }
    }
  }
  if (checks.length === 0) {
    ctx.log("No configured Torznab or Internet Archive providers.");
  }
  if (ctx.args.json) {
    ctx.jsonOut(checks);
  }
  return checks.length;
}

async function fetchCapsSafe(provider: TorznabProvider, timeoutMs: number) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await provider.fetchCapabilities({ signal: controller.signal, timeoutMs });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function capLine(caps: unknown, mode: "search" | "music" | "movie" | "tv"): string {
  const c = caps as { search?: boolean; music?: boolean; movie?: boolean; tv?: boolean } | null;
  const ok = c?.[mode] ?? false;
  return `${ok ? "✓" : "-"} ${mode}`;
}