/**
 * Downloads view: manager summary strip plus a scrollable list of torrents with
 * live progress, speeds and ETA. Presentational — App owns all input.
 */
import { useRef } from "react";
import { Box, Text, useBoxMetrics, type DOMElement } from "ink";
import type { Application } from "../app/application.js";
import type { TorrentItem } from "../model/torrent.js";
import { formatBytes, formatRate } from "../utils/bytes.js";
import { formatDuration } from "../utils/duration.js";
import { ProgressBar } from "./components.js";
import { statusColor, statusGlyph } from "./format.js";
import { palette } from "./theme.js";
import { scrollWindow } from "./text.js";

export interface DownloadsViewProps {
  app: Application;
  selected: number;
}

export function DownloadsView({ app, selected }: DownloadsViewProps): React.ReactNode {
  const items = app.manager.list();
  const summary = app.manager.summary();
  const len = items.length;
  const sel = Math.min(selected, Math.max(0, len - 1));

  const listRef = useRef<DOMElement | null>(null);
  const metrics = useBoxMetrics(listRef);
  const rows = Math.max(1, metrics.height);
  const { start, count } = scrollWindow(sel, rows, len);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box height={1} paddingLeft={1}>
        <Text bold color={palette.text}>
          Downloads
        </Text>
        <Text dimColor>
          {"  ·  "}active {summary.active} · queued {summary.queued} · paused {summary.paused} · seeding{" "}
          {summary.seeding} · completed {summary.completed}
          {summary.error > 0 ? <Text color={palette.red}> · errors {summary.error}</Text> : null}
        </Text>
        {summary.totalDownloadSpeed > 0 ? (
          <Text color={palette.cyan}>  ↓ {formatRate(summary.totalDownloadSpeed)}</Text>
        ) : null}
        {summary.totalUploadSpeed > 0 ? (
          <Text color={palette.teal}>  ↑ {formatRate(summary.totalUploadSpeed)}</Text>
        ) : null}
      </Box>

      <Box ref={listRef} flexGrow={1} flexDirection="column" overflow="hidden">
        {len === 0 ? (
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Text dimColor>No downloads yet — search something and press enter to queue it.</Text>
          </Box>
        ) : (
          items.slice(start, start + count).map((it, i) => {
            const idx = start + i;
            return <DownloadRow key={it.id} item={it} selected={idx === sel} />;
          })
        )}
      </Box>
    </Box>
  );
}

function DownloadRow({ item, selected }: { item: TorrentItem; selected: boolean }): React.ReactNode {
  const color = statusColor(item.status);
  const pct = Math.round(item.progress * 100);
  const speed = item.downloadSpeed > 0 ? formatRate(item.downloadSpeed) : "–";
  const eta =
    Number.isFinite(item.timeRemaining) && item.timeRemaining >= 0
      ? formatDuration(item.timeRemaining)
      : "–";
  const size = `${formatBytes(item.downloaded)}/${formatBytes(item.size)}`;
  const peers = `${item.peers}/${item.seeds}`;

  return (
    <Box
      height={1}
      width="100%"
      backgroundColor={selected ? palette.accent : undefined}
      paddingLeft={1}
    >
      <Box width={2}>
        <Text color={selected ? palette.bg : color}>{selected ? "❯" : statusGlyph(item.status)}</Text>
      </Box>
      <Box flexGrow={1} paddingRight={1}>
        <Text wrap="truncate" color={selected ? palette.bg : palette.text}>
          {item.name}
        </Text>
      </Box>
      <Box width={10}>
        <ProgressBar
          progress={item.progress}
          width={10}
          color={selected ? palette.bg : color}
        />
      </Box>
      <Box width={5}>
        <Text color={selected ? palette.bg : palette.subtext}>{pct}%</Text>
      </Box>
      <Box width={15}>
        <Text color={selected ? palette.bg : palette.subtext} wrap="truncate">
          {size}
        </Text>
      </Box>
      <Box width={10}>
        <Text color={selected ? palette.bg : palette.cyan}>{speed}</Text>
      </Box>
      <Box width={9}>
        <Text color={selected ? palette.bg : palette.dim}>{eta}</Text>
      </Box>
      <Box width={7}>
        <Text color={selected ? palette.bg : palette.dim}>{peers}</Text>
      </Box>
      <Box width={1} />
    </Box>
  );
}