/**
 * Home / search view: a hero with the wordmark, the primary search input,
 * recent searches from this session, and a live snapshot of the download
 * queue. All input handling lives in App; this stays presentational.
 */
import { Box, Text } from "ink";
import type { TorrentItem } from "../model/torrent.js";
import { SearchInput } from "./components.js";
import { palette } from "./theme.js";
import { downloadState, stateLabel } from "./state.js";
import { stateColor, stateGlyph } from "./format.js";

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
  compact,
}: SearchHomeProps): React.ReactNode {
  const canBrowse = recentActive && recentSearches.length > 0;
  const active = downloads.slice(0, 3);

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
          <Text color={palette.dim}>local-first · terminal-native · federated torrent search</Text>
        </Box>
      ) : null}

      <Box justifyContent="center" width="100%" marginTop={compact ? 2 : 4}>
        <Box flexDirection="column" width="62%">
          <SearchInput value={query} cursor={cursor} placeholder="search for torrents…" prompt="›" />
          <Box marginTop={1}>
            <Text color={palette.faint}>enter to search · search every enabled source at once</Text>
          </Box>
        </Box>
      </Box>

      {recentSearches.length > 0 ? (
        <Box flexDirection="column" marginTop={compact ? 2 : 4} paddingX={4}>
          <Text color={palette.faint}>recent searches</Text>
          {recentSearches.map((q, i) => (
            <Box key={q} height={1}>
              <Text color={canBrowse && i === recentIndex ? palette.accent : palette.faint} bold={canBrowse && i === recentIndex}>
                {canBrowse && i === recentIndex ? "› " : "  "}
              </Text>
              <Text color={canBrowse && i === recentIndex ? palette.text : palette.dim}>{q}</Text>
            </Box>
          ))}
        </Box>
      ) : null}

      {active.length > 0 ? (
        <Box flexDirection="column" marginTop={compact ? 2 : 4} paddingX={4}>
          <Text color={palette.faint}>recent activity</Text>
          {active.map((item) => {
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
          {healthCounts.healthy > 0 ? <Text color={palette.green}> · ● {healthCounts.healthy} healthy</Text> : null}
          {healthCounts.degraded > 0 ? <Text color={palette.amber}> · ◐ {healthCounts.degraded} degraded</Text> : null}
          {healthCounts.unavailable > 0 ? <Text color={palette.red}> · ○ {healthCounts.unavailable} unavailable</Text> : null}
          <Text> · </Text>
          <Text color={activeDownloads > 0 ? palette.accent : palette.dim}>{activeDownloads} active downloads</Text>
        </Text>
      </Box>
    </Box>
  );
}