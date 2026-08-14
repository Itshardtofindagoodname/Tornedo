#!/usr/bin/env node
/**
 * tornedo CLI entry point.
 */
import { Application } from "./app/application.js";
import { parseArgs, CliArgError } from "./cli/args.js";
import { dispatch } from "./cli/command.js";
import { CliContext } from "./cli/context.js";
import { USAGE } from "./cli/help.js";
import { runShutdownHooks } from "./cli/shutdown.js";
import { VERSION } from "./version.js";

async function main(): Promise<void> {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (e) {
    if (e instanceof CliArgError) {
      process.stderr.write(`${e.message}\n\n`);
      process.stderr.write(USAGE);
      process.exit(1);
    }
    throw e;
  }

  if (args.help) {
    process.stdout.write(USAGE);
    process.exit(0);
  }
  if (args.version) {
    process.stdout.write(`${VERSION}\n`);
    process.exit(0);
  }

  let app: Application;
  try {
    app = await Application.create();
  } catch (e) {
    process.stderr.write(`failed to start: ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
  const ctx = new CliContext(app, args);

  let shuttingDown = false;
  const shutdown = async (code: number): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    process.stderr.write("\nshutting down…\n");
    try {
      await app.suspend();
      await runShutdownHooks();
    } catch (e) {
      process.stderr.write(`error during shutdown: ${e instanceof Error ? e.message : String(e)}\n`);
    }
    process.exit(code);
  };
  const onSignal = (): void => {
    void shutdown(0);
  };
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  try {
    await dispatch(ctx);
    const code = typeof process.exitCode === "number" ? process.exitCode : 0;
    await shutdown(code);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    if (ctx.args.json) {
      process.stderr.write(`${JSON.stringify({ error: message })}\n`);
    } else {
      process.stderr.write(`error: ${message}\n`);
    }
    await shutdown(1);
  }
}

void main();