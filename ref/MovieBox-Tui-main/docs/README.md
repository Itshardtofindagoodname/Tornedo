# MovieBox-Tui Documentation

This folder documents the project so that anyone — human or AI — can understand how it
works without reading the whole codebase. The documents summarize the current module
layout, runtime behavior, and operational workflows in prose tied to the source tree.

## Index

| Document                                     | What it covers                                                                  | Status  |
| -------------------------------------------- | ------------------------------------------------------------------------------- | ------- |
| [architecture.md](architecture.md)           | Crate/module map, event loop, async model, data flow                            | current |
| [controls.md](controls.md)                   | Keyboard shortcuts, mouse controls, and slash commands                          | current |
| [modules.md](modules.md)                     | Crate/module tree with responsibilities                                         | current |
| [providers.md](providers.md)                 | MovieBox, 4KHDHub, BDIX protocols, signing, resolvers, errors                   | current |
| [players.md](players.md)                     | Player detection, mpv/VLC/IINA/AndroidIntent, headers, subtitles, window sizing | current |
| [cache.md](cache.md)                         | Cache layout, namespaces, TTLs, atomic writes, purge                            | current |
| [logging.md](logging.md)                     | File logging, `MOVIEBOX_LOG`, rotation, sanitization, sharing logs              | current |
| [tv-mode.md](tv-mode.md)                     | User-owned M3U playlists, manager, search, playback, config                     | current |
| [addons-mode.md](addons-mode.md)             | Community HTTP addons, Addon Manager, streams aggregation, config               | current |
| [config.md](config.md)                       | `config.json` fields and `MOVIEBOX_*` environment variables                     | current |
| [downloads.md](downloads.md)                 | Download engine: resume, ranges, segments, retry, cancel                        | current |
| [cross-platform.md](cross-platform.md)       | OS support, terminal protocols, Termux, focus handling                          | current |
| [release-checklist.md](release-checklist.md) | Static gates plus required real-environment release verification                | current |
| [testing.md](testing.md)                     | Test architecture, unit/integration tests, fixtures, and QA guidelines           | current |
| [debugging.md](debugging.md)                 | Reproducing issues and what to include in GitHub reports                        | current |
| [known-issues.md](known-issues.md)           | Known limitations and how they are tracked                                      | current |

> Contribution guidance lives in the repository-root `CONTRIBUTING.md` (the canonical
> doc GitHub surfaces for PRs), not in this folder.

> Keep this index accurate: when a behavior change lands, update the matching doc in
> the same change and flip its status to current.
