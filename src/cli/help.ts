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
  files <input>     List a torrent's files before downloading
  watch <dir>       Watch a directory for .torrent / magnet files
  history           Show recent search history
  history --clear   Clear recent search history
  config            Show configuration (JSON)
  sources           List search sources and their enabled state
  sources --check   Diagnose configured Torznab / Internet Archive providers
  doctor            Inspect the installation and report problems
  clear             Delete every download and wipe local state
  uninstall         Uninstall the tornedo npm package
  uninstall --clear Wipe state, then uninstall
  tui               Launch the terminal UI (default when no command)
  help              Show this help
  version           Print the version

OPTIONS
  -j, --json          Machine-readable JSON on stdout only (for search/downloads)
  --source <id>       Restrict search to one source (repeatable)
  --category <cat>    Restrict search to a media category (Movie, TV, Music, ...)
  --limit <n>         Limit the number of results / rows printed
  --dir <dir>         Download directory for this operation
  --select <path>     Download only these files (repeatable / comma-separated)
  --seed              Enable seeding after completion (overrides config)
  --no-seed           Disable seeding after completion (overrides config)
  --priority <n>      Queue priority for the new download (lower = sooner)
  --no-wait           Don't wait for a download to finish (magnet/file/infohash)
  -y, --yes           Skip confirmation prompts (clear / uninstall)
  --clear             Wipe downloads and local state (also 'tornedo --clear')
  -q, --quiet         Suppress non-essential output
  -h, --help          Show help
  -V, --version       Print version

EXAMPLES
  tornedo search "interstellar"
  tornedo search "interstellar" --json | jq .results
  tornedo search "cyberpunk" --source fitgirl
  tornedo search "brian eno" --category Music
  tornedo magnet "magnet:?xt=urn:btih:..."
  tornedo file ./movie.torrent
  tornedo files ./movie.torrent
  tornedo file ./movie.torrent --select "subs/en.srt,movie.mkv"
  tornedo watch ~/torrent-drop
  tornedo doctor
  tornedo history --clear
  tornedo config set maxActiveDownloads 5
  tornedo sources --check
  tornedo --clear
  tornedo uninstall --clear

FILES
  Config:   <config-dir>/tornedo/config.json
  Database: <data-dir>/tornedo/tornedo.sqlite
`;

export function listCommands(): string {
  return COMMANDS.join(", ");
}