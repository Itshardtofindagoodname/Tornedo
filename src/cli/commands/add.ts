/**
 * `tornedo magnet <uri>` / `tornedo infohash <hash>` / `tornedo file <path>`
 * — add a torrent to the persistent queue and wait for it to complete unless
 * --no-wait is given.
 */
import { promises as fs } from "node:fs";
import path from "node:path";
import type { TorrentItem, TorrentStatus } from "../../model/torrent.js";
import { buildMagnet, parseInput, parseTorrentBuffer } from "../../torrent/parse.js";
import { formatBytes, formatPercent } from "../../utils/bytes.js";
import type { CliContext } from "../context.js";
import { torrentToJson } from "../render.js";

export async function runAdd(ctx: CliContext, command: string, input: string): Promise<number> {
  if (!input) throw new Error(`${command} requires an argument`);

  const parsed = await resolveInput(ctx, command, input);
  if (!parsed) throw new Error(`Could not parse ${command} input`);

  const cfg = ctx.app.getConfig();
  const selectedFiles = normalizeSelection(ctx, command, parsed);
  const item = ctx.app.manager.add({
    infohash: parsed.infoHash,
    magnet: parsed.magnet,
    name: parsed.name,
    category: parsed.category ?? null,
    sourceId: parsed.sourceId ?? null,
    destination: ctx.args.dir ?? cfg.downloadDir,
    seedEnabled: ctx.args.seed ?? cfg.seedAfterComplete,
    priority: ctx.args.priority ?? 0,
    selectedFiles,
  });

  if (ctx.args.json) {
    ctx.jsonOut({ status: "added", torrent: torrentToJson(item) });
  } else {
    ctx.log(`Added ${item.name}`);
    ctx.log(`  infohash   ${item.infohash}`);
    ctx.log(`  destination ${item.destination}`);
    ctx.log(`  seeding    ${item.seedEnabled ? "on" : "off"}`);
    if (selectedFiles && selectedFiles.length > 0) {
      ctx.log(`  files      ${selectedFiles.length} selected of ${item.files ?? "?"} (rest skipped)`);
    }
  }

  if (ctx.args.wait) {
    await waitForCompletion(ctx, item);
  }
  return 0;
}

interface ResolvedInput {
  infoHash: string;
  magnet: string;
  name: string;
  category?: string;
  sourceId?: string;
  /** File listing, available immediately for `.torrent` inputs. */
  files?: { path: string; length: number }[];
}

async function resolveInput(ctx: CliContext, command: string, input: string): Promise<ResolvedInput | null> {
  if (command === "magnet") {
    const parsed = parseInput(input);
    if (!parsed) return null;
    return { infoHash: parsed.infoHash, magnet: parsed.magnet, name: parsed.name };
  }
  if (command === "infohash") {
    const parsed = parseInput(input);
    if (!parsed) return null;
    return { infoHash: parsed.infoHash, magnet: parsed.magnet, name: parsed.name };
  }
  // command === "file"
  let data: Uint8Array;
  try {
    data = await fs.readFile(path.resolve(input));
  } catch {
    return null;
  }
  const info = await parseTorrentBuffer(data);
  if (!info) return null;
  return {
    infoHash: info.infoHash,
    magnet: buildMagnet(info.infoHash, info.name),
    name: info.name,
    files: info.files.map((f) => ({ path: f.path || f.name, length: f.length })),
  };
}

/**
 * Validate `--select` paths. For `.torrent` inputs the file list is known
 * immediately, so a selection that matches nothing is a hard error; for magnets
 * validation happens after metadata resolves (with a safe keep-everything
 * fallback in the engine).
 */
function normalizeSelection(ctx: CliContext, command: string, parsed: ResolvedInput): string[] | undefined {
  const select = ctx.args.select;
  if (select.length === 0) return undefined;
  if (command === "file" && parsed.files && parsed.files.length > 0) {
    const matched = parsed.files.filter((f) => select.includes(f.path));
    if (matched.length === 0) {
      throw new Error(
        `--select matched no files. Available files:\n${parsed.files.map((f) => `  ${f.path}`).join("\n")}`,
      );
    }
  }
  return select;
}

function waitForCompletion(ctx: CliContext, item: TorrentItem): Promise<void> {
  return new Promise((resolve) => {
    const id = item.id;
    let finished = false;

    const finish = (): void => {
      if (finished) return;
      finished = true;
      clearInterval(timer);
      ctx.app.manager.off("statusChanged", onStatus);
      ctx.app.manager.off("failed", onFailed);
      resolve();
    };

    const onStatus = (it: TorrentItem, _from: TorrentStatus, to: TorrentStatus): void => {
      if (it.id !== id) return;
      if (to === "completed" || to === "seeding") {
        const cur = ctx.app.manager.get(id);
        if (cur) {
          if (ctx.args.json) {
            ctx.jsonOut({ status: "completed", torrent: torrentToJson(cur) });
          } else {
            ctx.log(`\nDone: ${cur.name} (${formatBytes(cur.size)})`);
          }
        }
        finish();
      }
      if (to === "error") {
        const cur = ctx.app.manager.get(id);
        if (ctx.args.json && cur) {
          ctx.jsonOut({ status: "error", torrent: torrentToJson(cur) });
        }
        finish();
      }
    };
    const onFailed = (fid: string, message: string): void => {
      if (fid !== id) return;
      if (!ctx.args.json) ctx.err(`Failed: ${message}`);
      finish();
    };

    ctx.app.manager.on("statusChanged", onStatus);
    ctx.app.manager.on("failed", onFailed);

    const timer = setInterval(() => {
      const cur = ctx.app.manager.get(id);
      if (!cur || ctx.args.json) return;
      const speed = cur.downloadSpeed > 0 ? `${formatBytes(cur.downloadSpeed)}/s` : "0 B/s";
      process.stderr.write(
        `\r  ${formatPercent(cur.progress).padStart(5)} · ${formatBytes(cur.downloaded)}/${formatBytes(cur.size)} · ${speed}`,
      );
    }, 1000);
  });
}