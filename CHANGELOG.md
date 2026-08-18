# Changelog

All notable changes to this project are documented in this file.

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