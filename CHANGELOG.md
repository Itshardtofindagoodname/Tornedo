# Changelog

All notable changes to this project are documented in this file.

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

[1.1.0]: https://github.com/Itshardtofindagoodname/Tornedo/releases/tag/v1.1.0