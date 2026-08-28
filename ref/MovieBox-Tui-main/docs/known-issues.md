# Known issues and limitations

Tracked here so future work and issue reports reference the same facts.

## Latent / by-design

- **`supports_headers` is compatibility policy, not just a parser guard.** Sources that
  carry playback headers already exercise it for Android intent playback, and any future
  provider that needs headers beyond `referer`/`user-agent` will also trip it for VLC.
  Keep `player.rs::supports_headers` in sync with `vlc_command`'s filter.
- **BDIX clients use nested `if let Ok` pyramids** in search handling; they work and
  are logged, but are harder to read. Flattening is deferred (behavior-neutral refactor
  with moderate churn).
- **MovieBox request signing** hardcodes an API secret and spoofs a device identity in
  `crypto.rs`. This is inherent to the scraper; treat the module as one unit.
- **Android intent playback** cannot attach subtitles (a `VIEW` intent has no subtitle
  mechanism); subtitles are ignored for the Android player.

## Environment-dependent

- **4KHDHub mirrors rotate and can be region/rate limited.** A file whose only mirrors
  are "probe trap" workers (which refuse real streaming ranges) reports
  `no playable mirrors` with the reason in the log. Not fixable in-app.
- **Termux playback needs the device confirmed** on each release: `termux-open` /
  `am` availability and the Android chooser behavior. The historical
  `rustls-platform-verifier` initialization panic reported for v0.1.12 is not in
  the v0.1.13 dependency graph, but the upstream report remains open until a real
  Termux launch is observed.

## Verification
 
- Automated testing is enforced via `cargo test --all-features --locked` covering 173 unit and integration tests across 16 test suites (see [`docs/testing.md`](testing.md)). The count is updated when tests change; it does not replace real-player and real-device verification.
- Static correctness is enforced by strict compiler type checking, the lint gate (`cargo clippy --all-targets --all-features --locked -- -D warnings`), formatting (`cargo fmt --check`), dependency vulnerability scanning (`cargo audit`), and packaging verification (`cargo package --locked`).
- Runtime and platform-specific behavior (terminal resize, focus handling, external player launch, and Termux chooser) are verified through the release checklist in [`release-checklist.md`](release-checklist.md).
