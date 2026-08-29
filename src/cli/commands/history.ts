/**
 * `tornedo history` / `tornedo history --clear` - recent search history.
 */
import type { CliContext } from "../context.js";

export async function runHistory(ctx: CliContext): Promise<number> {
  if (ctx.args.clear) {
    ctx.app.clearRecentSearches();
    if (ctx.args.json) {
      ctx.jsonOut({ cleared: true, history: [] });
    } else {
      ctx.log("Search history cleared.");
    }
    return 0;
  }

  const history = ctx.app.recentSearches();
  if (ctx.args.json) {
    ctx.jsonOut(history);
    return history.length;
  }
  if (history.length === 0) {
    ctx.log("No search history yet.");
    return 0;
  }
  ctx.log(`Recent searches (${history.length}):`);
  history.forEach((q, i) => ctx.log(`  ${i + 1}. ${q}`));
  ctx.log("\nClear it with: tornedo history --clear");
  return history.length;
}