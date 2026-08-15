/**
 * Help view: the configured keybindings, laid out readably. Any key returns to
 * the previous view.
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
  confirm: "confirm / download",
  download: "download",
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
  help: "help",
  back: "back / cancel",
  quit: "quit",
  search: "search again",
  downloads: "downloads view",
  toggleDetails: "toggle details",
};

export function HelpView({ app }: { app: Application }): React.ReactNode {
  const bindings = app.getConfig().keybindings;
  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={1}>
      <Box justifyContent="center">
        <Text bold color={palette.accent}>
          Keybindings
        </Text>
      </Box>
      <Box
        flexDirection="column"
        marginTop={1}
        borderStyle="round"
        borderColor={palette.border}
        paddingX={2}
        paddingY={1}
      >
        {KEY_ACTIONS.map((action) => {
          const keys = bindings[action]?.join(", ") ?? "—";
          return (
            <Box key={action} height={1}>
              <Box width={22}>
                <Text color={palette.dim}>{ACTION_LABELS[action]}</Text>
              </Box>
              <Text color={palette.accent}>{keys}</Text>
            </Box>
          );
        })}
      </Box>
      <Box justifyContent="center" marginTop={1}>
        <Text dimColor>Press any key to go back.</Text>
      </Box>
    </Box>
  );
}