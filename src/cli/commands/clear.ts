/**
 * `tornedo --clear` / `tornedo clear` and `tornedo uninstall [--clear]` —
 * destructive clean-uninstall helpers.
 *
 * `clear` deletes every downloaded file tracked by Tornedo and wipes the local
 * state (database, config, watch state), leaving a clean slate for people who
 * want a clean uninstall. `uninstall` additionally removes the global tornedo
 * package via whichever package manager (npm, pnpm, yarn, bun) it was run from.
 */
import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import { stateRoot } from "../../config/paths.js";
import type { CliContext } from "../context.js";

export interface WipeReport {
  downloadsDeleted: number;
  stateWiped: boolean;
  stateDir: string;
}

export async function runClear(ctx: CliContext): Promise<number> {
  const confirmed = await confirmYes(
    ctx,
    "Delete every downloaded file and wipe all tornedo state (database, config, history)?",
  );
  if (!confirmed) {
    ctx.err("Cancelled. Nothing was deleted.");
    return 1;
  }
  const report = await wipeAll(ctx);
  if (ctx.args.json) {
    ctx.jsonOut(report);
  } else {
    ctx.log(`Deleted ${report.downloadsDeleted} download${report.downloadsDeleted === 1 ? "" : "s"} and wiped local state.`);
    ctx.log(`State directory removed: ${report.stateDir}`);
    ctx.log("Tornedo is ready for a clean uninstall (or a fresh start).");
  }
  return 0;
}

export async function runUninstall(ctx: CliContext): Promise<number> {
  const clearText = ctx.args.clear
    ? " delete every downloaded file and wipe all tornedo state, then"
    : "";
  const pm = detectPackageManager();
  const confirmed = await confirmYes(ctx, `Uninstall tornedo? This will${clearText} remove the global package via ${pm}.`);
  if (!confirmed) {
    ctx.err("Cancelled.");
    return 1;
  }

  let report: WipeReport | null = null;
  if (ctx.args.clear) {
    report = await wipeAll(ctx);
  } else {
    // Close the database cleanly (clears the crash marker) before uninstalling.
    await ctx.app.suspend();
  }

  if (ctx.args.json) {
    ctx.jsonOut({
      uninstalling: "tornedo",
      ...(report ? { cleared: report } : {}),
    });
  } else {
    ctx.log(report
      ? `Cleared ${report.downloadsDeleted} downloads and wiped state.`
      : "Proceeding without clearing local state.");
    ctx.log(`Running: ${pm} ${uninstallArgs(pm).join(" ")}`);
  }

  const code = await uninstallPackage(ctx);
  if (code !== 0) {
    ctx.err(`${pm} uninstall failed (exit ${code}). You can retry manually with: ${pm} ${uninstallArgs(pm).join(" ")}`);
    return code;
  }
  if (!ctx.args.json) {
    ctx.log("Tornedo has been uninstalled. Goodbye!");
  }
  return 0;
}

/**
 * Remove every torrent (deleting its downloaded files) and wipe the entire
 * state directory. The application is suspended first so the SQLite database
 * can be removed even on Windows.
 */
export async function wipeAll(ctx: CliContext): Promise<WipeReport> {
  const items = ctx.app.manager.list();
  for (const item of items) {
    await ctx.app.manager.remove(item.id, { deleteFiles: true });
  }
  await ctx.app.suspend();
  const root = stateRoot();
  await fs.rm(root, { recursive: true, force: true });
  return {
    downloadsDeleted: items.length,
    stateWiped: true,
    stateDir: root,
  };
}

/** Best-effort wipe of the state directory when the application cannot start. */
export async function wipeStateDir(): Promise<void> {
  const root = stateRoot();
  await fs.rm(root, { recursive: true, force: true });
}

type PkgManager = "npm" | "pnpm" | "yarn" | "bun";

function detectPackageManager(): PkgManager {
  const agent = (process.env.npm_config_user_agent ?? "").toLowerCase();
  if (agent.startsWith("pnpm/")) return "pnpm";
  if (agent.startsWith("yarn/")) return "yarn";
  if (agent.startsWith("bun/")) return "bun";
  return "npm";
}

function uninstallArgs(pm: PkgManager): string[] {
  switch (pm) {
    case "yarn":
      return ["global", "remove", "tornedo"];
    case "pnpm":
    case "bun":
    case "npm":
    default:
      return ["uninstall", "-g", "tornedo"];
  }
}

function uninstallPackage(ctx: CliContext): Promise<number> {
  const pm = detectPackageManager();
  return new Promise((resolve) => {
    const child = spawn(pm, uninstallArgs(pm), {
      stdio: ["ignore", "inherit", "inherit"],
      shell: process.platform === "win32",
    });
    child.on("error", (e) => {
      ctx.err(`could not start ${pm}: ${e.message}`);
      resolve(1);
    });
    child.on("close", (code) => resolve(code ?? 0));
  });
}

function confirmYes(ctx: CliContext, prompt: string): Promise<boolean> {
  if (ctx.args.yes) return Promise.resolve(true);
  if (process.stdin.isTTY) {
    ctx.err(`${prompt} [y/N] `);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");
    return new Promise((resolve) => {
      const onData = (chunk: string): void => {
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        const value = chunk.trim().toLowerCase();
        resolve(value === "y" || value === "yes");
      };
      process.stdin.on("data", onData);
    });
  }
  ctx.err("Run with --yes to confirm non-interactively.");
  return Promise.resolve(false);
}