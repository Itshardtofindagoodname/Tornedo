/**
 * Downloads view: a summary strip plus a card-per-download list with a
 * human-readable state machine (resolving metadata → waiting for peers →
 * downloading → completed/seeding/failed). Diagnostics are an opt-in inspector
 * (`i`), never the default surface. Everything shown is real manager state.
 */
import { useRef } from "react";
import { Box, Text, useBoxMetrics, type DOMElement } from "ink";
import type { Application } from "../app/application.js";
import type { TorrentItem } from "../model/torrent.js";
import { formatBytes, formatRate } from "../utils/bytes.js";
import { formatDuration } from "../utils/duration.js";
import { ProgressBar, EmptyState, ErrorState, KeyValue, Spinner } from "./components.js";
import { stateColor, stateGlyph } from "./format.js";
import { palette } from "./theme.js";
import { downloadState, type DownloadUiState } from "./state.js";
import { scrollWindow } from "./text.js";

export interface DownloadsViewProps {
  app: Application;
  selected: number;
  diagnostics: boolean;
  tick: number;
  wide: boolean;
}

const CARD_LINES = 4;

export function DownloadsView({ app, selected, diagnostics, tick, wide }: DownloadsViewProps): React.ReactNode {
  const items = app.manager.list();
  const summary = app.manager.summary();
  const len = items.length;
  const sel = Math.min(selected, Math.max(0, len - 1));

  const listRef = useRef<DOMElement | null>(null);
  const metrics = useBoxMetrics(listRef);
  const rowSlots = Math.max(1, Math.floor(metrics.height / CARD_LINES));
  const { start, count } = scrollWindow(sel, rowSlots, len);

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
          <Text color={palette.accent}>  ↓ {formatRate(summary.totalDownloadSpeed)}</Text>
        ) : null}
        {summary.totalUploadSpeed > 0 ? (
          <Text color={palette.teal}>  ↑ {formatRate(summary.totalUploadSpeed)}</Text>
        ) : null}
      </Box>

      <Box ref={listRef} flexGrow={1} flexDirection="column" overflow="hidden">
        {len === 0 ? (
          <EmptyState message="No downloads yet." hint="search something and press enter to queue it" />
        ) : (
          items.slice(start, start + count).map((it, i) => {
            const idx = start + i;
            return <DownloadCard key={it.id} item={it} selected={idx === sel} tick={tick} wide={wide} />;
          })
        )}
      </Box>

      {diagnostics && items[sel] ? <DiagnosticsPanel item={items[sel]!} /> : null}
      {items[sel] && downloadState(items[sel]!).kind === "failed" ? <FailedPanel item={items[sel]!} /> : null}
    </Box>
  );
}

function DownloadCard({ item, selected, tick, wide }: { item: TorrentItem; selected: boolean; tick: number; wide: boolean }): React.ReactNode {
  const state = downloadState(item);
  const color = stateColor(state);
  const barColor = barTone(state, selected);
  const size = item.torrentSize ?? item.size ?? (item.sourceSize ?? 0);
  const sizeText = size > 0 ? formatBytes(size) : "size unknown";

  const progress = meaningfulProgress(state) ? item.progress : 0;
  const pct = meaningfulProgress(state) ? `${Math.round(item.progress * 100)}%` : "—";
  const subtitle = subtitleFor(item, state, sizeText);

  return (
    <Box flexDirection="column" width="100%">
      <Box height={1} width="100%" backgroundColor={selected ? palette.surfaceAlt : undefined} paddingLeft={1}>
        <Box width={2}>
          <Text color={selected ? palette.accent : color} bold={selected}>
            {selected ? "›" : stateGlyph(state)}
          </Text>
        </Box>
        <Box flexGrow={1} paddingRight={1}>
          <Text wrap="truncate" color={selected ? palette.text : palette.subtext} bold={selected}>
            {item.name}
          </Text>
        </Box>
        <Box paddingRight={2}>
          <Text color={selected ? palette.accent : color}>{stateLabel(state)}</Text>
        </Box>
      </Box>

      <Box height={1} paddingLeft={4}>
        <Text color={selected ? palette.dim : palette.faint} wrap="truncate">
          {subtitle}
        </Text>
      </Box>

      <Box height={1} paddingLeft={4}>
        <ProgressBar
          progress={progress}
          width={Math.min(44, Math.max(12, terminalBarWidth(wide)))}
          color={selected && state.kind === "downloading" ? palette.accentBright : barColor}
        />
        <Box width={2} />
        <Text color={selected ? palette.text : palette.subtext}>{pct}</Text>
      </Box>

      <Box height={1} paddingLeft={4}>
        <StateLine item={item} state={state} tick={tick} />
      </Box>
    </Box>
  );
}

function StateLine({ item, state, tick }: { item: TorrentItem; state: DownloadUiState; tick: number }): React.ReactNode {
  switch (state.kind) {
    case "resolvingMetadata":
      return (
        <Text color={palette.amber}>
          <Spinner tick={tick} /> resolving metadata…
        </Text>
      );
    case "metadataUnavailable":
      return (
        <Text color={palette.orange}>
          ⚠ metadata unavailable{state.retryInMs !== null ? ` · retrying in ${formatDuration(state.retryInMs)}` : " · retrying automatically"}
        </Text>
      );
    case "metadataReady":
    case "waitingPeers":
      return (
        <Text color={palette.amber}>
          <Spinner tick={tick} /> waiting for peers…
        </Text>
      );
    case "checking":
      return (
        <Text color={palette.amber}>
          <Spinner tick={tick} /> checking files…
        </Text>
      );
    case "downloading":
      return <DownloadingLine item={item} />;
    case "paused":
      return <Text color={palette.dim}>paused at {Math.round(item.progress * 100)}%</Text>;
    case "stopped":
      return <Text color={palette.dim}>stopped at {Math.round(item.progress * 100)}%</Text>;
    case "queued":
      return <Text color={palette.dim}>queued · waiting for a free slot</Text>;
    case "completed":
      return <Text color={palette.green}>✓ completed</Text>;
    case "seeding":
      return (
        <Text color={palette.teal}>
          ↑ {formatRate(item.uploadSpeed)} · {item.peers} peers
        </Text>
      );
    case "failed":
      return (
        <Text color={palette.red}>
          ⚠ {truncateText(item.error ?? "failed", 90)}
        </Text>
      );
  }
}

function DownloadingLine({ item }: { item: TorrentItem }): React.ReactNode {
  const parts: string[] = [];
  if (item.downloadSpeed > 0) parts.push(`↓ ${formatRate(item.downloadSpeed)}`);
  if (item.uploadSpeed > 0) parts.push(`↑ ${formatRate(item.uploadSpeed)}`);
  parts.push(`${item.peers} peers`);
  if (item.seeds > 0) parts.push(`${item.seeds} seeds`);
  if (Number.isFinite(item.timeRemaining) && item.timeRemaining >= 0) {
    parts.push(`ETA ${formatDuration(item.timeRemaining)}`);
  }
  return <Text color={palette.subtext}>{parts.join("  ·  ")}</Text>;
}

function subtitleFor(item: TorrentItem, state: DownloadUiState, sizeText: string): string {
  const md = item.metadata;
  const spec = [md.quality, md.resolution, md.codec, md.game?.version].filter(Boolean).join(" · ");
  switch (state.kind) {
    case "downloading":
    case "metadataReady":
    case "waitingPeers":
    case "checking":
    case "paused":
    case "stopped":
    case "completed":
    case "seeding":
      return spec ? `${spec} · ${sizeText}` : sizeText;
    case "resolvingMetadata":
    case "metadataUnavailable":
      return item.sourceSize ? `src ${sizeText} · ${spec}`.replace(/ · $/, "") : "resolving metadata…";
    case "queued":
      return sizeText;
    case "failed":
      return sizeText;
  }
}

function meaningfulProgress(state: DownloadUiState): boolean {
  switch (state.kind) {
    case "downloading":
    case "waitingPeers":
    case "metadataReady":
    case "checking":
    case "paused":
    case "stopped":
    case "completed":
    case "seeding":
      return true;
    default:
      return false;
  }
}

function barTone(state: DownloadUiState, selected: boolean): string {
  if (selected) return palette.accent;
  switch (state.kind) {
    case "completed":
      return palette.green;
    case "seeding":
      return palette.teal;
    case "paused":
    case "stopped":
      return palette.dim;
    case "failed":
      return palette.red;
    case "metadataUnavailable":
      return palette.orange;
    case "resolvingMetadata":
    case "waitingPeers":
    case "metadataReady":
    case "checking":
      return palette.amber;
    default:
      return palette.dim;
  }
}

function terminalBarWidth(wide: boolean): number {
  return wide ? 48 : 32;
}

function stateLabel(state: DownloadUiState): string {
  switch (state.kind) {
    case "queued":
      return "queued";
    case "resolvingMetadata":
      return "resolving metadata";
    case "metadataUnavailable":
      return "metadata unavailable";
    case "metadataReady":
      return "metadata ready";
    case "waitingPeers":
      return "waiting for peers";
    case "downloading":
      return "downloading";
    case "checking":
      return "checking";
    case "paused":
      return "paused";
    case "stopped":
      return "stopped";
    case "completed":
      return "completed";
    case "seeding":
      return "seeding";
    case "failed":
      return "failed";
  }
}

function truncateText(value: string, width: number): string {
  return value.length > width ? `${value.slice(0, width - 1)}…` : value;
}

// --- diagnostics inspector ----------------------------------------------------

function DiagnosticsPanel({ item }: { item: TorrentItem }): React.ReactNode {
  const d = item.diagnostics;
  const next = d?.nextRetry ? new Date(d.nextRetry).toLocaleTimeString() : "–";
  const last = d?.lastMetadataAttempt ? new Date(d.lastMetadataAttempt).toLocaleTimeString() : "–";
  const metaLabel =
    d?.metadata === "timeout"
      ? `timeout (retry ${d.metadataRetries ?? 0})`
      : d?.metadata === "received"
        ? "received"
        : d?.metadata ?? "waiting";
  const sourceSize = item.sourceSize !== undefined ? formatBytes(item.sourceSize) : "unknown";
  const torrentSize = item.torrentSize !== undefined ? formatBytes(item.torrentSize) : "resolving…";
  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1}>
      <Text bold color={palette.accent}>
        ┌ diagnostics
      </Text>
      <KeyValue label="infohash" value={truncateText(item.infohash, 20)} valueColor={palette.dim} />
      <KeyValue label="magnet" value={d?.magnetValid ? "valid" : "invalid"} valueColor={d?.magnetValid ? palette.green : palette.red} />
      <KeyValue label="size" value={`source ${sourceSize} · torrent ${torrentSize}`} valueColor={palette.subtext} />
      <KeyValue label="metadata" value={metaLabel} valueColor={metaLabel === "received" ? palette.green : palette.amber} />
      <KeyValue label="requests" value={`${d?.metadataRequests ?? 0} sent · ${d?.metadataResponses ?? 0} received`} valueColor={palette.subtext} />
      <KeyValue label="DHT" value={dhtLabel(d)} valueColor={dhtColor(d)} />
      <KeyValue label="trackers" value={`${d?.trackerHealthy ?? 0}/${d?.trackerTotal ?? 0} healthy`} valueColor={palette.subtext} />
      <KeyValue label="peers" value={`${item.peers} connected (${d?.ipv4Peers ?? 0} IPv4 · ${d?.ipv6Peers ?? 0} IPv6) · ${d?.peersDiscovered ?? 0} discovered`} valueColor={palette.subtext} />
      <KeyValue label="engine" value={d?.engineState ?? "created"} valueColor={palette.subtext} />
      <KeyValue label="last event" value={d?.lastEvent ?? "no engine event yet"} valueColor={palette.dim} />
      <KeyValue label="attempts" value={`last ${last} · next ${next} · retry ${d?.metadataRetries ?? 0}`} valueColor={palette.dim} />
      <Text color={palette.faint}>└ [i] close diagnostics</Text>
    </Box>
  );
}

function dhtLabel(d: TorrentItem["diagnostics"]): string {
  if (!d) return "unknown";
  const label = d.dht;
  if (d.dhtListening) return `${label} · bound ${d.dhtAddress ?? "–"}:${d.dhtPort ?? "–"} · ${d.dhtRoutingNodes ?? 0} nodes`;
  return label;
}

function dhtColor(d: TorrentItem["diagnostics"]): string {
  if (!d) return palette.dim;
  switch (d.dht) {
    case "ready":
      return palette.green;
    case "disabled":
    case "failed":
      return palette.red;
    default:
      return palette.amber;
  }
}

// --- failed panel ---------------------------------------------------------------

function FailedPanel({ item }: { item: TorrentItem }): React.ReactNode {
  const d = item.diagnostics;
  return (
    <Box flexDirection="column" paddingX={2} paddingTop={1}>
      <ErrorState message={item.error ?? "failed"} />
      <Box height={1} paddingLeft={2}>
        <Text color={palette.dim}>
          DHT{" "}
          <Text color={dhtColor(d)}>{d?.dht ?? "unknown"}</Text>
          <Text dimColor>  ·  </Text>
          trackers{" "}
          <Text color={(d?.trackerHealthy ?? 0) > 0 ? palette.green : palette.dim}>
            {(d?.trackerHealthy ?? 0) > 0 ? "available" : "unavailable"}
          </Text>
          <Text dimColor>  ·  </Text>
          peers <Text color={palette.subtext}>{item.peers}</Text>
        </Text>
      </Box>
      <Box height={1} paddingLeft={2}>
        <Text color={palette.faint}>retry now with [r] · diagnostics with [i]</Text>
      </Box>
    </Box>
  );
}