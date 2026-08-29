/**
 * `tornedo downloads` - list the download queue / active torrents.
 */
import type { CliContext } from "../context.js";
import { renderDownloadsTable, torrentToJson } from "../render.js";

export async function runDownloads(ctx: CliContext): Promise<number> {
  const items = ctx.app.manager.list();
  if (ctx.args.json) {
    ctx.jsonOut(items.map(torrentToJson));
    return items.length;
  }
  const summary = ctx.app.manager.summary();
  ctx.log(
    `active:${summary.active} queued:${summary.queued} paused:${summary.paused} ` +
      `seeding:${summary.seeding} completed:${summary.completed} errors:${summary.error}`,
  );
  ctx.log("");
  if (items.length === 0) {
    ctx.log("No downloads yet. Search something and press d, or run: tornedo magnet <uri>");
    return 0;
  }
  ctx.log(renderDownloadsTable(items));
  return items.length;
}