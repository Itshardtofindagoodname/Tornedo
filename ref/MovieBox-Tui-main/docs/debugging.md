# Debugging

The app writes a sanitized file log so full errors are available even though the TUI
only shows a short status line. See [logging.md](logging.md) for location and settings.

## Reproducing an issue

1. Run with debug logging:
   `MOVIEBOX_LOG=debug moviebox-tui`
2. Reproduce the problem (search, open details, play, download, TV).
3. Grab the current log file (path printed at startup, and in the log's session header):
   - macOS: `~/Library/Application Support/moviebox-tui/logs/moviebox-tui_rCURRENT.log`
   - Windows: `%LOCALAPPDATA%\moviebox-tui\logs\moviebox-tui_rCURRENT.log`
   - Linux: `$XDG_DATA_HOME/moviebox-tui/logs/moviebox-tui_rCURRENT.log`
     (else `~/.local/share/moviebox-tui/logs/moviebox-tui_rCURRENT.log`)
4. Include it when opening an issue.

## What to include in a GitHub issue

- The version (`moviebox-tui --version`).
- Operating system and terminal (e.g. macOS + iTerm2, Windows + Windows Terminal,
  Termux).
- The player used, if the issue is playback.
- The log file (sanitized — safe to share; URLs and paths are redacted).

## Reading the log

Each line is `[timestamp] LEVEL [module:line] message`. Focus on `ERROR` lines first;
`WARN` lines explain recoverable fallbacks (e.g. a 4KHD mirror rejected, subtitles
unavailable). With `MOVIEBOX_LOG=debug` you also get request context.

## Known quick checks

- "Player unavailable" → no mpv/VLC/IINA detected; set `MOVIEBOX_PLAYER` or install one.
- "no playable mirrors" on 4KHD → all mirrors were rejected by the preflight; the log
  lists each mirror and the reason.
- TV mode "no channels" → playlists failed to load; the log names the failing source.
