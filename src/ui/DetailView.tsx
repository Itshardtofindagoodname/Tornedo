/**
 * Result inspector: a focused view of one search result, opened with enter from
 * the results list. Everything shown comes from the real release (parsed
 * metadata, swarm counts, sources, magnet).
 *
 * File selection lives here as a DEFAULT part of the view (no separate
 * keybind): as soon as the release is opened, its torrent metadata is resolved
 * and the real file list is shown as a checkbox list. The user toggles
 * individual files with space and commits with enter/d — only the selected
 * files are downloaded. Until metadata is resolved the section shows a live
 * "resolving" state; a direct-download source simply has no file list.
 */
import { Box, Text, useWindowSize } from "ink";
import type { Application } from "../app/application.js";
import type { KeyAction } from "../config/config.js";
import type { Release } from "../model/search.js";
import type { TorrentFileInfo, TorrentItem } from "../model/torrent.js";
import { formatAudio } from "../media/audio.js";
import { formatBytes } from "../utils/bytes.js";
import { formatDate, truncate } from "../utils/duration.js";
import { categoryColor, categoryTag } from "./format.js";
import { KeyValue, Separator, Spinner } from "./components.js";
import { firstKey } from "./keys.js";
import { palette } from "./theme.js";
import { scrollWindow } from "./text.js";

export interface DetailViewProps {
  app: Application;
  release: Release;
  /** The manager item created to resolve this release's files (null for direct-download sources). */
  fileItem: TorrentItem | null;
  /** Currently selected (checked) file paths. */
  fileChecks: ReadonlySet<string>;
  fileCursor: number;
  tick: number;
  onToggleFile: (path: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}

export function DetailView({
  app,
  release,
  fileItem,
  fileChecks,
  fileCursor,
  tick,
  onToggleFile,
  onSelectAll,
  onSelectNone,
}: DetailViewProps): React.ReactNode {
  const md = release.metadata;
  const sourceNames = new Map(app.sources.map((s) => [s.id, s.name]));
  const sources = release.sources.map((s) => sourceNames.get(s) ?? s).join(", ");
  const audio = formatAudio(md.audio);
  const bindings = app.getConfig().keybindings;
  const fk = (action: KeyAction, fallback: string): string => firstKey(bindings, action, fallback);

  const files = fileItem?.fileList ?? [];
  const resolving = fileItem !== null && files.length === 0 && fileItem.status !== "error";
  const failed = fileItem !== null && files.length === 0 && fileItem.status === "error";

  const spec = [
    md.quality,
    md.resolution,
    md.codec,
    md.container,
    md.source,
    md.group,
    audio,
  ]
    .filter(Boolean)
    .join(" · ");

  const tags: string[] = [];
  if (md.year) tags.push(`${md.year}`);
  if (md.season) tags.push(`S${String(md.season).padStart(2, "0")}`);
  if (md.episode) tags.push(`E${String(md.episode).padStart(2, "0")}`);
  if (md.episodeRange) tags.push(`episodes ${md.episodeRange}`);
  if (md.languages?.length) tags.push(md.languages.join("/"));
  if (md.subtitles?.length) tags.push(`subs ${md.subtitles.join("/")}`);
  if (md.edition?.length) tags.push(md.edition.join(", "));
  if (md.hdr) tags.push("HDR");
  if (md.is3d) tags.push("3D");
  if (md.game?.platform) tags.push(md.game.platform);
  if (md.game?.version) tags.push(md.game.version);
  if (md.artist) tags.push(`by ${md.artist}`);
  if (md.album) tags.push(`album ${md.album}`);
  if (md.track) tags.push(`track ${md.track}`);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={1}>
      <Text color={palette.dim}>← search results</Text>

      <Box marginTop={1}>
        <Text bold color={palette.text}>
          {release.title}
        </Text>
      </Box>
      <Box marginTop={1}>
        <Separator />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.accentBright} bold>
          {release.size && release.size > 0 ? formatBytes(release.size) : "size unknown"}
        </Text>
        <Box height={1}>
          <Text color={palette.subtext}>
            {release.seeders ?? "–"} seeds · {release.leechers ?? "–"} peers · {release.files ?? "–"} files
          </Text>
        </Box>
        <Box height={1}>
          <Text color={palette.subtext}>
            {release.sources.length} source{release.sources.length === 1 ? "" : "s"}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Separator />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {spec ? (
          <KeyValue label="specs" value={truncate(spec, 120)} valueColor={palette.text} />
        ) : null}
        {tags.length > 0 ? (
          <KeyValue label="tags" value={truncate(tags.join("  ·  "), 120)} valueColor={palette.text} />
        ) : null}
        {release.category ? (
          <KeyValue
            label="category"
            value={
              <Text color={categoryColor(release.category)}>
                {categoryTag(release.category).trim()} {release.category}
              </Text>
            }
            valueColor={palette.text}
          />
        ) : null}
        <KeyValue label="sources" value={truncate(sources, 120)} valueColor={palette.text} />
        <KeyValue label="infohash" value={truncate(release.infohash, 24)} valueColor={palette.dim} />
        <KeyValue label="magnet" value={truncate(release.magnet, 120)} valueColor={palette.dim} />
        {release.added ? (
          <KeyValue label="added" value={formatDate(release.added)} valueColor={palette.subtext} />
        ) : null}
      </Box>

      <Box marginTop={1}>
        <Separator />
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.faint}>files</Text>
        {fileItem === null ? (
          <Box height={1} marginTop={1}>
            <Text color={palette.faint} wrap="truncate">
              {release.files ?? "?"} file{release.files === 1 ? "" : "s"} — a direct-download source has no torrent file list.
            </Text>
          </Box>
        ) : failed ? (
          <Box height={1} marginTop={1}>
            <Text color={palette.red} wrap="truncate">
              ⚠ could not resolve files: {truncate(fileItem.error ?? "unknown error", 100)}
            </Text>
          </Box>
        ) : resolving ? (
          <Box height={1} marginTop={1}>
            <Text color={palette.dim}>
              <Spinner tick={tick} /> resolving file list — nothing will download until you commit.
            </Text>
          </Box>
        ) : (
          <FileRows
            files={files}
            checks={fileChecks}
            cursor={fileCursor}
            onToggleFile={onToggleFile}
            onSelectAll={onSelectAll}
            onSelectNone={onSelectNone}
          />
        )}
      </Box>

      <Box flexGrow={1} />

      <Box marginBottom={1}>
        <Text color={palette.dim}>
          <Text color={palette.accent} bold>{fk("confirm", "enter")}</Text> download{files.length > 0 ? " selected files" : ""}
          {"  "}
          <Text color={palette.accent} bold>{fk("download", "d")}</Text> download
          {"  "}
          <Text color={palette.accent} bold>{fk("downloadTo", "D")}</Text> download to…
          {"  "}
          <Text color={palette.accent} bold>{fk("copyMagnet", "y")}</Text> copy magnet
          {"  "}
          <Text color={palette.accent} bold>{fk("openMagnet", "o")}</Text> open magnet
          {"  "}
          <Text color={palette.accent} bold>esc</Text> back
        </Text>
      </Box>
    </Box>
  );
}

/**
 * Checkbox list of the torrent's files. Scrolls a window around the cursor so
 * long lists fit the terminal. App owns the cursor/selection state and the keys.
 */
function FileRows({
  files,
  checks,
  cursor,
  onToggleFile,
  onSelectAll,
  onSelectNone,
}: {
  files: readonly TorrentFileInfo[];
  checks: ReadonlySet<string>;
  cursor: number;
  onToggleFile: (path: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}): React.ReactNode {
  const { rows } = useWindowSize();
  const maxRows = Math.max(3, Math.min(12, rows - 22));
  const clamped = Math.min(Math.max(0, cursor), Math.max(0, files.length - 1));
  const { start, count } = scrollWindow(clamped, maxRows, files.length);
  const visible = files.slice(start, start + count);
  const total = files.reduce((sum, f) => sum + (f.length || 0), 0);
  return (
    <Box flexDirection="column" width="100%">
      <Text color={palette.dim}>
        {files.length} file{files.length === 1 ? "" : "s"} · {formatBytes(total)} · {checks.size} selected
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visible.map((f, i) => {
          const idx = start + i;
          const isCursor = idx === clamped;
          const checked = checks.has(f.path);
          return (
            <Box key={f.path} height={1} backgroundColor={isCursor ? palette.accent : undefined} paddingX={1}>
              <Text color={isCursor ? palette.bg : palette.subtext} wrap="truncate">
                {isCursor ? "»" : " "} [{checked ? "x" : " "}] {f.path}
              </Text>
              <Text color={isCursor ? palette.bg : palette.faint}>
                {" "} {formatBytes(f.length)}
              </Text>
            </Box>
          );
        })}
      </Box>
      {files.length > maxRows ? (
        <Box marginTop={1}>
          <Text color={palette.faint}>↑↓ scroll · {start + 1}–{Math.min(start + count, files.length)} of {files.length}</Text>
        </Box>
      ) : null}
      <Box height={1} marginTop={1}>
        <Text color={palette.faint}>space toggle · a all · n none · ↑↓ move · enter/d download</Text>
      </Box>
    </Box>
  );
}