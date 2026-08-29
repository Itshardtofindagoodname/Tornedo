# Changelog

All notable changes to this project are documented in this file.

## [5.2.0] - 2026-08-29

### Added

- Watch mode (streaming). `tab` on the home screen flips the search into
  streaming mode: one query searches MovieBox, 4KHDHub, installed Stremio
  addons (Cinemeta and Anime Kitsu ship by default) and the built-in torrent
  engine concurrently, and results come back as poster rows. Series browse
  down to per-episode release lists; `enter` plays the selected stream in
  mpv / VLC / IINA and `d` downloads it with Range resume. Subtitles,
  resolution picker, "open with", favorites and a watch history are wired in.
- Live TV. Register any m3u8 playlist with `tornedo tv add <url> [name]`;
  matching channels surface in Watch-mode searches with a `live tv` tag and
  play straight from their stream URL. `tornedo tv list|search|test|remove`
  manage and probe playlists, with `--json` output.
- Themes. Nine palettes (mocha, latte, macchiato, frappe, nord, tokyonight,
  dracula, gruvbox, rosepine) plus the original Tornedo `default`, applied
  live from Settings.
- New config keys: `searchAction`, `streamingEnabled`, `bdixEnabled`,
  `defaultPlayer`, `streamDownloadDir`, `theme`.
- `tornedo addons`, a command group to manage Stremio addons without editing
  files: `list`, `add <url>` (validates the manifest before installing),
  `remove <url|id>` and `clear`. Cinemeta and Anime Kitsu remain the bundled
  defaults and a fresh install falls back to them automatically.
- mpv position tracking via a bundled Lua script so Continue watching can
  resume playback at the correct offset.
- BDIX (CircleFTP) support, enabled by default. It only works from supported
  Bangladeshi ISP networks; elsewhere the source reports unreachable and a
  dead endpoint is latched so searches skip it for a few minutes.

### Changed

- Published version bumped to 5.2.0; `tornedo --version` reads the version
  from `package.json` at runtime, so the reported version always matches the
  installed package.

### Fixed

- External players are detected at their default install locations. VLC, mpv
  and IINA installed to standard paths (Windows Program Files, Homebrew,
  Flatpak/Snap) are found without being on PATH. `TORNEDO_MPV_PATH`,
  `TORNEDO_VLC_PATH` and `TORNEDO_IINA_PATH` overrides win first.
- Poster art renders correctly. The half-block renderer's grid was sized for
  one pixel row but indexed for two, so the bottom half of every cell fell
  through to the terminal background. The grid is now two rows tall, covers
  are fit with aspect-ratio-preserving letterboxing, and edge-cell
  transparency is blended by coverage.
- VLC runs with `--play-and-exit` and Windows subtitle paths are normalized
  to forward slashes so `--sub-file` parses correctly.
- Cinemeta details and streams no longer fail on double-prefixed ids such as
  `cinemeta:cinemeta:tt...`. Streams now probe the Stremio meta types like the
  reference implementation and use the catalog's real media type.
- Addon streams respect manifest capabilities. Streams are gated on the
  manifest's `stream` resource; network failures count as no streams,
  torrent-only results surface a warning, and the empty state explains that a
  stream provider must be installed.
- Addon results are playable without extra setup. When an addon title has no HTTP
  streams, Watch mode falls back to the same title on the bundled MovieBox
  and 4KHDHub providers.
- Torrent playback opens the player immediately. The WebTorrent engine is
  loaded as soon as a search returns torrent results, and the highlighted
  release's metadata is fetched in the background while browsing.
- Streaming no longer crashes on a premature client close. A player that
  seeks or closes the connection mid-stream is treated as a normal abort.
- Watch results render as compact text rows instead of half-block poster art.
- The README brand mark switched from a unicode bolt to the project's
  `tornedo_logo.svg`; documentation was scrubbed of filler and inaccurate
  claims about the network stack, sources, ranking and default addons.

## [5.2.0]: https://github.com/Itshardtofindagoodname/Tornedo/releases/tag/v5.2.0