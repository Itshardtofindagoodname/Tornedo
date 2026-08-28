# TV Mode

TV mode streams live channels from M3U playlists. You add playlists by URL or local
file path, and the app parses, groups, dedupes, and lets you search and play them.

## Entering TV mode

- `Ctrl+T` toggles Streaming / TV mode.
- On first entry with no playlists, the playlist manager opens.
- While in TV mode, type to filter channels by name or group, `Enter` to play,
  `/list` for all channels, `/config` to manage playlists, `[r]` to reload.

## Adding playlists

1. `/config` opens the playlist manager, split into **URL playlists** and
   **File playlists**.
2. Select `[ Add URL ]` or `[ Add file ]`, type the source, `Enter` to add.
   - URL example: `https://example.com/playlist.m3u`
   - File example: `~/playlists/mine.m3u`
3. Sources persist in `tv_config.json` (under the config dir). Local file playlists are
   reread directly on every TV-mode entry; remote URL playlists may reuse a recent
   cached snapshot for up to 24 hours.
4. Highlight a source and press `d` (or `Enter`) to remove it; the list reloads.

## Parsing and search

`src/providers/tv/` parses each source (http(s) or local file), extracting channel id,
name, logo, `group-title`, and stream URL. Channels are **deduped by stream URL**
across all playlists. The search box filters by name or group; the status bar reports
how many channels were imported and which playlists failed.

## Playback

`Enter` on a channel launches the default player with the channel URL (via the same
`launch_player` path as movies). Channel logos are cached under the `iptv` image
namespace.

## Commands in TV mode

- `/list` — display all loaded TV channels.
- `/config` — open the TV Playlist Manager dialog.
- `[r]` key — reload all active M3U playlist sources.
- Global commands (`/theme`, `/download-dir`, `/update`, `/toggle-update`, `/clear-cache`, `/github`, `/enable-tv`, `/disable-tv`, `/enable-streaming`, `/disable-streaming`, `/enable-addons`, `/disable-addons`) are active across all modes.
- Streaming/Addon-only commands (e.g. `/browse`, `/history`, `/enable-bdix`) display friendly guidance notifications prompting you to switch modes (`Ctrl+S` or `Ctrl+A`).
