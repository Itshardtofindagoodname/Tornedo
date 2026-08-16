/**
 * Settings view: a focused, sectioned list of real configuration values.
 * Selecting a row highlights it; the App component owns editing (prompts for
 * text/number fields, immediate toggles for booleans and sources). Only
 * configuration that is genuinely useful is surfaced — no internal knobs.
 */
import { Box, Text } from "ink";
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

export function SettingsView({ rows, selectedId }: SettingsViewProps): React.ReactNode {
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2}>
      <Box height={1} paddingLeft={1}>
        <Text bold color={palette.text}>
          Settings
        </Text>
        <Text dimColor>  ·  changes apply immediately</Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        {rows.map((row) => {
          if (row.type === "header") {
            return (
              <Box key={row.label} height={1} marginTop={1}>
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
                <Text color={isSel ? palette.text : palette.subtext}>{row.label}</Text>
              </Box>
              {row.type === "item" ? (
                <Box paddingRight={2}>
                  <Text color={row.value === "unlimited" ? palette.dim : palette.subtext} wrap="truncate">
                    {row.value}
                  </Text>
                </Box>
              ) : (
                <Box paddingRight={2}>
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
        <Text color={palette.faint}>enter edit · ↑/↓ navigate · esc back</Text>
      </Box>
    </Box>
  );
}