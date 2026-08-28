# Changelog

All notable changes to this project are documented in this file.

## [5.0.0] - 2026-08-28

### Features

- **Watch mode (streaming).** `tab` on the home screen flips the search into
  streaming mode — one query searches **MovieBox**, **4KHDHub** and your
  installed Stremio addons (Cinemeta ships by default) concurrently, and
  results come back as poster rows instead of torrents. Series browse down to
  per-episode release lists (MovieBox season info, 4KHDHub release pages);
  `enter` plays the selected stream in **mpv / VLC / IINA** and `d` downloads it
  with Range-resume. Subtitles (MovieBox external captions), a resolution
  picker, "open with…", favorites (`*`) and a watch history are all wired in.
- **All sources ship enabled.** Watch searches now run across **MovieBox**,
  **4KHDHub**, your addons, **BDIX** and the **Torrent** engine with zero setup:
  - **BDIX** (CircleFTP — the publicly reachable BD gateway) is on by default.
    It only works from supported Bangladeshi ISP networks; elsewhere the source
    shows nothing ("unreachable") instead of erroring, and a dead endpoint is
    latched so searches skip it for a few minutes rather than stalling.
  - **Anime Kitsu is bundled** alongside Cinemeta, so anime catalogs/meta work
    out of the box without installing the third-party addon.
  - **Torrent sources.** Watch search now includes ranked results from
    Tornedo's own torrent engine (`searchOnce` — capped at ~7s so stragglers
    never stall the UI). Playing a torrent item streams it through **WebTorrent**
    over a local HTTP Range server (lazy-loaded so search stays fast, torn down
    on suspend), picking the best matching file and resolving a magnet for the
    player. The usual release metadata (seeders, size, source, resolution)
    surfaces in the stream row.
- **Live TV.** Register any m3u8 playlist (`tornedo tv add <url> [name]`);
  matching channels surface in Watch-mode searches with a `live tv` tag and
  play straight from their stream URL. `tornedo tv list|search|test|remove`
  manage and probe playlists, plus the usual `--json` output.
- **Themes.** A MovieBox-Tui-style theme engine with 9 palettes (mocha, latte,
  macchiato, frappe, nord, tokyonight, dracula, gruvbox, rosepine) plus the
  original Tornedo `default`. Theme applies live from Settings.
- **New config keys**: `searchAction`, `streamingEnabled`, `bdixEnabled`,
  `defaultPlayer`, `streamDownloadDir`, `theme`.
- **mpv position tracking** — a tiny Lua script records position/duration on
  exit so *Continue watching* can resume at the right offset.
- **`tornedo addons`** — a first-class way to manage Stremio addons without
  hand-editing files: `list` (shows each addon's stream capability),
  `add <url>` (fetches and validates the manifest before installing),
  `remove <url|id>` and `clear`. Cinemeta + Anime Kitsu remain the bundled
  defaults, and a fresh install falls back to them automatically.

### Notes

- Requires at least one external player (mpv, VLC or IINA) for playback.
- Bumped the published version to 5.0.0.

### Fixes

- **External players are now found at their default install locations.**
  VLC/mpv/IINA installed to standard paths (Windows `Program Files`, Homebrew,
  Flatpak/Snap) are detected without being on PATH, and explicit
  `TORNEDO_MPV_PATH`/`TORNEDO_VLC_PATH`/`TORNEDO_IINA_PATH` overrides win first,
  mirroring the reference MovieBox-Tui probe order. This fixes "open with" not
  listing VLC on Windows.
- **Poster art rendered brighter and undistorted.** The half-block renderer's
  grid was sized for one pixel row but indexed for two, so the bottom half of
  every cell silently fell through to the terminal background — posters looked
  short and washed out. The grid is now `rows*2` tall, covers are fit with
  aspect-ratio-preserving letterboxing (contain) instead of being squashed,
  and edge-cell transparency is blended by coverage instead of dropped.
  Wide terminals additionally render posters at higher resolution (results
  `8×6→10×8`, details `14×11→16×13`).
- **VLC runs with `--play-and-exit`** and Windows subtitle paths are
  normalized to forward slashes so `--sub-file` parses instead of exploding.
- **Cinemeta details/streams no longer fail on prefixed ids.**
  Double-prefixed ids like `cinemeta:cinemeta:tt…` were mis-classified as
  series by a naive type guess, so movies returned `addon meta empty …` and
  "No streams found for this title." Details now probe the Stremio meta types
  just like the reference (series/tv/anime first, movie as the fallback) and
  streams use the catalog's real media type instead of the id guess.
- **Addon streams respect manifest capabilities.** Cinemeta (the default
  addon) only serves `catalog`/`meta` — its `/stream/…` endpoints 404 by
  design. Streams are now gated on the manifest's `stream` resource exactly
  like the reference's `provides_stream`, network failures count as "no
  streams" instead of shouting `… → 404`, torrent-only results surface a
  "blocked (raw torrents)" warning, and the empty state explains that a
  stream provider must be installed — instead of a raw URL error.
- **Addon results are playable out of the box.** When an addon title has no
  HTTP streams (Cinemeta has no `stream` resource, and most other free addons
  only serve raw torrents), Watch mode now auto-falls back to the same title
  on the bundled **MovieBox** / **4KHDHub** providers — so nothing about
  streaming shows as "broken" and the user never has to install anything. The
  "no stream provider" notice only appears when a title genuinely has no
  playable streams anywhere, matching what MovieBox-Tui itself reports.
  (MovieBox-Tui hides this entirely because its default config has addons
  disabled; we keep addons on for better discovery and simply route playback
  to the bundled providers.)
- **Torrent playback opens the player instantly.** The WebTorrent engine is
  preloaded as soon as a search returns torrent results, and the highlighted
  release's metadata is fetched in the background while you browse streams (no
  pieces download until `enter`). Playing then reuses the memoized local HTTP
  server, so mpv/VLC opens immediately like MovieBox-Tui instead of waiting on
  the engine/peer lookup.
- **Streaming no longer crashes on a premature client close.** A player that
  seeks or closes the connection mid-stream made WebTorrent's streamx pipe
  surface `StreamError: Writable stream closed` (`PREMATURE_CLOSE`) with no
  listener — uncaught, it killed the process. Disconnects are now treated as a
  normal player abort.
- **Poster art removed from the Watch UI.** Results and details render as
  compact text rows instead of half-block poster art (which either never
  fetched or printed as pixel noise). Roughly 3–4× more results fit per screen,
  and the poster fetch/decode workbench no longer runs under the hood.

## [4.1.0] - 2026-08-25

### Fixes

- **Fixed the reported CLI version lagging behind the package version.**
  `tornedo --version` / `tornedo version` still printed `3.2.0` even after the
  package had moved to 4.0.0, because the version string was hardcoded in the
  source and drifted whenever the manifest was bumped. The CLI now reads its
  version directly from `package.json` at runtime, so the reported version is
  always exactly the installed package's version — no manual re-syncing ever
  again.

### Chores

- Bumped the published version to 4.1.0.

## [4.0.0] - 2026-08-25

### Documentation & presentation

- Refreshed the README with a screenshot tour of the app (search, results,
  downloads, file selection), an expanded highlights section, and updated
  command/keybinding tables.
- Documented the full source lineup (FitGirl Repacks, YTS, The Pirate Bay,
  1337x, LimeTorrents, TorrentGalaxy, TorrentDownloads, EZTV, Nyaa, SubsPlease,
  BitTorrented) alongside the user-configurable Torznab/Newznab and Internet
  Archive providers.
- Bumped the published version to 4.0.0.

> [!NOTE]
> The 4.0.0 release shipped with a stale hardcoded version constant, so
> `tornedo --version` kept reporting 3.2.0 on machines that installed it.
> Fixed in 4.1.0.

## [3.2.0] - 2026-08-20

### File selection, clarified keys

- **`enter` is now the single download key.** It no longer competes with `d`:
  in the details inspector `enter` commits the download of the checked files;
  the redundant `d`-download shortcut was removed.
- **`d` now toggles the highlighted file** for download everywhere a file list
  appears (the details inspector). It is no longer bound to "download".
- **The file list moved to a right-hand panel** of the details inspector and
  lists as many files as fit at once, scrolling to keep the highlighted file in
  view. Every file is still checked by default (`a` all · `n` none ·
  `d`/`space` toggle, `✓` = selected).
- Keybinding definitions, on-screen help and the README were updated to match
  (`enter` download · `d` toggle file).

### Chores

- Bumped the published version to 3.2.0 (and re-synced `tornedo --version`).

## [3.0.0] - 2026-08-20

### File selection, redesigned

- **File selection is a default state of the details inspector**, not a
  keybind. Opening details for a torrent automatically resolves its file list
  and shows a checkbox list (`space` toggle · `a` all · `n` none · `↑/↓` move).
  Nothing downloads until you commit with `enter`/`d`; only the checked files
  are fetched. Leaving without committing (or while only browsing) cleans up the
  temporary item. The `F`/`shift+f` file-picker overlay and the
  `downloadFiles` keybinding were removed entirely.

### History cleanup

- `tornedo history --clear` no longer marks the run as a destructive
  `--clear`: previously a startup failure during a `history --clear` run would
  wipe the whole state directory (database, config, watch state) as a safety
  measure meant for real `clear`/`uninstall` runs. History commands are also
  excluded from download resume.

### Fixes

- Fixed overlapping text in the recent-searches section of the home screen
  (long query strings now truncate inside a constrained row).
- Added `overflow: hidden` clipping to the main content area so a tall details
  inspector can never bleed into the toast/footer rows.

### Chores

- Bumped the published version to 3.0.0 and re-synced `tornedo --version`.

## [2.1.0] - 2026-08-19

### Clean uninstall

- **`tornedo --clear` / `tornedo clear`** deletes every downloaded file tracked
  by Tornedo and wipes the local state (database, config, watch state, recent
  search history) so the installation is ready for a clean uninstall.
- **`tornedo uninstall`** uninstalls the global `tornedo` npm package, and
  `tornedo uninstall --clear` wipes all downloads and state first. Destructive
  commands ask for confirmation on a TTY and can be skipped with `-y`/`--yes`.

### File selection

- **Choose files before downloading** (like qBittorrent): the new
  `tornedo files <input>` command lists a torrent's files without downloading
  anything, and `tornedo file|magnet|infohash --select <paths>` downloads only
  the given files. In the TUI, `shift+f` opens a file-picker overlay for the
  selected result — every file is checked by default and optional extras can be
  unchecked (space toggle · `a` all · `n` none) before committing. Unselected
  files are never fetched by the engine.
- Partial downloads are detected correctly: a torrent is considered complete
  when all *selected* files finish, even when extras were skipped.

### Search history

- New `tornedo history` command lists recent searches and
  `tornedo history --clear` empties them.

### Chores

- Bumped the published version to 2.1.0 (and re-synced the reported
  `tornedo --version` with the package version).
- `tornedo downloads` and add/download output now include `selectedFiles` and
  `fileCount`.

## [1.1.0] - 2026-08-18

### Install experience

- **Removed the package `postinstall` script.** Tornedo no longer patches
  WebTorrent's internals at install time, so first-time installs no longer trip
  npm's install-script approval warnings for the `tornedo` package itself.
- **Upgraded `webtorrent` from 2.x to 3.x.** The `arr2hex(infoHash)` crash that
  the old postinstall worked around is fixed natively upstream, so the
  patch-and-repatch cycle on every `npm install` is gone entirely.
- **Added an `allowScripts` allowlist** to the package manifest so project
  installs are clean on npm 11.16+ / npm 12, which block or warn on dependency
  install scripts.
- **Documented the npm install-scripts flow** in the README, including the exact
  `--allow-scripts` command for global installs whose npm requires approving
  the third-party native addons (`better-sqlite3`, WebTorrent's optional
  WebRTC/uTP/WebSocket addons). Downloads still work over TCP if the optional
  addons are skipped.

### Chores

- Synchronized the reported CLI version (`tornedo --version`) with the package
  version.
- Added this changelog.

[5.0.0]: https://github.com/Itshardtofindagoodname/Tornedo/releases/tag/v5.0.0
[4.1.0]: https://github.com/Itshardtofindagoodname/Tornedo/releases/tag/v4.1.0
[4.0.0]: https://github.com/Itshardtofindagoodname/Tornedo/releases/tag/v4.0.0
[3.2.0]: https://github.com/Itshardtofindagoodname/Tornedo/releases/tag/v3.2.0
[3.0.0]: https://github.com/Itshardtofindagoodname/Tornedo/releases/tag/v3.0.0
[2.1.0]: https://github.com/Itshardtofindagoodname/Tornedo/releases/tag/v2.1.0
[1.1.0]: https://github.com/Itshardtofindagoodname/Tornedo/releases/tag/v1.1.0