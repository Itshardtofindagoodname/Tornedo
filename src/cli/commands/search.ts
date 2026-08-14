/**
 * `tornedo search <query>` — federated search with live source status and a
 * ranked, de-duplicated, grouped result set.
 */
import type { CliContext } from "../context.js";
import { searchToJson, renderSearchTable, type SourceReport } from "../render.js";

export async function runSearch(ctx: CliContext, query: string): Promise<number> {
  if (!query.trim()) {
    throw new Error("search requires a query: tornedo search \"<query>\"");
  }
  const session = ctx.app.searchService.createSession(
    query,
    ctx.args.sources.length > 0 ? ctx.args.sources : undefined,
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

function statusLine(sourceId: string, report: SourceReport): string {
  const name = sourceId;
  if (report.status === "ok") {
    return `${name.padEnd(14)} ✓ ${report.results} results`;
  }
  if (report.status === "pending") {
    return `${name.padEnd(14)} … searching`;
  }
  return `${name.padEnd(14)} ✗ ${report.failure?.message ?? "error"}`;
}