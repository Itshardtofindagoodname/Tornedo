# Release Checklist

Use this before calling a new build production-ready. Static gates are necessary but not
sufficient for this project because player launch, terminal rendering, and Termux
chooser behavior depend on the real runtime environment.

## 1. Static gates

Run the repository checks first:

```bash
cargo fmt --check
cargo clippy --all-targets --all-features --locked -- -D warnings
cargo check --all-targets --all-features --locked
cargo test --all-features --locked
cargo audit
cargo package --locked
```

Confirm the entire unit and integration test suite passes on the CI host matrix
(`docs/testing.md`). Release targets that are cross-compiled must at least build
cleanly and pass the release workflow's target-binary `--version` smoke test; they
still require native player/runtime checks before release certification. A local
host without the target C/linker toolchain cannot substitute for that runner result.

Confirm the main GitHub Actions workflows are green:

- `CI`
- `Release`
- `Publish to Crates.io` when applicable
- `Update Homebrew Formula` when applicable

If you manually dispatch `Publish to Crates.io` or `Update Homebrew Formula`,
run them against the explicit release tag, not a branch head.

## 2. Desktop playback checks

Verify at least one real playback launch on each supported desktop OS:

- macOS: IINA and/or mpv/VLC
- Linux: mpv and/or VLC
- Windows: mpv and/or VLC

For each checked platform, confirm:

- the player launches from MovieBox-Tui
- the window size is reasonable
- playback works for a source with no extra headers
- playback works for a source carrying `Referer` / `User-Agent`
- subtitles still attach for mpv / VLC / IINA

## 3. Terminal rendering checks

Verify poster rendering on the terminal families the docs claim to support:

- Kitty protocol terminal
- Sixel-capable terminal
- iTerm2 protocol terminal
- Non-graphics basic terminal (clean text placeholder)

Confirm:

- posters appear on search/details screens
- resize redraw still works
- focus loss/gain redraw does not corrupt the screen after returning from playback

## 4. TV mode checks

Verify TV mode with both supported playlist source types:

- remote `http(s)` M3U
- local file M3U

Confirm:

- playlist import succeeds
- broken playlists report an error without breaking the app
- dedupe by stream URL still behaves correctly
- `/config` and `/list` work in TV mode
- channel playback launches the player

## 5. Termux / Android checks

Verify on a real Termux device before calling the desktop release production-ready:

- app starts normally
- app does not reproduce the historical `rustls-platform-verifier` initialization panic
- `Play` opens the Android chooser through `termux-open` or `/system/bin/am`
- chosen player starts playback
- downloads still go where the docs describe

This remains mandatory because chooser behavior is device/environment dependent.

## 6. Release artifact checks

Verify the published release contains:

- expected archives for macOS, Linux x64, Linux arm64, Windows x64, and Windows arm64
- `SHA256SUMS`
- working install scripts / formula references

Spot-check:

- `install.sh`
- `install.ps1`
- Homebrew formula install path

## Exit criteria

Only call the release production-ready when:

- all static gates pass
- the relevant GitHub Actions workflows pass
- the runtime checks above were performed on real target environments
- no open blocker remains in `docs/known-issues.md` for the release target
