#!/usr/bin/env node
/**
 * Postinstall patch for webtorrent 2.8.x with uint8-util 2.x.
 *
 * webtorrent's Torrent calls `arr2hex(parsedTorrent.infoHash)` in two places
 * (lib/torrent.js `_onTorrentId` / `_processParsedTorrent`). parse-torrent
 * returns `infoHash` as a lowercase hex string, and since uint8-util 2.0
 * `arr2hex` only accepts typed arrays — it reads `data.buffer`, which is
 * undefined on a string, so Buffer.from throws ERR_INVALID_ARG_TYPE and the
 * process crashes on the very first add().
 *
 * The fix (already shipped on webtorrent master) is to feed the byte array
 * `parsedTorrent.infoHashBuffer` instead. This script applies that change
 * idempotently so it survives `npm install`.
 */
import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

let file;
try {
  file = require.resolve("webtorrent/lib/torrent.js");
} catch {
  console.log("patch-webtorrent: webtorrent not installed, nothing to patch");
  process.exit(0);
}

const FROM = "arr2hex(parsedTorrent.infoHash)";
const TO = "arr2hex(parsedTorrent.infoHashBuffer)";

const source = await readFile(file, "utf8");

if (source.includes(TO)) {
  console.log("patch-webtorrent: already patched");
  process.exit(0);
}

if (!source.includes(FROM)) {
  console.warn(
    "patch-webtorrent: expected pattern not found — webtorrent version may differ; skipping",
  );
  process.exit(0);
}

const patched = source.split(FROM).join(TO);
await writeFile(file, patched);
console.log(`patch-webtorrent: replaced ${FROM} -> ${TO}`);