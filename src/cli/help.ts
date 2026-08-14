/**
 * CLI help text.
 */
import { COMMANDS } from "./args.js";

export const USAGE = `tornedo — a local-first federated torrent search & download client

USAGE
  tornedo [command] [options]

COMMANDS
  search <query>    Search every enabled source at once (streams results)
  downloads         List the download queue and active torrents
  magnet <uri>      Add a torrent by magnet URI
  infohash <hash>   Add a torrent by bare infohash
  file <path>       Add a .torrent file
  watch <dir>       Watch a directory for .torrent / magnet files
  config            Show configuration (JSON)
  sources           List search sources and their enabled state
  tui               Launch the terminal UI (default when no command)
  help              Show this help
  version           Print the version

OPTIONS
  -j, --json          Machine-readable JSON on stdout only (for search/downloads)
  --source <id>       Restrict search to one source (repeatable)
  --limit <n>         Limit the number of results / rows printed
  --dir <dir>         Download directory for this operation
  --seed              Enable seeding after completion (overrides config)
  --no-seed           Disable seeding after completion (overrides config)
  --priority <n>      Queue priority for the new download (lower = sooner)
  --no-wait           Don't wait for a download to finish (magnet/file/infohash)
  -q, --quiet         Suppress non-essential output
  -h, --help          Show help
  -V, --version       Print version

EXAMPLES
  tornedo search "interstellar"
  tornedo search "interstellar" --json | jq .results
  tornedo search "cyberpunk" --source fitgirl
  tornedo magnet "magnet:?xt=urn:btih:..."
  tornedo file ./movie.torrent
  tornedo watch ~/torrent-drop
  tornedo config set maxActiveDownloads 5

FILES
  Config:   <config-dir>/tornedo/config.json
  Database: <data-dir>/tornedo/tornedo.sqlite
`;

export function listCommands(): string {
  return COMMANDS.join(", ");
}