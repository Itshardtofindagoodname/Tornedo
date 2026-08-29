/**
 * Home / search view: a hero with the wordmark, the primary search input,
 * recent searches from this session, and a live snapshot of the download
 * queue. All input handling lives in App; this stays presentational.
 */
import { Box, Text, useWindowSize } from "ink";
import type { TorrentItem } from "../model/torrent.js";
import type { DownloadAction } from "../config/config.js";
import { SearchInput } from "./components.js";
import { palette } from "./theme.js";
import { downloadState, stateLabel } from "./state.js";
import { stateColor, stateGlyph } from "./format.js";
import { scrollWindow } from "./text.js";

export interface SearchHomeProps {
  query: string;
  cursor: number;
  recentSearches: readonly string[];
  /** Selected recent search (only active while focus is on the recent list). */
  recentIndex: number;
  /** True when ↓ has moved focus onto the recent-searches list. */
  recentActive: boolean;
  downloads: readonly TorrentItem[];
  enabledSources: number;
  healthCounts: { healthy: number; degraded: number; unavailable: number };
  activeDownloads: number;
  /** What enter does for a query: torrent search or streaming Watch. */
  searchAction: DownloadAction;
  streamingEnabled: boolean;
  compact?: boolean;
}

export function SearchHome({
  query,
  cursor,
  recentSearches,
  recentIndex,
  recentActive,
  downloads,
  enabledSources,
  healthCounts,
  activeDownloads,
  searchAction,
  streamingEnabled,
  compact,
}: SearchHomeProps): React.ReactNode {
  const canBrowse = recentActive && recentSearches.length > 0;
  const active = downloads.slice(0, 3);

  // Keep the stacked lists inside the terminal height. Ink mis-renders content
  // that overflows a fixed-height container as overlapping rows, so the number
  // of visible recent searches and activity rows is clamped to what actually
  // fits (recents get priority; the recent window scrolls to keep the highlight
  // visible). A normal-size terminal shows everything.
  const { rows } = useWindowSize();
  const heroRows = compact ? 10 : 15;
  const listBudget = Math.max(0, (rows || 24) - 5 - heroRows);
  const showRecents = recentSearches.length > 0;
  const showActivity = active.length > 0;
  const sectionCount = (showRecents ? 1 : 0) + (showActivity ? 1 : 0);
  const tight = listBudget < 14;
  const listMargin = tight ? 2 : 4;
  const itemRows = Math.max(0, listBudget - sectionCount * (listMargin + 1));
  const recentSlots = showRecents ? Math.min(recentSearches.length, itemRows) : 0;
  const activitySlots = showActivity
    ? Math.min(active.length, Math.max(0, itemRows - recentSlots))
    : 0;
  const { start: recentStart, count: recentCount } = scrollWindow(
    recentActive ? recentIndex : 0,
    Math.max(1, recentSlots),
    recentSearches.length,
  );
  const recentWindow = recentSearches.slice(recentStart, recentStart + recentCount);
  const activeWindow = active.slice(0, activitySlots);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2}>
      <Box height={compact ? 1 : 3} />

      <Box justifyContent="center">
        <Text bold>
          <Text color={palette.accent}>⚡</Text>
          <Text color={palette.text}> tornedo</Text>
        </Text>
      </Box>
      {!compact ? (
        <Box justifyContent="center" marginTop={1}>
          <Text color={palette.dim}>local-first | terminal-native | federated torrent search</Text>
        </Box>
      ) : null}

      <Box justifyContent="center" width="100%" marginTop={compact ? 2 : 4}>
        <Box flexDirection="column" width="62%">
          <SearchInput value={query} cursor={cursor} placeholder="search for torrents..." prompt="›" />
          <Box marginTop={1} width="100%">
            <Text color={palette.faint}>
              {searchAction === "watch"
                ? "enter to search movies | tv | anime | live tv"
                : "enter to search | search every enabled source at once"}
            </Text>
            <Box flexGrow={1} />
            {streamingEnabled ? (
              <ModeToggle searchAction={searchAction} />
            ) : null}
          </Box>
        </Box>
      </Box>

      {showRecents && recentWindow.length > 0 ? (
        <Box flexDirection="column" marginTop={listMargin} paddingX={4}>
          <Text color={palette.faint}>recent searches</Text>
          {recentWindow.map((q, i) => {
            const idx = recentStart + i;
            return (
              <Box key={q} height={1} width="100%">
                <Text color={canBrowse && idx === recentIndex ? palette.accent : palette.faint} bold={canBrowse && idx === recentIndex}>
                  {canBrowse && idx === recentIndex ? "› " : "  "}
                </Text>
                <Box flexGrow={1}>
                  <Text color={canBrowse && idx === recentIndex ? palette.text : palette.dim} wrap="truncate">
                    {q}
                  </Text>
                </Box>
              </Box>
            );
          })}
          {recentWindow.length < recentSearches.length ? (
            <Box height={1}>
              <Text color={palette.faint}>↑↓ browse | {recentStart + 1}-{recentStart + recentWindow.length} of {recentSearches.length}</Text>
            </Box>
          ) : null}
        </Box>
      ) : null}

      {showActivity && activeWindow.length > 0 ? (
        <Box flexDirection="column" marginTop={listMargin} paddingX={4}>
          <Text color={palette.faint}>recent activity</Text>
          {activeWindow.map((item) => {
            const state = downloadState(item);
            return (
              <Box key={item.id} height={1}>
                <Text color={stateColor(state)}>{stateGlyph(state)}</Text>
                <Box width={2} />
                <Text color={palette.subtext} wrap="truncate">
                  {item.name}
                </Text>
                <Text color={palette.dim}>  {stateLabel(state)}</Text>
              </Box>
            );
          })}
        </Box>
      ) : null}

      <Box flexGrow={1} />

      <Box justifyContent="center" paddingBottom={1}>
        <Text color={palette.dim}>
          {enabledSources} sources enabled
          {healthCounts.healthy > 0 ? <Text color={palette.green}> | ● {healthCounts.healthy} healthy</Text> : null}
          {healthCounts.degraded > 0 ? <Text color={palette.amber}> | ◐ {healthCounts.degraded} degraded</Text> : null}
          {healthCounts.unavailable > 0 ? <Text color={palette.red}> | ○ {healthCounts.unavailable} unavailable</Text> : null}
          <Text> | </Text>
          <Text color={activeDownloads > 0 ? palette.accent : palette.dim}>{activeDownloads} active downloads</Text>
        </Text>
      </Box>
    </Box>
  );
}

/** watch ⇄ download pill; toggled with tab on the home screen. */
function ModeToggle({ searchAction }: { searchAction: DownloadAction }): React.ReactNode {
  const watchActive = searchAction === "watch";
  return (
    <Box>
      <Box backgroundColor={watchActive ? palette.accent : undefined} paddingX={1}>
        <Text color={watchActive ? palette.bg : palette.dim} bold={watchActive}>
          watch
        </Text>
      </Box>
      <Box backgroundColor={!watchActive ? palette.accent : undefined} paddingX={1}>
        <Text color={!watchActive ? palette.bg : palette.dim} bold={!watchActive}>
          download
        </Text>
      </Box>
      <Text color={palette.faint}> tab</Text>
    </Box>
  );
}