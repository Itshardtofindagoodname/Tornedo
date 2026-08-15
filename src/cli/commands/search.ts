/**
 * `tornedo search <query>` — federated search with live source status and a
 * ranked, de-duplicated, grouped result set.
 */
import type { CliContext } from "../context.js";
import { searchToJson, renderSearchTable, type SourceReport } from "../render.js";
import { MEDIA_CATEGORIES, type MediaCategory } from "../../model/search.js";

const HEALTH_GLYPH: Record<SourceReport["health"], string> = {
  healthy: "●",
  working: "◐",
  idle: "◌",
  degraded: "⚠",
  failed: "✕",
  unsupported: "—",
};

export async function runSearch(ctx: CliContext, query: string): Promise<number> {
  if (!query.trim()) {
    throw new Error("search requires a query: tornedo search \"<query>\"");
  }
  const category = parseCategory(ctx.args.category);
  const session = ctx.app.searchService.createSession(
    query,
    ctx.args.sources.length > 0 ? ctx.args.sources : undefined,
    category,
  );
  const printed = new Set<string>();

  const off = session.onChange(() => {
    for (const [sourceId, report] of session.sourceReports()) {
      if (printed.has(sourceId)) continue;
      printed.add(sourceId);
      ctx.log(statusLine(sourceId, report));
    }
  });

  session.start();
  await session.waitForDone();
  off();

  const reports: Record<string, SourceReport> = {};
  for (const [sourceId, report] of session.sourceReports()) reports[sourceId] = report;
  const summary = session.summary() ?? {
    totalResults: 0,
    sourcesSucceeded: 0,
    sourcesFailed: 0,
    elapsedMs: 0,
  };

  if (ctx.args.json) {
    ctx.jsonOut(searchToJson(query, session.releases(), reports, summary));
  } else {
    ctx.log(`\n${session.releases().length} unique releases from ${summary.sourcesSucceeded} sources in ${summary.elapsedMs}ms`);
    const table = renderSearchTable(session.releases(), { limit: ctx.args.limit ?? 30 });
    ctx.log(table);
  }
  return session.releases().length;
}

function parseCategory(raw: string | null): MediaCategory | undefined {
  if (!raw) return undefined;
  const match = MEDIA_CATEGORIES.find((c) => c.toLowerCase() === raw.toLowerCase());
  if (!match) {
    throw new Error(`Unknown category "${raw}". Valid categories: ${MEDIA_CATEGORIES.join(", ")}`);
  }
  return match;
}

function statusLine(sourceId: string, report: SourceReport): string {
  const name = sourceId.padEnd(16);
  const glyph = HEALTH_GLYPH[report.health] ?? "◌";
  if (report.status === "ok") {
    return `${name} ${glyph} ${report.results} results`;
  }
  if (report.status === "pending") {
    return `${name} ${glyph} searching`;
  }
  const detail =
    report.failure?.kind === "unsupported"
      ? "unsupported category"
      : report.failure?.message ?? "error";
  return `${name} ${glyph} ${detail}`;
}