/**
 * Command dispatch: maps the parsed subcommand to its implementation.
 */
import { APP_NAME, VERSION } from "../version.js";
import type { CliContext } from "./context.js";
import { USAGE } from "./help.js";
import { runAdd } from "./commands/add.js";
import { runConfig } from "./commands/config.js";
import { runDownloads } from "./commands/downloads.js";
import { runSearch } from "./commands/search.js";
import { runSources } from "./commands/sources.js";
import { runWatch } from "./commands/watch.js";
import { runTui } from "../ui/run.js";

export async function dispatch(ctx: CliContext): Promise<number> {
  const cmd = ctx.args.command;
  const positional = ctx.args.positional;
  switch (cmd) {
    case null:
    case "tui":
      return runTui(ctx);
    case "search":
      return runSearch(ctx, positional[0] ?? "");
    case "downloads":
      return runDownloads(ctx);
    case "config":
      return runConfig(ctx, positional);
    case "magnet":
    case "infohash":
    case "file":
      return runAdd(ctx, cmd, positional[0] ?? "");
    case "watch":
      return runWatch(ctx, positional[0]);
    case "sources":
      return runSources(ctx);
    case "help":
      ctx.stdout(USAGE);
      return 0;
    case "version":
      ctx.stdout(`${APP_NAME} ${VERSION}`);
      return 0;
    default:
      ctx.err(`Unknown command: ${cmd as string}`);
      ctx.stdout(USAGE);
      return 1;
  }
}
