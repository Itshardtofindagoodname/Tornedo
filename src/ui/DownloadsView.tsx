/**
 * Downloads view: manager summary strip plus a scrollable list of torrents with
 * live progress, speeds and ETA. Presentational — App owns all input.
 */
import { useRef } from "react";
import { Box, Text, useBoxMetrics, type DOMElement } from "ink";
import type { Application } from "../app/application.js";
import type { TorrentItem } from "../model/torrent.js";
import { metadataKnown } from "../model/torrent.js";
import { formatBytes, formatPercent, formatRate } from "../utils/bytes.js";
import { formatDuration } from "../utils/duration.js";
import { AnimatedProgress } from "./components.js";
import { statusColor, statusGlyph } from "./format.js";
import { palette } from "./theme.js";
import { scrollWindow } from "./text.js";

export interface DownloadsViewProps {
  app: Application;
  selected: number;
  diagnostics: boolean;
  tick: number;
}

export function DownloadsView({ app, selected, diagnostics, tick }: DownloadsViewProps): React.ReactNode {
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
            return <DownloadRow key={it.id} item={it} selected={idx === sel} tick={tick} />;
          })
        )}
      </Box>
      {diagnostics && items[sel] ? <DiagnosticsView item={items[sel]} /> : null}
    </Box>
  );
}

function DownloadRow({ item, selected, tick }: { item: TorrentItem; selected: boolean; tick: number }): React.ReactNode {
  const color = statusColor(item.status);
  // Metadata is not known yet: never present fake 0 B / 0 B or 0/0.
  const timedOut = item.diagnostics?.metadata === "timeout";
  const resolving = !metadataKnown(item) && !timedOut;
  const retries = (item.diagnostics?.metadataRetries ?? 0) > 0 ? ` (retry ${item.diagnostics!.metadataRetries})` : "";

  const speed = resolving || timedOut ? "--" : item.downloadSpeed > 0 ? formatRate(item.downloadSpeed) : "–";
  const eta = resolving || timedOut ? "--" : Number.isFinite(item.timeRemaining) && item.timeRemaining >= 0 ? formatDuration(item.timeRemaining) : "–";
  const pct = resolving || timedOut ? "--" : `${Math.round(item.progress * 100)}%`;
  const size = timedOut
    ? `METADATA TIMEOUT${retries}`
    : resolving
      ? item.sourceSize
        ? `src ${formatBytes(item.sourceSize)}`
        : "resolving..."
      : `${formatBytes(item.downloaded)}/${formatBytes(item.size)}`;
  const peers = resolving || timedOut ? "discov." : `${item.peers}/${item.seeds}`;

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
        <AnimatedProgress
          progress={resolving || timedOut ? 0 : item.progress}
          width={10}
          active={item.status === "downloading"}
          tick={tick}
          color={selected ? palette.bg : color}
        />
      </Box>
      <Box width={5}>
        <Text color={selected ? palette.bg : palette.subtext}>{pct}</Text>
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

function DiagnosticsView({ item }: { item: TorrentItem }): React.ReactNode {
  const d = item.diagnostics;
  const next = d?.nextRetry ? new Date(d.nextRetry).toLocaleTimeString() : "–";
  const last = d?.lastMetadataAttempt ? new Date(d.lastMetadataAttempt).toLocaleTimeString() : "–";
  const metaLabel =
    d?.metadata === "timeout"
      ? `timeout (retry ${d.metadataRetries ?? 0})`
      : d?.metadata === "received"
        ? "received"
        : "resolving...";
  const known = metadataKnown(item);
  const sourceSize = item.sourceSize !== undefined ? formatBytes(item.sourceSize) : "unknown";
  const torrentSize = item.torrentSize !== undefined ? formatBytes(item.torrentSize) : "resolving...";
  return (
    <Box flexDirection="column" borderStyle="single" borderColor={palette.dim} paddingX={1}>
      <Text bold color={palette.text}>Download diagnostics</Text>
      <Text color={palette.subtext}>Size: source {sourceSize} · torrent {torrentSize} · metadata {known ? "ready" : "resolving..."} · files {item.files ?? "unknown"}</Text>
      <Text color={palette.subtext}>Progress: {known ? formatPercent(item.progress) : "--"} · Speed: {known ? formatRate(item.downloadSpeed) : "--"} · Peers: {known ? `${item.peers} (${item.seeds} seeds)` : "discovering..."} · ETA: {known && Number.isFinite(item.timeRemaining) ? formatDuration(item.timeRemaining) : "--"}</Text>
      <Text color={palette.subtext}>Magnet valid: {d?.magnetValid ? "yes" : "no"} · Infohash valid: {d?.infohashPresent ? "yes" : "no"} · Name: {d?.displayName || item.name}</Text>
      <Text color={palette.subtext}>DHT: {d?.dht ?? "unknown"} · Socket: {d?.dhtListening ? "bound" : "not bound"} · Bootstrap: {d?.dhtBootstrapped ? "done" : "pending"} · UDP: {d?.dhtAddress ?? "–"}:{d?.dhtPort ?? "–"} ({d?.dhtFamily ?? "–"})</Text>
      <Text color={palette.subtext}>Routing: {d?.dhtRoutingTable ?? "unknown"} ({d?.dhtRoutingNodes ?? 0} nodes) · DHT queries: {d?.dhtQueries ?? 0} · responses: {d?.dhtResponses ?? 0}</Text>
      <Text color={palette.subtext}>Infohash peers discovered: {d?.peersDiscovered ?? 0} · Engine: {d?.engineState ?? "created"}</Text>
      <Text color={palette.subtext}>Infohash: {item.infohash} · Metadata: {metaLabel} · Requests: {d?.metadataRequests ?? 0} · Responses: {d?.metadataResponses ?? 0}</Text>
      <Text color={palette.subtext}>Trackers: {d?.trackerHealthy ?? 0}/{d?.trackerTotal ?? 0} healthy · Peers: {item.peers} ({d?.ipv4Peers ?? 0} IPv4, {d?.ipv6Peers ?? 0} IPv6) · Connection: {d?.connection ?? "idle"}</Text>
      <Text color={palette.subtext}>Last metadata attempt: {last} · Next retry: {next} · {d?.lastEvent ?? "no engine event yet"}</Text>
    </Box>
  );
}
