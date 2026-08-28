# Addon Mode (HTTP Addons)

Addon Mode enables support for community HTTP addon manifests. You can install any standard addon manifest URL to fetch metadata catalogs and aggregate direct HTTP/HTTPS media streams.

## Features

- **Standard Protocol Support**: Compatibility with standard addon manifests (`/manifest.json`, `/catalog`, `/meta`, `/stream`).
- **Core Metadata Protection**: Cinemeta is pre-installed out-of-the-box as the core metadata provider (`[Core]`) and locked to prevent accidental removal.
- **Direct HTTP Stream Engine**: Automatically extracts and filters direct Cloudflare R2, PixelDrain, direct video CDN, and HubCloud/HubDrive HTTP streams.
- **Multi-Addon Concurrency**: Simultaneously queries all enabled stream addons and aggregates releases.
- **Quality & Size Parsing**: Ranks streams by quality (`4K UHD / 2160p`, `1080p`, `720p`, `SD`), file size in GB/MB, and audio language tracks (e.g. `[Dual]`, `[Multi]`, `Hindi + English`).
- **Series & Episode Hierarchy**: Series are automatically organized into explicit `Seasons` and `Episodes` selector panes. Selecting any episode drives episode-specific stream requests (`/stream/series/:id:season:episode.json`).
- **Episode Stream Isolation**: Built-in token parsing (`parse_season_episode`) guarantees that only streams matching the selected season and episode are displayed, eliminating cross-episode stream mixing.
- **Direct Playback & Custom Headers**: Video stream headers (`behaviorHints.headers`) such as `Referer` and `User-Agent` are preserved and forwarded directly to external media players (`mpv`, `IINA`, `VLC`) and the multi-segment downloader.
- **Watch History & Progress Parity**: Full `/history` support in Addon Mode with real-time `mpv` position tracking, scrub lines, and auto-resume.
- **High-Performance Caching**: Curated `/browse` catalogs are cached for `1 hour`, manifests for `24 hours`, and stream aggregations for `2 hours`.

## Entering Addon Mode

- `Ctrl+A`: Toggle / Enter **Addon Mode**.
- `Ctrl+S`: Return to standard **Streaming Mode**.
- `Ctrl+T`: Toggle **TV Mode**.
- `/browse`: Browse curated addon catalogs (`Top Movies`, `Top Series`, `Top Rated Movies`, `Top Rated Series`).
- `/enable-addons`: Enables Addon Mode in configuration and updates the footer navigation.
- `/disable-addons`: Disables Addon Mode in configuration.
- `Ctrl+P` or `/config`: Opens the Addon Manager modal.

## Addon Manager

- Interactive modal listing installed addons with capability badges (`[Core]`, `[Meta]`, `[Streams]`, `[Catalog]`).
- `[x] / [ ]`: Toggle addon enabled/disabled state (`Enter` or `Space`). Core provider remains locked.
- `[ Add Manifest URL ]`: Install any public HTTP addon manifest by URL.
- `[d]` or `[Delete]`: Remove the selected addon (protected for core addons).

## Persistence

Installed addons are atomically saved to `addons_config.json` inside the application config directory (`~/Library/Application Support/moviebox-tui/` on macOS, `~/.config/moviebox-tui/` on Linux, `%APPDATA%\moviebox-tui\` on Windows).
