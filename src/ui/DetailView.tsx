/**
 * Result inspector: a focused view of one search result, opened with enter from
 * the results list. Everything shown comes from the real release (parsed
 * metadata, swarm counts, sources, magnet).
 *
 * File selection lives in the RIGHT-HAND panel as a DEFAULT part of the view
 * (no separate keybind): as soon as the release is opened, its torrent metadata
 * is resolved and the file list is shown as a checkbox panel — every file
 * checked by default. The panel lists all files at once when they fit and
 * scrolls to keep the highlighted file in view. `d` (or space) toggles the
 * highlighted file; `enter` is the single download key and commits the
 * selection. Until metadata is resolved the panel shows a live "resolving"
 * state; a direct-download source simply has no file list.
 */
import { useRef } from "react";
import { Box, Text, useBoxMetrics, useWindowSize, type DOMElement } from "ink";
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
  const { columns } = useWindowSize();
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

  const filePanelWidth = Math.max(36, Math.floor((columns || 80) * 0.46));
  const panelRef = useRef<DOMElement | null>(null);
  const panelMetrics = useBoxMetrics(panelRef);

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

      <Box flexDirection="row" flexGrow={1} marginTop={1}>
        <Box flexDirection="column" flexGrow={1} paddingRight={2}>
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
        </Box>

        <Box ref={panelRef} flexDirection="column" width={filePanelWidth} paddingLeft={1} overflow="hidden">
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
              rowSlots={Math.max(1, Math.min(files.length, (panelMetrics.height || 1) - 7))}
              onToggleFile={onToggleFile}
              onSelectAll={onSelectAll}
              onSelectNone={onSelectNone}
            />
          )}
        </Box>
      </Box>

      <Box marginBottom={1}>
        <Text color={palette.dim}>
          <Text color={palette.accent} bold>{fk("confirm", "enter")}</Text> download
          {"  "}
          <Text color={palette.accent} bold>{fk("download", "d")}</Text> toggle file
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
 * Checkbox list of the torrent's files, shown in the right-hand panel. Every
 * file is checked by default; the list fills the terminal (all files at once
 * when they fit) and scrolls a window around the cursor so the highlight is
 * never pushed off-screen. `d`/`space` toggle, `a` all, `n` none, `enter`
 * downloads.
 */
function FileRows({
  files,
  checks,
  cursor,
  rowSlots,
  onToggleFile,
  onSelectAll,
  onSelectNone,
}: {
  files: readonly TorrentFileInfo[];
  checks: ReadonlySet<string>;
  cursor: number;
  /** Number of file rows the panel can display. */
  rowSlots: number;
  onToggleFile: (path: string) => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
}): React.ReactNode {
  const clamped = Math.min(Math.max(0, cursor), Math.max(0, files.length - 1));
  // The panel height (measured from the rendered box) minus the chrome above
  // and below the rows: "files" header, count line, margins, scroll hint and
  // keybind hint. Keeping the rendered rows inside this budget stops rows from
  // overflowing the panel, which Ink mis-renders as overlapping lines.
  const rowCount = Math.max(1, Math.floor(rowSlots));
  const { start, count } = scrollWindow(clamped, rowCount, files.length);
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
                {isCursor ? "»" : " "} [{checked ? "✓" : " "}] {f.path}
              </Text>
              <Text color={isCursor ? palette.bg : palette.faint}>
                {" "} {formatBytes(f.length)}
              </Text>
            </Box>
          );
        })}
      </Box>
      {files.length > count ? (
        <Box height={1} marginTop={1}>
          <Text color={palette.faint}>↑↓ scroll · {start + 1}–{Math.min(start + count, files.length)} of {files.length}</Text>
        </Box>
      ) : null}
      <Box height={1} marginTop={1}>
        <Text color={palette.faint}>d/space toggle · a all · n none · ↑↓ move · enter download</Text>
      </Box>
    </Box>
  );
}