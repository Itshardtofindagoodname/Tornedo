# Logging

The app writes a file log so issues invisible in the TUI (full error text, URLs,
statuses, content-types) are recorded and can be shared.

## Location

- macOS: `~/Library/Application Support/moviebox-tui/logs/`
- Windows: `%LOCALAPPDATA%\moviebox-tui\logs\`
- Linux: `$XDG_DATA_HOME/moviebox-tui/logs/` (else `~/.local/share/moviebox-tui/logs/`)

The active file is `moviebox-tui_rCURRENT.log`; rotated files are
`moviebox-tui_r00000.log`, `…`.

## Behavior

- **Level** is controlled by `MOVIEBOX_LOG` (`off|warn|info|debug|trace`). Default is
  `warn` in release builds, `info` in debug builds.
- **Rotation**: rotates at 5MB and keeps 3 files.
- **Terminal output**: normal log lines go only to the file without writing to stdout or stderr, preventing screen bleed before entering alternate screen mode. Setup errors (if any) are reported on `stderr`.
- **Session header**: version, OS, and the log path are written on startup.
- **Panics**: the panic hook logs the payload to the file, then restores the terminal.
- `--version` and `--help` never create a log file.

## What is logged

- `error`: hard failures (all-hosts exhausted, resolve failures, player spawn/crash,
  download failures, panics) and every `Error:` status the UI shows.
- `warn`: recoverable issues (mirror rejected, subtitle unavailable, cache write
  failed, GitHub rate limit).
- `info`: session start, playable mirror found, playback launch.
- `debug`: full request context (enable with `MOVIEBOX_LOG=debug`).

## Privacy / sharing

Logs are sanitized so they can be pasted into a GitHub issue:

- URLs are reduced to `scheme://host` — file tokens, filenames, and query params are
  removed.
- Absolute paths are rewritten to `~` so your username does not appear.
- Headers, `Authorization`, search queries, and watch history are never
  logged.

Reproduce the problem, then attach the current log file. See [debugging.md](debugging.md).
