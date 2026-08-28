/**
 * Command dispatch: maps the parsed subcommand to its implementation.
 */
import { APP_NAME, VERSION } from "../version.js";
import type { CliContext } from "./context.js";
import { USAGE } from "./help.js";
import { runAdd } from "./commands/add.js";
import { runAddons } from "./commands/addons.js";
import { runClear, runUninstall } from "./commands/clear.js";
import { runConfig } from "./commands/config.js";
import { runDoctorCommand } from "./commands/doctor.js";
import { runDownloads } from "./commands/downloads.js";
import { runFiles } from "./commands/files.js";
import { runHistory } from "./commands/history.js";
import { runSearch } from "./commands/search.js";
import { runSources } from "./commands/sources.js";
import { runWatch } from "./commands/watch.js";
import { runTv } from "./commands/tv.js";
import { runTui } from "../ui/run.js";

export async function dispatch(ctx: CliContext): Promise<number> {
  const cmd = ctx.args.command;
  const positional = ctx.args.positional;
  switch (cmd) {
    case null:
    case "tui":
      if (ctx.args.clear) return runClear(ctx);
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
    case "tv":
      return runTv(ctx, positional);
    case "addons":
      return runAddons(ctx, positional);
    case "sources":
      return runSources(ctx);
    case "doctor":
      return runDoctorCommand(ctx);
    case "files":
      return runFiles(ctx, positional[0] ?? "");
    case "history":
      return runHistory(ctx);
    case "clear":
      return runClear(ctx);
    case "uninstall":
      return runUninstall(ctx);
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
