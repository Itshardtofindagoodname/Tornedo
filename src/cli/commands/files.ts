/**
 * `tornedo files <input>` - list the files inside a torrent before downloading.
 *
 * A `.torrent` file is parsed directly (no network). A magnet URI or bare
 * infohash is resolved through the engine - the torrent is added fully
 * deselected (nothing downloads) and left paused in the queue once the file
 * list is known, so the user can decide what to download.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { TorrentFileInfo, TorrentItem } from "../../model/torrent.js";
import { parseInput, parseTorrentBuffer } from "../../torrent/parse.js";
import { formatBytes } from "../../utils/bytes.js";
import type { CliContext } from "../context.js";

const FILE_POLL_MS = 500;
const FILE_TIMEOUT_MS = 120_000;

export async function runFiles(ctx: CliContext, input: string): Promise<number> {
  if (!input) throw new Error('files requires an argument: tornedo files <path|magnet|infohash>');

  // `.torrent` files parse directly - no engine or queue involved.
  const fromFile = await tryParseTorrentFile(input);
  if (fromFile) {
    printFileList(ctx, { name: fromFile.name, files: fromFile.files });
    return fromFile.files.length;
  }

  const parsed = parseInput(input);
  if (!parsed) {
    throw new Error("Could not parse input (expected a .torrent path, magnet URI, or infohash)");
  }

  const cfg = ctx.app.getConfig();
  const item = ctx.app.manager.add({
    infohash: parsed.infoHash,
    magnet: parsed.magnet,
    name: parsed.name,
    destination: ctx.args.dir ?? cfg.downloadDir,
    seedEnabled: false,
    // Nothing downloads while the user inspects the file list.
    startDeselected: true,
  });

  const current = await waitForFileList(ctx, item);
  printFileList(ctx, { name: current.name, files: current.fileList ?? [] });

  if (!ctx.args.json) {
    ctx.log("\nThis torrent was left paused in the queue - nothing has downloaded.");
    ctx.log("Resume it (with `tornedo magnet <uri> --select <paths>` or the TUI) or remove it from `tornedo downloads`.");
  }
  return current.fileList?.length ?? 0;
}

interface FileListResult {
  name: string;
  files: TorrentFileInfo[];
}

async function tryParseTorrentFile(input: string): Promise<FileListResult | null> {
  let data: Uint8Array;
  try {
    data = await fs.readFile(path.resolve(input));
  } catch {
    return null;
  }
  const info = await parseTorrentBuffer(data);
  if (!info) return null;
  return {
    name: info.name,
    files: info.files.map((f) => ({ path: f.path || f.name, length: f.length })),
  };
}

function waitForFileList(ctx: CliContext, item: TorrentItem): Promise<TorrentItem> {
  return new Promise((resolve, reject) => {
    const id = item.id;
    const started = Date.now();
    const check = (): void => {
      const current = ctx.app.manager.get(id);
      if (!current) {
        reject(new Error("the torrent was removed while resolving metadata"));
        return;
      }
      if (current.fileList) {
        clearInterval(timer);
        resolve(current);
        return;
      }
      if (current.status === "error") {
        clearInterval(timer);
        reject(new Error(current.error ?? "failed to resolve torrent metadata"));
        return;
      }
      if (Date.now() - started > FILE_TIMEOUT_MS) {
        clearInterval(timer);
        reject(new Error("timed out while resolving torrent metadata (check trackers/DHT)"));
      }
    };
    const timer = setInterval(check, FILE_POLL_MS);
    check();
  });
}

function printFileList(ctx: CliContext, result: FileListResult): void {
  const files = result.files;
  const total = files.reduce((sum, f) => sum + (f.length || 0), 0);
  if (ctx.args.json) {
    ctx.jsonOut({ name: result.name, size: total, files });
    return;
  }
  ctx.log(`${result.name}`);
  ctx.log(`${files.length} file${files.length === 1 ? "" : "s"} | ${formatBytes(total)}\n`);
  if (files.length === 0) {
    ctx.log("  (no file listing available)");
    return;
  }
  const index = String(files.length).length;
  files.forEach((f, i) => {
    ctx.log(`  ${String(i + 1).padStart(index)}. ${f.path.padEnd(64)} ${formatBytes(f.length)}`);
  });
  ctx.log("\nDownload only some of these with:");
  ctx.log(`  tornedo file <torrent> --select "${files.map((f) => f.path).join(",")}"`);
}