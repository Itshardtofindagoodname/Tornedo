/**
 * Settings view: a focused, sectioned list of real configuration values.
 * Selecting a row highlights it; the App component owns editing (prompts for
 * text/number fields, immediate toggles for booleans and sources). Only
 * configuration that is genuinely useful is surfaced — no internal knobs.
 *
 * Long values (e.g. the download directory) are kept on a single line and
 * truncated from the middle so both the start and end of a path stay visible.
 */
import { Box, Text, useWindowSize } from "ink";
import { palette } from "./theme.js";

export type SettingsRow =
  | { type: "header"; label: string }
  | { type: "item"; id: string; label: string; value: string }
  | { type: "toggle"; id: string; label: string; value: boolean }
  | { type: "source"; id: string; label: string; value: boolean };

export interface SettingsViewProps {
  rows: readonly SettingsRow[];
  selectedId: string;
}

const VALUE_WIDTH = 30;

/**
 * Vertical space reserved for the chrome surrounding the scrollable list:
 * app header (3) + this view's title/margins/hint (3) + app footer (2) plus a
 * margin of slack so the rendered frame never runs into the terminal edge
 * (which clips rows and corrupts text layout).
 */
const RESERVED_LINES = 13;

export function SettingsView({ rows, selectedId }: SettingsViewProps): React.ReactNode {
  const { rows: screenRows } = useWindowSize();
  const screen = screenRows || 24;
  const viewport = Math.max(5, Math.min(16, screen - RESERVED_LINES));
  const selectedIndex = Math.max(0, rows.findIndex((r) => r.type !== "header" && r.id === selectedId));
  const start = Math.max(0, Math.min(selectedIndex - viewport + 1, Math.max(0, rows.length - viewport)));
  const visible = rows.slice(start, Math.min(rows.length, start + viewport));

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2}>
      <Box height={1} paddingLeft={1}>
        <Text bold color={palette.text}>
          Settings
        </Text>
        <Text dimColor>  ·  changes apply immediately</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {visible.map((row, i) => {
          if (row.type === "header") {
            return (
              <Box key={row.label} height={1} paddingLeft={3} marginTop={i === 0 ? 0 : 2}>
                <Text color={palette.accent} bold>
                  {row.label}
                </Text>
              </Box>
            );
          }
          const isSel = row.id === selectedId;
          return (
            <Box key={row.id} height={1} backgroundColor={isSel ? palette.surfaceAlt : undefined} paddingLeft={1}>
              <Box width={2}>
                <Text color={isSel ? palette.accent : palette.faint} bold={isSel}>
                  {isSel ? "›" : " "}
                </Text>
              </Box>
              <Box flexGrow={1} paddingRight={2}>
                <Text color={isSel ? palette.text : palette.subtext} wrap="truncate">
                  {row.label}
                </Text>
              </Box>
              {row.type === "item" ? (
                <Box width={VALUE_WIDTH} justifyContent="flex-end" paddingRight={2}>
                  <Text color={row.value === "unlimited" ? palette.dim : palette.subtext} wrap="truncate-middle">
                    {row.value}
                  </Text>
                </Box>
              ) : (
                <Box width={VALUE_WIDTH} justifyContent="flex-end" paddingRight={2}>
                  <Text color={row.value ? palette.green : palette.dim} bold>
                    {row.value ? "on" : "off"}
                  </Text>
                </Box>
              )}
            </Box>
          );
        })}
      </Box>

      <Box flexGrow={1} />

      <Box paddingBottom={1}>
        <Text color={palette.faint}>enter edit · ↑/↓ navigate · esc back{start > 0 ? " · scroll" : ""}</Text>
      </Box>
    </Box>
  );
}