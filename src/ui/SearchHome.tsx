/**
 * Home / search view: a centered hero with the app wordmark and the search
 * input. All input handling lives in App; this stays presentational.
 */
import { Box, Text } from "ink";
import { TextInput } from "./components.js";
import { palette } from "./theme.js";

export interface SearchHomeProps {
  query: string;
  cursor: number;
  enabledSources: number;
  healthSources: number;
  maxActiveDownloads: number;
}

export function SearchHome({
  query,
  cursor,
  enabledSources,
  healthSources,
  maxActiveDownloads,
}: SearchHomeProps): React.ReactNode {
  const concurrency = maxActiveDownloads > 0 ? `${maxActiveDownloads} max active downloads` : "unlimited downloads";
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2}>
      <Box flexGrow={1} />

      <Box justifyContent="center">
        <Text color={palette.magenta} bold>
          ⚡ tornedo
        </Text>
      </Box>
      <Box justifyContent="center" marginTop={1}>
        <Text color={palette.subtext}>local-first · terminal-native · federated torrent search</Text>
      </Box>

      <Box flexGrow={1} />

      <Box justifyContent="center" width="100%">
        <Box
          flexDirection="column"
          width="64%"
          borderStyle="round"
          borderColor={palette.border}
          backgroundColor={palette.panelAlt}
          paddingX={2}
          paddingY={1}
        >
          <Text dimColor>search</Text>
          <Box marginTop={1}>
            <Text color={palette.accent} bold>
              ❯{" "}
            </Text>
            <TextInput value={query} cursor={cursor} placeholder="a movie, show, game, anime, album…" />
          </Box>
        </Box>
      </Box>

      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>
          {enabledSources} sources enabled · {healthSources} report swarm health · {concurrency}
        </Text>
      </Box>

      <Box flexGrow={1} />
    </Box>
  );
}