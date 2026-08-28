/**
 * Watch (streaming) details: a compact text header (title + meta + synopsis)
 * plus a pane ("episodes" for series, "streams" for the video sources of the
 * picked episode/movie). Pure presentation — App owns key routing, content
 * loading, playback and downloads.
 */
import { Box, Text, useWindowSize } from "ink";
import type { Application } from "../app/application.js";
import { StreamCatalogItem, StreamDetails, StreamEpisode, StreamRelease } from "../stream/models.js";
import { palette } from "./theme.js";
import { ProgressBar, Spinner } from "./components.js";
import { scrollWindow } from "./text.js";

export interface WatchDownloadState {
  phase: "resolving" | "downloading" | "done" | "error";
  label: string;
  percent: number | null;
  speed: number | null;
  message?: string;
}

export interface WatchDetailsProps {
  app: Application;
  item: StreamCatalogItem;
  details: StreamDetails | null;
  loading: boolean;
  error: string | null;
  /** Active pane: episodes list (series) or stream source list. */
  pane: "episodes" | "streams";
  /** Cursor within the active pane. */
  paneCursor: number;
  season: number;
  episode: number;
  releases: readonly StreamRelease[];
  resolutions: readonly string[];
  resolution: string;
  sourcesLoading: boolean;
  sourcesError: string | null;
  /** Non-fatal streams notice (e.g. "install a stream addon", torrents blocked). */
  sourcesNotice: string | null;
  isFavorite: boolean;
  download: WatchDownloadState | null;
  tick: number;
}

const PAD = (n: number): string => String(n).padStart(2, "0");

export function WatchDetails({
  item,
  details,
  loading,
  error,
  pane,
  paneCursor,
  season,
  episode,
  releases,
  resolutions,
  resolution,
  sourcesLoading,
  sourcesError,
  sourcesNotice,
  isFavorite,
  download,
  tick,
}: WatchDetailsProps): React.ReactNode {
  void tick;
  void item;
  const { rows: screenRows, columns } = useWindowSize();
  const screen = screenRows || 24;
  const wide = (columns || 120) >= 110;

  const episodes = details !== null ? flattenEpisodes(details) : [];
  const activePane = pane === "episodes" && episodes.length > 0 ? "episodes" : "streams";

  // Compact text header (no poster art) leaves almost the whole screen for the
  // episode/stream list.
  const headerRows = 5;
  const listBudget = Math.max(4, screen - 15 - headerRows);
  const listSlots = Math.max(1, Math.min(listBudget, activePane === "episodes" ? episodes.length : Math.max(1, releases.length)));
  const listLen = activePane === "episodes" ? episodes.length : releases.length;
  const { start, count } = scrollWindow(paneCursor, listSlots, listLen);
  const windowedEpisodes = activePane === "episodes" ? episodes.slice(start, start + count) : [];
  const windowedStreams = activePane === "streams" ? releases.slice(start, start + count) : [];

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={1} minHeight={0}>
      {loading && details === null ? (
        <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
          <Spinner tick={tick} />
          <Text color={palette.dim}> loading metadata…</Text>
        </Box>
      ) : error !== null && details === null ? (
        <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
          <Text color={palette.red} bold>⚠ {error}</Text>
          <Text color={palette.faint}>esc to go back</Text>
        </Box>
      ) : details === null ? (
        <Box flexGrow={1} />
      ) : (
        <Box flexDirection="column" minHeight={0}>
          <Box height={1} width="100%">
            <Text bold color={palette.text} wrap="truncate">
              {details.title}
            </Text>
            {isFavorite ? <Text color={palette.amber}> ★</Text> : null}
          </Box>
          <Box height={1}>
            <Text color={palette.subtext}>
              {details.mediaType === "series" ? "series" : details.mediaType === "tv" ? "live tv" : "movie"}
              {details.year !== undefined ? <>{`  ·  ${details.year}`}</> : null}
              {details.imdbRating !== undefined ? (
                <>
                  {"  ·  "}
                  <Text color={palette.amber}>{details.imdbRating}★</Text>
                </>
              ) : null}
              {details.duration !== undefined ? <>{`  ·  ${details.duration}`}</> : null}
              {details.genres.length > 0 ? (
                <>
                  {"  ·  "}
                  <Text color={palette.dim}>{details.genres.join(", ")}</Text>
                </>
              ) : null}
            </Text>
          </Box>
          <Box height={1} width="100%">
            <Text color={palette.dim} wrap="truncate">
              {details.tagline ?? (details.description ?? "").split("\n")[0] ?? ""}
            </Text>
          </Box>
          {wide && (details.director !== undefined || details.stars !== undefined || details.audios !== undefined || details.prints !== undefined) ? (
            <Box height={1}>
              <Text color={palette.faint} wrap="truncate">
                {details.director !== undefined ? <Text>dir. {details.director}   </Text> : null}
                {details.stars !== undefined ? <Text>cast {details.stars}   </Text> : null}
                {details.audios !== undefined ? <Text>audio {details.audios}   </Text> : null}
                {details.prints !== undefined ? <Text>{details.prints}</Text> : null}
              </Text>
            </Box>
          ) : null}
        </Box>
      )}

      {error !== null && details !== null ? (
        <Box height={1} marginTop={1}>
          <Text color={palette.red} bold>⚠ {error}</Text>
        </Box>
      ) : null}

      {/* pane tabs */}
      {details !== null ? (
        <Box height={1} marginTop={1} width="100%">
          {episodes.length > 0 ? (
            <PaneTab label="episodes" active={activePane === "episodes"} />
          ) : null}
          <PaneTab label="streams" active={activePane === "streams"} />
          <Box flexGrow={1} />
          {activePane === "episodes" && season > 0 && episode > 0 ? (
            <Text color={palette.dim}>
              S{PAD(season)}E{PAD(episode)}
            </Text>
          ) : null}
        </Box>
      ) : null}

      {/* list region */}
      {activePane === "episodes" && episodes.length > 0 ? (
        <Box flexDirection="column" marginTop={1}>
          {windowedEpisodes.map((ep, i) => {
            const idx = start + i;
            const selected = idx === paneCursor;
            return (
              <Box key={`${ep.season}:${ep.number}`} height={1} width="100%" backgroundColor={selected ? palette.surfaceAlt : undefined} paddingLeft={1}>
                <Text color={selected ? palette.accent : palette.faint} bold={selected}>
                  {selected ? "›" : " "}
                </Text>
                <Text color={selected ? palette.accent : palette.text} bold>
                  {" "}S{PAD(ep.season)}E{PAD(ep.number)}
                </Text>
                {ep.title !== undefined && ep.title.length > 0 ? (
                  <Text color={selected ? palette.text : palette.dim} wrap="truncate">
                    {"  "}{ep.title}
                  </Text>
                ) : null}
              </Box>
            );
          })}
          {episodes.length > count ? (
            <Box height={1}>
              <Text color={palette.faint}>↑↓ browse · {start + 1}–{start + count} of {episodes.length}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {activePane === "streams" ? (
        releases.length === 0 ? (
          <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
            {sourcesLoading ? (
              <Box>
                <Spinner tick={tick} />
                <Text color={palette.dim}> resolving streams…</Text>
              </Box>
            ) : sourcesError !== null ? (
              <Text color={palette.red} bold>⚠ {sourcesError}</Text>
            ) : sourcesNotice !== null ? (
              <Text color={palette.amber}>⚠ {sourcesNotice}</Text>
            ) : (
              <Text color={palette.dim}>No streams found for this {episodes.length > 0 ? "episode" : "title"}.</Text>
            )}
          </Box>
        ) : (
          <Box flexDirection="column" marginTop={1}>
            {windowedStreams.map((rel, i) => {
              const idx = start + i;
              const selected = idx === paneCursor;
              return (
                <StreamRow key={`${rel.provider}:${rel.mirrors[0]?.resolverUrl ?? rel.filename}:${idx}`} rel={rel} selected={selected} />
              );
            })}
            <Box height={1} marginTop={1}>
              <Text color={palette.faint}>
                S{PAD(season)}E{PAD(episode)} · {resolution || "auto"} · {releases.length} streams
              </Text>
            </Box>
          </Box>
        )
      ) : null}

      {/* download progress / result */}
      {download !== null ? <DownloadStatus state={download} /> : null}
    </Box>
  );
}

function PaneTab({ label, active }: { label: string; active: boolean }): React.ReactNode {
  return (
    <Box
      marginRight={2}
      paddingX={1}
      backgroundColor={active ? palette.accent : undefined}
      borderStyle={active ? undefined : "single"}
      borderColor={palette.border}
    >
      <Text color={active ? palette.bg : palette.subtext} bold={active}>
        {label}
      </Text>
    </Box>
  );
}

function StreamRow({ rel, selected }: { rel: StreamRelease; selected: boolean }): React.ReactNode {
  const size = rel.sizeBytes !== undefined && rel.sizeBytes > 0 ? formatBytes(rel.sizeBytes) : null;
  const direct = rel.mirrors.some((m) => m.directFile);
  return (
    <Box height={1} width="100%" backgroundColor={selected ? palette.surfaceAlt : undefined} paddingLeft={1}>
      <Box width={2}>
        <Text color={selected ? palette.accent : palette.faint} bold={selected}>
          {selected ? "›" : " "}
        </Text>
      </Box>
      <Text color={qualityColor(rel.quality)} bold={selected}>
        {rel.quality ?? "HD"}
      </Text>
      <Text color={palette.dim}>
        {rel.codec !== undefined ? <Text> [{rel.codec}]</Text> : null}
        {rel.language !== undefined ? <Text> [{rel.language}]</Text> : null}
        {direct ? <Text> [direct]</Text> : null}
      </Text>
      <Box flexGrow={1} paddingX={1}>
        <Text color={selected ? palette.text : palette.subtext} wrap="truncate">
          {rel.filename}
        </Text>
      </Box>
      {size !== null ? (
        <Text color={palette.dim}>
          {size}
          {"  "}
        </Text>
      ) : null}
      <Text color={palette.faint}>{rel.provider}</Text>
    </Box>
  );
}

function DownloadStatus({ state }: { state: WatchDownloadState }): React.ReactNode {
  switch (state.phase) {
    case "resolving":
      return (
        <Box height={1} width="100%" marginTop={1}>
          <Spinner tick={0} />
          <Text color={palette.dim}> resolving download…</Text>
        </Box>
      );
    case "downloading":
      return (
        <Box height={2} width="100%" marginTop={1} flexDirection="column">
          <Box height={1} width="100%">
            <Box flexGrow={1}>
              <Text color={palette.accent} bold wrap="truncate">
                ↓ {state.label}
              </Text>
            </Box>
            {state.percent !== null ? (
              <Text color={palette.dim}> {(state.percent * 100).toFixed(0)}%</Text>
            ) : null}
            {state.speed !== null ? <Text color={palette.dim}> {formatBytes(state.speed)}/s</Text> : null}
          </Box>
          <Box height={1} marginTop={1}>
            <ProgressBar width={60} progress={state.percent ?? 0} />
          </Box>
        </Box>
      );
    case "done":
      return (
        <Box height={1} width="100%" marginTop={1}>
          <Text color={palette.green} bold>✓ Saved:</Text>
          <Text color={palette.dim}> {state.message ?? state.label}</Text>
        </Box>
      );
    case "error":
      return (
        <Box height={1} width="100%" marginTop={1}>
          <Text color={palette.red} bold>✕ Download failed:</Text>
          <Text color={palette.dim}> {state.message ?? state.label}</Text>
        </Box>
      );
  }
}

export function flattenEpisodes(details: StreamDetails): StreamEpisode[] {
  const out: StreamEpisode[] = [];
  const seasons = [...details.seasons].sort((a, b) => a.number - b.number);
  for (const s of seasons) {
    const eps = [...s.episodes].sort((a, b) => a.number - b.number);
    for (const e of eps) out.push({ season: e.season, number: e.number, title: e.title });
  }
  return out;
}

function qualityColor(quality: string | undefined): string {
  const q = (quality ?? "").toLowerCase();
  if (q.includes("4k") || q.includes("2160p")) return palette.cyan;
  if (q.includes("1080p")) return palette.green;
  if (q.includes("720p")) return palette.amber;
  return palette.subtext;
}

function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? v.toFixed(0) : v.toFixed(1)}${units[i]}`;
}