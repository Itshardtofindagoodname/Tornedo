# Cross-platform

Build targets: macOS, Linux, Windows, and Android (Termux via the Linux ARM64
binary). The codebase uses
`crossterm` (all platforms), `ratatui`, and a couple of small per-OS branches.

"Build target" does not mean every runtime integration is verified on every
device. Desktop builds are covered by CI; external players and Termux require
the release checks in [`release-checklist.md`](release-checklist.md).

## OS notes

| Platform         | Notes                                                                                                                                                                                                                                                                                                |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| macOS            | IINA preferred player (via the installed IINA `iina-cli`); VLC/mpv `.app` paths detected. `process_group(0)` on spawn.                                                                                                                                                                                |
| Windows          | mpv/VLC detected via Program Files + `%LOCALAPPDATA%`; path-safe file stems; static MSVC CRT linking (`+crt-static`) for zero-dependency standalone binaries. |
| Linux            | Flatpak mpv/VLC supported (`flatpak run …`); xdg data/cache dirs.                                                                                                                                                                                                                                    |
| Android (Termux) | Uses the Linux ARM64 binary and dynamically checks for `termux-open`, `termux-open-url`, `termux-am`, or in-terminal `mpv`; playback strips `LD_LIBRARY_PATH` and `LD_PRELOAD` before launching the chooser. Android intent playback cannot forward stream headers or attach subtitles. Real-device chooser behavior is a release prerequisite; Proot/Termux X11 behavior is unsupported unless separately tested. |

## Terminal capabilities

The app probes the terminal at startup via `ratatui_image`:

- **Poster rendering**: High-resolution graphics via Sixel, Kitty, and iTerm2 protocols when supported by the terminal. Non-graphics terminals (for example Apple Terminal.app or basic xterm) display a clean, centered `No Poster` label. Image queries can be disabled via `MOVIEBOX_NO_IMAGE=1`.
- **Terminal classification**: `TERM=dumb`/`linux` fall back to a basic UI.
- Focus events (focus loss/gain) are used to re-render in place without clearing.

## Network & TLS portability

- **TLS Engine**: Uses `rustls` with embedded Mozilla roots (`webpki-roots`) across all targets (macOS, Linux, Windows, Android/Termux). The release binary has no OpenSSL runtime dependency; the `ring` cryptography backend is compiled into the binary by the platform build toolchain.
- **DNS Resolution**: Uses standard POSIX/WinSock system DNS (`getaddrinfo`) on all platforms, without requiring JNI or `ndk-context`.

## Things to verify per release

- Player launch on each OS (mpv/VLC/IINA/Android intent) — window sizing, subtitles,
  headers.
- Poster rendering across Sixel (Windows Terminal, foot), Kitty, iTerm2, and basic
  non-graphics terminals.
- TV mode with a sample M3U playlist (URL and local file).
- Addon Mode with sample HTTP addon manifests (Cinemeta, torrent/stream addons).
- Termux: on-device check that Play opens the Android chooser and the stream plays.
