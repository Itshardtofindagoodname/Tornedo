/**
 * Help overlay: a compact summary of navigation and the full set of
 * configurable keybindings. Any key returns to the previous view.
 */
import { Box, Text } from "ink";
import type { Application } from "../app/application.js";
import { KEY_ACTIONS, type KeyAction } from "../config/config.js";
import { palette } from "./theme.js";

const ACTION_LABELS: Record<KeyAction, string> = {
  up: "move up",
  down: "move down",
  pageup: "page up",
  pagedown: "page down",
  home: "first item",
  end: "last item",
  confirm: "confirm / open / download",
  download: "toggle file",
  downloadTo: "download to…",
  pause: "pause",
  resume: "resume",
  remove: "remove",
  toggleSeed: "toggle seeding",
  filter: "filter / refine results",
  category: "category scope",
  sort: "sort results",
  menu: "download actions",
  copyMagnet: "show magnet",
  openMagnet: "open magnet",
  help: "help",
  back: "back / cancel",
  quit: "quit",
  search: "search",
  downloads: "downloads view",
  sources: "sources view",
  settings: "settings view",
  toggleDetails: "diagnostics",
};

const NAV: readonly { key: string; label: string }[] = [
  { key: "1", label: "search" },
  { key: "2", label: "downloads" },
  { key: "3", label: "sources" },
  { key: "4", label: "settings" },
  { key: "?", label: "help" },
  { key: "esc", label: "back" },
  { key: "q", label: "quit" },
];

export function HelpView({ app }: { app: Application }): React.ReactNode {
  const bindings = app.getConfig().keybindings;

  const rows = KEY_ACTIONS.map((action) => ({
    action,
    keys: bindings[action]?.join(", ") ?? "—",
  }));
  const half = Math.ceil(rows.length / 2);
  const left = rows.slice(0, half);
  const right = rows.slice(half);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={1}>
      <Box justifyContent="center">
        <Text bold color={palette.accent}>
          ⚡ TORNEDO
        </Text>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.faint}>navigation</Text>
        <Box height={1}>
          <Text color={palette.subtext}>
            {NAV.map((n, i) => (
              <Text key={n.key}>
                {i > 0 ? <Text color={palette.dim}>  ·  </Text> : null}
                <Text color={palette.accent} bold>
                  {n.key}
                </Text>{" "}
                {n.label}
              </Text>
            ))}
          </Text>
        </Box>
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.faint}>Keybindings</Text>
        {left.map((r, i) => {
          const rightRow = right[i];
          return (
            <Box key={r.action} height={1}>
              <Box width={24}>
                <Text color={palette.dim}>{ACTION_LABELS[r.action]}</Text>
              </Box>
              <Box width={12}>
                <Text color={palette.accent}>{r.keys}</Text>
              </Box>
              {rightRow ? (
                <>
                  <Box width={24}>
                    <Text color={palette.dim}>{ACTION_LABELS[rightRow.action]}</Text>
                  </Box>
                  <Text color={palette.accent}>{rightRow.keys}</Text>
                </>
              ) : null}
            </Box>
          );
        })}
      </Box>

      <Box flexDirection="column" marginTop={1}>
        <Text color={palette.faint}>watch mode (streaming)</Text>
        <Box height={1}>
          <Text color={palette.subtext}>
            <Text color={palette.accent} bold>tab</Text>{" "}toggle watch ⇄ download on home ·{" "}
            <Text color={palette.accent} bold>enter</Text>{" "}play ·{" "}
            <Text color={palette.accent} bold>d</Text>{" "}download stream ·{" "}
            <Text color={palette.accent} bold>s</Text>{" "}subtitles
          </Text>
        </Box>
        <Box height={1}>
          <Text color={palette.subtext}>
            <Text color={palette.accent} bold>o</Text>{" "}open with player ·{" "}
            <Text color={palette.accent} bold>R</Text>{" "}resolution ·{" "}
            <Text color={palette.accent} bold>*</Text>{" "}favorite ·{" "}
            <Text color={palette.accent} bold>tab</Text>{" "}episodes ⇄ streams
          </Text>
        </Box>
      </Box>

      <Box flexGrow={1} />

      <Box justifyContent="center" paddingBottom={1}>
        <Text dimColor>press any key to go back</Text>
      </Box>
    </Box>
  );
}