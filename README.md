# tornedo

Local-first, terminal-native, federated torrent **search** and **download** client.

Search many torrent sites at once, get one clean, ranked, de-duplicated result
set, and download with a fast native engine — all without an account, a cloud,
or any telemetry. State lives in a local SQLite database and survives restarts.

```
tornedo search "dune"          # one federated search, every source
tornedo search "cyberpunk" --json | jq .results
tornedo magnet "magnet:?xt=urn:btih:..."
tornedo                        # terminal UI
```

## Highlights

- **Federated search** — every enabled source runs concurrently with its own
  timeout and fault isolation; a slow or dead source never blocks the others.
  Results stream in as each source settles.
- **Smart results** — titles are parsed into structured metadata (quality,
  codec, audio, HDR, editions, languages…), identical torrents from different
  sites are merged, everything is deterministically ranked, and releases group
  by title/year/season with each quality as a variant.
- **Fast downloads** — WebTorrent engine behind a thin abstraction, persistent
  queue, resume support, per-torrent and global speed limits, seeding.
- **Terminal UI** — an elegant, component-driven TUI built on **Ink + React**:
  search, results, live source status, details, downloads, and help. Every
  keybinding is configurable and shown on-screen.
- **Headless** — everything the UI can do is available as commands with
  `--json` output.
- **Watch mode** — drop `.torrent` or `.magnet`/magnet-URI files into a folder
  and they are added automatically.
- **Private by design** — no accounts, no tracking, no analytics. Config and
  database live on your machine.

## Install & build

Requires Node.js >= 22.

```sh
npm install
npm run build        # compiles TypeScript to dist/
npm run dev -- search "dune"   # run from source without building
```

The CLI entry point is `dist/cli.js`; `npm link` exposes the `tornedo` command.

## Commands

```
tornedo search <query>     Search every enabled source (streams results)
tornedo downloads          List the queue and active torrents
tornedo magnet <uri>       Add a torrent by magnet URI (waits for completion)
tornedo infohash <hash>    Add a torrent by bare infohash
tornedo file <path>        Add a .torrent file
tornedo watch <dir>        Watch a directory for .torrent / magnet files
tornedo config             Show / set configuration
tornedo sources            List sources and their enabled state
tornedo tui                Terminal UI (default when no command)
```

Common flags: `--json` (machine-readable output on stdout only), `--source <id>`
(repeatable), `--limit <n>`, `--dir <dir>`, `--seed` / `--no-seed`,
`--no-wait`, `-q/--quiet`. See `tornedo help`.

## Terminal UI

| Key | Action |
| --- | --- |
| `↑/k` `↓/j` | navigate |
| `enter` / `d` | download selected |
| `D` | download to a chosen directory |
| `i` | toggle details pane |
| `/` | search again |
| `v` | downloads view |
| `p` / `r` | pause / resume selected download |
| `x` | remove selected download |
| `s` | toggle seeding |
| `y` | show selected magnet |
| `?` | help |
| `q` | quit |

Keybindings are configurable under `keybindings` in the config file.

## Sources

Enable/disable any source (`tornedo sources`, then
`tornedo config set sources.<id> true|false`). Adapters: **FitGirl Repacks**
(games), **YTS** (movies), **The Pirate Bay** (movies/TV/music), **1337x**
(movies/TV/music), **LimeTorrents**, **TorrentGalaxy**, and **TorrentDownloads**
(music fallbacks), **EZTV** (TV), **Nyaa** (anime), **SubsPlease** (anime), and a
**BitTorrented** general feed. Sources that report real swarm health (seeders)
are ranked preferentially.

## Configuration

`tornedo config` prints the effective config as JSON. Files live at:

- Config: `<config-dir>/tornedo/config.json`
- Database: `<data-dir>/tornedo/tornedo.sqlite` (SQLite, WAL)

Set `TORNEDO_STATE_DIR` to relocate both (also used by the test suite).

| Key | Meaning |
| --- | --- |
| `downloadDir` | where completed data lands |
| `maxActiveDownloads` | concurrent active downloads (`0` = unlimited) |
| `maxDownloadSpeed` / `maxUploadSpeed` | global limits in B/s (`0` = unlimited) |
| `sourceTimeoutMs` | per-source search timeout |
| `sources` | `sourceId -> enabled` map |
| `seedAfterComplete` | default seeding behavior |
| `ranking.*` | ranking weights (seeders, quality, health, size) |
| `watchIntervalMs` | watch-mode poll interval |

## Development

```sh
npm run typecheck    # strict TypeScript, no emit
npm test             # unit + integration (fake sources, no network)
npm run test:bench   # throughput benchmarks
npm run build
```

The test suite never touches your real config or database (`TORNEDO_STATE_DIR`
points at a temp directory). The search engine, download manager, and CLI are
covered end-to-end with fake sources and a fake torrent client.

## Architecture

```
src/
  model/       domain types (search, torrent, source)
  config/      config schema + OS paths
  database/    SQLite schema, migrations, store
  torrent/     TorrentClient abstraction, WebTorrent engine, parsing
  downloads/   download manager (queue, scheduler, seeding)
  sources/     source adapters + shared net/rss helpers
  search/      federated search engine (fault-isolated, concurrent)
  media/       title/audio parsing, classification, normalization
  results/     dedupe, ranking, grouping, filtering
  app/         Application wiring + session-based search service
  watch/       watch-mode service
  cli/         commands + arg parsing
  ui/          Ink/React terminal UI (views, components, key handling)
```

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE).
