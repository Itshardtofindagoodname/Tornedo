/**
 * `tornedo watch <dir>` — watch a directory for .torrent / magnet files and add
 * them to the queue. Runs until interrupted.
 */
import path from "node:path";
import { WatchService } from "../../watch/watcher.js";
import type { CliContext } from "../context.js";
import { registerShutdownHook } from "../shutdown.js";

export async function runWatch(ctx: CliContext, dir?: string): Promise<number> {
  const cfg = ctx.app.getConfig();
  const resolved = path.resolve(dir ?? cfg.downloadDir);

  const watcher = new WatchService({
    store: ctx.app.store,
    intervalMs: cfg.watchIntervalMs,
    onAdd: (add) => {
      const cfg2 = ctx.app.getConfig();
      const item = ctx.app.manager.add({
        infohash: add.infoHash,
        magnet: add.magnet,
        name: add.name,
        destination: cfg2.downloadDir,
        seedEnabled: cfg2.seedAfterComplete,
      });
      if (ctx.args.json) {
        ctx.jsonOut({ status: "added", infohash: add.infoHash, name: add.name, queued: item.status });
      } else {
        ctx.log(`Found ${add.kind}: ${add.name} (${add.infoHash.slice(0, 8)}…) -> queued`);
      }
    },
    onError: (message) => ctx.err(`watch: ${message}`),
  });

  watcher.watch(resolved);
  watcher.start();
  await watcher.scanOnce();
  registerShutdownHook(() => watcher.dispose());

  ctx.log(`Watching ${resolved}`);
  ctx.log("Press Ctrl+C to stop.");
  // The process-level signal handler keeps this alive; this never resolves.
  return new Promise<number>(() => {});
}