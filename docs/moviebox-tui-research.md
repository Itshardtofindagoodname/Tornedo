# MovieBox-Tui UX Research Report (for TypeScript/React-Ink reimplementation)

Reference source: `ref/MovieBox-Tui-main/` (Rust, ratatui).
Purpose: reproduce identical UX in TypeScript (React/Ink) at the Tornedo workspace root.
Screenshots: `ref/MovieBox-Tui-main/assets/screenshots/` — 01-home, 02-search-suggestions, 03-search-results, 04-movie-details, 05-series-details, 06-live-tv, 07-stream-mirrors, 08-subtitles, 09-series-seasons-episodes, 10-global-help.

---

## 1. Color Themes & Palettes

**Theme names** (`theme.rs:3` — `AVAILABLE_THEMES`, 9): `Mocha, Latte, Macchiato, Frappe, Nord, TokyoNight, Dracula, Gruvbox, RosePine`.

**Theme struct fields** (`theme.rs:71`) — every theme defines these 34 styles, most are foreground-only RGB colors, `base` is the background RGB, `bg` is usually empty (normal terminal bg), `is_light` bool:
`border, border_focus, text, text_dim, title, highlight, header, error, success, shortcut, overlay, rating, accent, muted, teal, lavender, sapphire, subtext1, base, bg, rosewater, flamingo, maroon, surface0, surface1, surface2, overlay0, overlay1, overlay2, mantle, crust, is_light` (+ `title/highlight/header/accent` get `BOLD`).

**Mocha** (default; dark; Catppuccin Mocha):
- border `#585B70`, border_focus `#89B4FA`, text `#CDD6F4`, text_dim `#A6ADC8`, title `#CBA6F7`, highlight `#89B4FA`, header `#F5C2E7`, error `#F38BA8`, success `#A6E3A1`, shortcut `#FAB387`, overlay `#6C7086`, rating `#F9E2AF`, accent `#89DCEB`, muted `#585B70`, teal `#94E2D5`, lavender `#B4BEFE`, sapphire `#74C7EC`, subtext1 `#BAC2DE`, base `#1E1E2E`, rosewater `#F5E0DC`, flamingo `#F2CDCD`, maroon `#EBA0AC`, surface0 `#38384A`, surface1 `#494A5E`, surface2 `#585B70`, overlay0 `#6C7086`, overlay1 `#7F849C`, overlay2 `#9399B2`, mantle `#181825`, crust `#11111B`.

**Latte** (light): border `#9CA0B0`, focus `#1E66F5`, text `#4C4F69`, dim `#6C6F85`, title `#8839EF`, error `#D20F39`, success `#40A02B`, shortcut `#FE640B`, rating `#DF8E1D`, accent `#179299`, base `#EFF1F5`, surface0 `#CCD0DA`, surface1/overlay `#BCB8CC`/`#9CA0B0`, mantle `#E6E9EF`, crust `#DCE0E8`.

**Macchiato:** base `#242739`, border_focus `#8AADF4`, title `#C6A0F6`, accent `#7DC4E4`, text `#CAD3F5`.
**Frappe:** base `#303446`, focus `#8CAAEE`, title `#CA9EE6`, accent `#81C8BE`, text `#C6D0F5`.
**Nord:** base `#2E3440`, focus `#88C0D0`, title `#B48EAD`, accent `#8FBCBB`, header `#A3BE8C`.
**TokyoNight:** base `#1A1B26`, focus `#7AA2F7`, title `#BB9AF7`, accent `#2AC3DE`, header/shortcut `#FF9E64`.
**Dracula:** base `#282A36`, focus `#BD93F9`, highlight `#8BE9FD`, title `#BD93F9`, header `#FF79C6`, accent `#8BE9FD`.
**Gruvbox:** base `#282828`, focus `#FABD2F`, title `#D3869B`, highlight/accent `#8EC07C`, header `#FE8019`.
**RosePine:** base `#191724`, focus `#C4A7E7`, title `#C4A7E7`, highlight `#9CCFD8`, header `#EBBCBA`, accent `#31748F`.

**Selection / auto theme resolution** (`theme.rs:218` `new()`):
- `MOVIEBOX_THEME` env overrides everything.
- `NO_COLOR` set → monochrome style (`is_light ? Black foreground : White`; dims Gray/DarkGray).
- truecolor detection via `COLORTERM in {truecolor,24bit}` or TERM contains `truecolor|kitty`, or `WT_SESSION` set, or TERM_PROGRAM in `{iTerm.app,Hyper,Tabby,WezTerm,WarpTerminal,vscode,ghostty}` → pick Mocha (dark) or Latte (light).
- `TERM in {dumb,linux,*fbterm}` basic, or apple-terminal without 256, or `TERM==xterm` → `fallback()` (named ANSI colors).
- `TERM` contains `256|xterm|screen` → Mocha/Latte.
- Light-bg detection: `COLORFGBG` / `TERM_BACKGROUND` in `terminal.rs`.
- `TERM_PROGRAM` detection similar in `terminal::uses_basic_ui()`.

The Mocha palette above is the default to reimplement; all 9 palettes follow Catppuccin/Nord/TokyoNight/Dracula/Gruvbox/Rose Pine conventions.

---

## 2. Home Screen Layout

**Screen enum** (`state.rs:6`): `Home`, `Details`. `AppMode` (`streaming/tv/addon`), `InputMode` (`normal/editing`).

**View state machine** (`home.rs:14` `SearchViewState`): `Editing` → `Loading` → `Error` → `Results` → `NoResults` → `Empty`, chosen by:
- Editing if `input_mode == Editing`.
- Adding text / browse preset / homepage tab → Loading.
- `search_error` set → Error.
- `search_results` non-empty → Results.
- non-empty query or browse preset → NoResults.
- else Empty.

**Empty / Landing layout** (`home.rs:379`, vertical constraints 16% / logo / 1 / 1 / 3 / 1 / Min(0) / 1 / 1):
1. Spacer (~16%)
2. ASCII logo (left area with side padding); smaller logo when narrow.
3. spacer
4. **Search bar** (centered width via `search_deck_width`) — placeholder text: `Search movies and series.` (streaming) / `Search live channels.` (TV) / `Search movies and series via addons.` (addon). Focused/editing bar gets higher emphasis style.
5. Favorites landing row (if available + has items): a header `Favorites` + up to 5 latest items, each line `  ★ title` with type tag and a `+N more /favorites` footer; focusable via Down when list empty.

**Results layout** (`home.rs:580`):
- Top: search bar (fixed-ish width, shows `{n} result(s)` status on right).
- Below: single-column list (`Table`, 100% width). Each row height = `poster_rows.max(3)+1`.
- List row layout (horizontal): `[2][poster][1][text]`.
  - Selection indicator: `▌ ` (basic: `> `) in accent color, vertically centered in the 2-wide gutter.
  - Selected row background = `surface0` fill.
  - **Poster** (if images supported): rendered as image via sixel/kitty `Protocol`; placeholder `No\nPoster` centered when absent (text-only mode: fixed 12-wide placeholder). Poster width = `poster_rows*4/3` rounded up, min 6 (text-only 12).
  - **Text block** (centered vertically): line 1 = title (selected uses `title` style else `text`), with `★ ` rating star prefix if favorited (basic: `* `). line 2 = metadata.
- Metadata line (non-history): `★ {imdbRating} • {year} • {genre1 • genre2} • {Type}` where Type in `Movie|Series|TV Channel|Unknown`. IMDb rating pulled from `search_preview` (shown only while selected).
- Metadata line (history view, `/history`): `{Type} • S{02}E{02} • [progress bar] {pct} ({remaining}) • Watched {relative}` or `[✓ Completed]`, then provider name. Progress bar = 8 cells (`accent` filled + `text_dim` empty).
- Vertical scrollbar right side (`▲`/`│`/`█`/`▼`), thumb `█` (basic `|`).
- Loading dots animation: `"" → "." → ".." → "..."` cycling every 4 ticks.

**Home search bar states**: `Loading…` message shown in center when loading with no results; `No results found for "…"` / browse-`No items in this category`; Error falls back to `status_message` then `Search request failed`.

**Search suggestions dropdown** (below bar when editing, max 6): list of text suggestions with `▌ `/`> ` highlight; handles off-by-one at edges; suggestions from `Action::Suggest` → for queries starting with `/` builds `SlashCommand::suggest()` results as payload items with `{title: cmd}` subjects.

---

## 3. Search Results Flow

- Typing a char in normal mode (no modifiers/SHIFT ok) switches to `Editing`, pushes char into `search_query` (`/` clears query first then pushes). Backspace in normal-mode Home also re-enters Editing.
- `Action::Suggest` debounced (in `system.rs`): fires for non-empty queries; builds fake payload for slash commands when query starts with `/`.
- Search only actually runs on **Enter**.
- Providers: `MovieBox, FourKHdHub, BdixCircleFtp, BdixDhakaFlix` (`ProviderKind::ENABLED`) + `Addons`. Label: MovieBox, 4KHDHub, CircleFTP (BDIX), DhakaFlix (BDIX), Addons. `cycle_provider` cycles enabled providers (skip bdix if disabled) in Streaming mode (Ctrl+P).
- Each provider search paginates Cache (LRU providers) + memory `stream_pool`.
- `SearchResult` fields used: `id, title, stype (1=Movie,2=Series,3=TV), release_year, cover_url, provider, season, episode` (`home.rs`), `subject_id`.
- **Prefetch**: on MoveUp/Down/Left/Right, `Action::FetchPreview(id)` fetches selected item's metadata preview used for IMDb/genres line; `prefetch_visible_posters()` pre-fetches poster images for the visible window.
- Paging: `trigger_next_page_if_needed` triggers next page when `selected+8 >= total || offset+visible+4 >= total` (not in TV mode, not loading, not a browse preset, not a `/` query). `current_page` increments. Uses provider cache; Homepage fetch for tabs.
- Search state caches: poster images LRU 300, failed posters 300, poster protocols 300, image_cache 10, preview_cache 30.

---

## 4. Details Screen (movie & series)

**Layout tiers** (`details.rs:14` by area width/height):
- Wide ≥120w&≥24h; Medium ≥80; Narrow ≥60; Tiny. `header_height`: Wide 9–12 (synopsis limit 3, reserved 30), Medium 8–11 (2/24), Narrow 7–9 (2/4), Tiny 4–6 (1/4). `footer_height`: 1 if width≥70 else 2.

**Vertical layout** (`details.rs:95`): `[header][1px workflow strip][Min(5) content][footer]`.

**Header block** (bordered, surface1 border, padding 1–2):
- Poster on left (wide/medium only; width from image aspect `clamp(10,26)` or `height*1.5`, min inner/3); placeholder bordered box `Loading…`/title or `No\nPoster`.
- Title line: `[★ ]Title   ★ IMDb {rating}` (favorited gets star).
- Metadata line: `Type • year • country • duration`, plus for movies a history progress bar `[██████░░] pct% (remaining)` or `[✓ Watched]`.
- Genre, tagline, country lines, then **synopsis** (`description|intro|synopsis|overview`), truncated to synopsis limit; genre from `genre|genres` array/string.
- Title cleaned via `clean_moviebox_title`. Type from `stype` (2=Series else Movie). IMDb from `imdbRatingValue`.
- Poster rendering with sixel/kitty `Protocol`; `show_help` hides image.

**1px workflow strip** — shows current step, e.g. statuses like `Selecting Language…`, streaming setup. (`workflow_area = chunks[1]`.)

**Bottom content** — pane system: `DetailsPane` (`Streams` default, `Seasons`, `Episodes`, `Languages`).
- `cycle_details_pane(forward)` builds ordered pane list: `[Languages]` (only if >1 dub), `[Seasons, Episodes]` (series only), `Streams` (always). Tab = next, Shift-Tab/BackTab = prev.
- Each pane is a titled bordered box, focus shown by `border_focus` style + `▌ ` marker; panes laid horizontally; when focus is on a pane an arrow shows `◀`/`▶` movement; title shows `{pos}/{count}`.
- **Languages** pane: `dubs` array, each entry `subjectId`. Selecting changes language → `FetchDetails`/switch. `language_chosen` tracks.
- **Seasons/Episodes** panes: `available_seasons` (each season JSON with `se` key) + `available_episode_numbers[season_idx]`. Selecting a season resets episode to 0 and `trigger_episode_fetch`. Chosen `(SE,EP)` feeds streams.
- **Streams** pane: the resolved `list` array (mirrors). Each mirror row: index, quality/`Name`, size, codec, language, etc. `resource_list_state`.
- layout tiers control how many panes fit (\`pane_title()\` + position counter).

---

## 5. Playback Flow

- **Players** (`player.rs` PlayerKind): `Mpv, Iina, Vlc, AndroidIntent`; labels `mpv, IINA, VLC, Android Player`. Detection by OS (IINA macOS), mpv/VLC path lookup (Windows/Linux/macOS fallbacks, flatpak `flatpak run …`), Android via termux `termux-open/termux-am`/`am`.
- `PlayerKind::config_key()`: `mpv|iina|vlc|android`. Preferred player remembered in config; `available_players` reordered to put preferred first (`remember_player_preference`).
- **Launch keys** (Details):
  - `Enter` → `PlayStream(open_with=false)` → default player.
  - `Shift+Enter` → `PlayStream(open_with=true)` → `ShowPlayerPicker` (alternative player).
  - `o/O` → `ShowPlayerPicker`. In TV mode `o` on Home also opens player picker.
- **Player picker popup** (overlay `picker()`): title + `{sel}/{n}`, items = available player labels, footer `[↑↓] Move [Enter] Play [Esc] Back`. Choosing validates `supports_headers` (Android rejects all headers; VLC rejects headers beyond Referer/User-Agent; if unsupported shows status "`{player} cannot play this source; choose mpv or IINA.`").
- `supports_headers(kind, headers)`: Android→false; IINA on macOS needs iina-cli; VLC→all headers must be referer/user-agent.
- **Resume/tracking**: mpv/IINA invoked with `--start={seconds}` and a Lua `script=` tracker that writes JSON state (`moviebox_state_file`). `WatchHistoryItem` built by `build_watch_history_item()` (cleans title, cover url, year, duration); `MarkWatched` / `UpdateProgress` / `PlayerCrashed` / `PlayerExited` actions; `ReconcileHistory` reconciles on exit. Progress %age and `formatted_remaining()` shown.
- Commands (mpv): `--autofit=WxH`, `--geometry=50%:50%`, `--idle=no --keep-open=no`, `--start=`, `--http-header-fields=name1: v1,name2: v2`, `--sub-file=`, url. VLC: `--width --height --play-and-exit --start-time --http-referrer --http-user-agent --sub-file`. IINA wraps mpv args (`--mpv-…` prefix) via iina-cli or `open -a IINA`.
- **Launch flow**: `resolve` stream → optional subtitle picker → `LaunchMpv(link, sub)` or `LaunchPlayer/LaunchPlayback`. `preferred_playback_player()` = first player supporting the source headers.
- is_loading / is_resolving_playback / is_playing flags; `GlobalHelp`.
- Subtitles: `ShowSubtitlePopup(link, meta, open_with)` → picker of `caption_options`; selected language remembered (`last_download_subtitle_language`).
- `LaunchPlayback(player, PlaybackSource)` used when resolved via ShowPlaybackPicker for header-bearing sources.

---

## 6. Download Flow

- **Keys (Details)**: `d/D` → if Streams pane `PromptDownloadEpisode` else if Seasons pane (has seasons) `PromptDownloadSeason`. On Home `d` not bound (favorites `*`, history `f`).
- **Confirmation popup** (`overlay::confirmation`): centered, title e.g. `Confirm Download`, body 1-2 lines, two pill buttons ` Download ` / ` Cancel ` (selected = `selection_style` fill), footer `[←→] Choose [Enter] Confirm [Esc] Back`. Toggled by Left/Right (`season_download_confirm_yes_selected` / `episode_download_confirm_yes_selected`), Enter confirms (or cancel), `y`/`Y` = yes, `n`/`N`=no, Esc cancels.
- **Batch**: `download_queue` (VecDeque of `(season,episode)`) + `download_queue_total`. `PromptDownloadEpisode` → subtitle picker (`is_download_subtitle_popup`) → selected language → `DownloadStream`; for series, `season_subtitle_preference` set once.
- **Resolution gate** (`download.rs`): `start_resilient_download()` blocks if a download already in progress or not on Details screen; waits on `is_fetching_streams` with notifications `Preparing download` / `Waiting for stream details`; status `Loading streams…`. If no stream → notification/status warning.
- **Base dir**: `resolve_download_base_dir()` (config `download_dir` or default), subdir by provider; `/download-dir <path>` sets it; `/download-dir reset` restores default.
- Renders bottom **progress bar** while `download_progress: Some(f64)`, `download_status: Option<String>`; cancel `x`/`X` sends `CancelDownload` (`cancel_download` atomic + `download_progress=None`). Clearing when done.
- Status notifications: `INFO/SUCCESS/WARNING/ERROR` colored toasts (see §8).

---

## 7. Favorites

- **Types**: `FavoritesManager`, `FavoriteItem { provider, subject_id, title, stype, release_year, added_at }` sorted newest-first on landing, truncate 5.
- **Toggle**: Home `*` → `Action::ToggleFavorite`; Details `f`/`F` → `ToggleFavorite` (blocked while overlays/confirm popups open and only if `favorites_available()`).
- **Favorite identity**: `SubjectIdentity { provider: <cache_key>, subject_id, title, stype, release_year }`. Home build uses result title/stype/release_year; Details build uses cleaned title / `stype()` / year.
- **Landing**: Home empty view shows `Favorites` header + up to 5 items + `+N more /favorites`. Navigator: when home list empty or pressing Down at end of empty results, `favorites_focus=true` and selection enters favorites landing; `*`-starred rows, type tag; Enter opens favorite.
- **Command**: `/favorites` → `Action::ShowFavorites` (only available in streaming/addon modes, not TV).

---

## 8. Overlays / Notifications / Status Bar / Footer

**Notifications** (`overlay.rs`): top-right toasts, max 3 (drops oldest non-error). Card: badge `INFO/SUCCESS/WARNING/ERROR` (sapphire/success/rating/error) in bordered title + up to 4 wrapped message lines; width `clamp(36,72)`; `expired()` after time; `expire_notifications()` prunes each tick. Rendered stacked above bottom, newest on top. Notification struct: `{ kind, title, message }`, auto-dedupe when message==title (message omitted).

**Status bar message**: `state.status_message` + `status_timer` (ticks remaining). `set_status(msg, timer)`; decremented each tick, cleared at 0. Shown in the 1px workflow strip on Details and as search-error fallback on Home. Examples: "Search cleared.", "Select a movie/series and press Enter", "Loading details for …", "Loading streams…", "x selected. Search uses only this provider.", "TV Mode is disabled. Use /enable-tv to enable."

**Popups / pickers** (`picker()`): centered `popup` sized by content `clamp(min_width,max=64)`; Rounded (Plain in basic); title ` {title} · {sel}/{n} ` lavender border. Rows highlighted with `▌ `/`> `; vertical scrollbar when overflow; footer `[↑↓] Move [Enter] {label} [Esc] Back` (footer key hints = `[key] action` dim; Download→`Save` when narrow). Used by: player picker, subtitle picker (incl. download), theme picker, browse picker, addon catalog picker, TV/Addon managers.

**Modals**: `confirmation()` (download confirm); `update_modal_layout` for the self-update modal (buttons `Update` / `Open / …`, computes hitboxes) with `Update`/`Open`/`Esc`; `notifications` toasts. `centered()` centers anywhere within bounds. `clear_modal_area` clears a halo around popup.

**Help overlay** (`help.rs`): popup titled ` Help · {mode} `, bordered by `border_focus`. If content exceeds available height → auto two-column layout (50/50). Sections and keys (see §9).

**Basic terminal mode** (`terminal.rs`): `TERM in {dumb,linux,*fbterm}` or apple-without-256 → `usable_basic_ui()`; affects border style (Plain), selection highlight (`UNDERLINED` + `> ` instead of fill + `▌`), poster placeholders, star glyphs (`* ` vs `★ `), scrollbar thumb `|`.

---

## 9. Full Keybindings

### Global / Control (`keyboard.rs` handle_key)
- `Ctrl+C` → `Quit`.
- `Ctrl+T` → `ToggleTvMode` (if tv_enabled; else status "TV Mode is disabled. Use /enable-tv to enable.").
- `Ctrl+A` → `ToggleAddonMode` (if addons_enabled; else similar).
- `Ctrl+S` → `SwitchToStreamingMode` (status "Already in Streaming Mode." if already; disabled message otherwise).
- `Ctrl+P` → TV: notify "Provider cycling is only available in Streaming Mode."; Addon: `ShowAddonManager`; Streaming: `cycle_provider`.
- `x`/`X` (when `download_progress.is_some()` and not editing, not tv_input) → `CancelDownload`.
- Update-available modal: `u`/`U` → `StartSelfUpdate`, `o`/`O` → open GitHub release URL, `Esc` → dismiss.

### Home — Normal mode
- `Esc` → `GoBack` (clears search when empty or `/` query).
- `↑`/`↓` → MoveUp/MoveDown (list scroll; triggers preview fetch + poster prefetch; Down at end triggers next page).
- `←`/`→` → MoveLeft/MoveRight (page jump by `visible_items`).
- `Enter` → Submit (or force-refresh if query non-empty & no results).
- `?` → ToggleHelp. `q` → Quit.
- `r` → Refresh (TV: `TvReloadPlaylists`).
- `o`/`O` (TV mode) → ShowPlayerPicker on selected channel.
- `*` (if favorites_available) → ToggleFavorite.
- Any char / letter (no ctrl) → enter Editing, push char.
- Backspace → re-enter Editing (with search bar focusing).

### Home — Editing mode
- `Esc` → back to Normal (clears query if empty or `/`-prefixed; else keeps query).
- `Enter` → run search; if single unique slash suggestion, auto-expand to it; `/history` exact is preserved as a view query; other `/` commands are executed + query cleared.
- `Tab` → slash-command autocomplete (fills first/selected suggestion).
- `Backspace` → delete last grapheme. `Char` → insert (multi-byte safe).
- `↑`/`↓` (when suggestions) → cycle suggestion index.

### Browse popup / Theme popup
- `Esc` close (theme: reverts to `original_theme_kind`), `↑`/`↓` cycle, `Enter` select (theme: persist). Theme list = `AVAILABLE_THEMES`.

### Details — Normal mode
- `Tab` / `Shift-Tab` → cycle next/prev details pane.
- `Enter` → Streams: play default (open_with=false); Seasons/Episodes: fetch episode streams; Languages: select language.
- `Shift+Enter` → play with alternative player picker.
- `Esc` → GoBack (to Home; clears details state & resets lists). `b` → GoBack. `q` → Quit. `?` → help.
- `o`/`O` → `PlayStream(true)` (player picker) — only when Streams pane, no subtitle/picker open.
- `d`/`D` → `PromptDownloadSeason` (Seasons pane, has seasons) else `PromptDownloadEpisode`.
- `y`/`Y` confirm download confirm; `n`/`N` deny; `←`/`→` move Download/Cancel pill in confirm.
- `r` → Refresh streams/results.
- `f`/`F` → ToggleFavorite (blocked during overlays/confirmations).
- `↑`/`↓` → navigate the focused pane list.

### TV Mode-specific
- `Enter` play channel; `o` player picker; `r` reload playlists; `/config` manage M3U; `/list` show all channels; `Ctrl+P` notification.

### Addon Mode
- `Ctrl+P` → Addons Manager; `Enter` select/play; `o` player picker; `d` download; `*` favorite (home); `f` favorite (details); `/favorites`; `/browse`; `/config`; `r` refresh.

---

## 10. Slash Commands (`commands.rs`)

19 commands: `SlashCommand` enum + `ParsedCommand` (`DownloadDir(&'a str)` carries arg).

| Command | Description (tooltip) | Available |
|---|---|---|
| `/browse` | Curated, rated & most-watched views | streaming or addon mode |
| `/history` | Watch history | streaming or addon mode |
| `/favorites` | Starred titles | `favorites_available()` (not TV) |
| `/list` | Show all TV channels | tv_enabled & TV mode |
| `/config` | Configure IPTV playlists / HTTP addons | TV or addon mode |
| `/download-dir [path]` | View or change download folder; `reset` | always |
| `/theme` | Theme picker | always |
| `/update` | Check for newer release | always |
| `/toggle-update` | Toggle automatic update checks | always |
| `/clear-cache` | Clear cached data | always |
| `/github` | Open project repository | always |
| `/enable-bdix` | Enable BDIX FTP sources | streaming mode, bdix off |
| `/disable-bdix` | Disable BDIX FTP sources | streaming mode, bdix on |
| `/enable-streaming` / `/disable-streaming` | enable/disable streaming nav | !enabled / enabled |
| `/enable-tv` / `/disable-tv` | enable/disable TV nav | !enabled / enabled |
| `/enable-addons` / `/disable-addons` | enable/disable addon nav | !enabled / enabled |

**Command parsing** (`parse`): trim; must start with `/`; split on first whitespace; match case-insensitive exact name → `ParsedCommand` (unknown → None). `DownloadDir(arg)` captured. `DownloadDir` accepts an arbitrary path argument; special suggestion `"/download-dir reset"` (only shown when a custom dir is set).

**Suggestion engine** (`suggest`): prefix-match against all available commands (case-insensitive); includes `/download-dir reset` sub-suggestion; `Tab` and unique-match auto-complete.

**Submission side-effects** (`app/search.rs`): `/browse` → `ShowBrowseMenu`; `/history` → sets `is_homepage_mode`/filters; `/favorites` → `ShowFavorites`; `/config` → `ShowTvConfig` (TV) or `ShowAddonManager` (addon); `/download-dir [path]` → sets or shows dir; `/theme` → `ToggleThemePopup`; `/update` → `CheckForUpdates`; `/toggle-update` → toggles config; `/clear-cache` → `ClearCache`; `/github` → `open::that(repo)`; enable/disable → config flags re-evaluated (`force streaming_enabled` if all modes off).

---

## 11. Command / Key Parsing & State Fields

### Key parsing (`keyboard.rs`, `event.rs`)
- `crossterm::event::KeyEvent { code, modifiers }`; `KeyModifiers::{CONTROL,SHIFT,NONE}`.
- Control handled first (`Ctrl+c/t/a/s/p`, plus char+shift for letters). Then popups → editing → normal (by screen).
- `BackTab` = Shift+Tab. `Enter modifiers` checks SHIFT for `open_with`.
- Editing char insert accepts non-control chars (multi-byte via `push`/`remove_last_grapheme`). Addon input uses explicit `addon_input_cursor` (Left/Right/Backspace/Delete/insert at cursor).
- Mouse: `Action::MouseClick(x,y)` handled in `mouse.rs` (click list rows / update modal buttons via computed hitboxes).

### Command enum (`action.rs`, 60+ variants)
`FocusChange, ShowPlayerPicker, ShowPlaybackPicker, LaunchPlayer, Tick, Key, MouseClick, Quit, GoBack, SelectLanguage, Resize, ToggleHelp, ToggleTvMode, ToggleAddonMode, SwitchToStreamingMode, SwitchProvider, ShowTvConfig, TvChannelsLoaded, TvPlaylistAdd/Remove, TvReloadPlaylists, TvInputToggle, ShowAddonManager, AddonAddManifest, AddonToggleEnabled, AddonRemove, AddonInputToggle, Search, SelectSuggestion, SearchSuccess, SearchFailure, FetchHomepage, HomepageSuccess/Failure, Suggest, SuggestSuccess, MoveUp/Down/Left/Right, Submit, TabPane, BackTabPane, FetchPreview, PreviewSuccess/Failure, PlayStream, ShowSubtitlePopup, ShowDownloadSubtitlePopup, ToggleThemePopup, SelectTheme, ShowBrowseMenu, SelectBrowse, SelectAddonCatalog, LaunchMpv, DownloadStream, StartDownload, UpdateDownload, DownloadCompleted/Failed/Paused, ClearDownload, CancelDownload, PromptDownloadEpisode, ConfirmDownloadEpisode, PromptDownloadSeason, ConfirmDownloadSeason, ProcessDownloadQueue, FetchDetails, DetailsSuccess/Failure, InitStreamPool, StreamPoolInitialized, FetchEpisodeStreams, EpisodeStreamsReady/Failed, PosterSuccess, SearchPosterLoaded, UpdateAvailable, CheckForUpdates, StartSelfUpdate, SelfUpdateProgress/Complete, SetStatus, Refresh, ClearCache, CacheCleared, LaunchPlayback, MarkWatched, UpdateProgress, ReconcileHistory, PlayerCrashed, PlayerExited, ToggleFavorite, ShowFavorites, OpenFavorite.`

### AppState key fields (`state.rs`)
- **Screen/nav**: `active_screen`, `active_provider`, `provider_generation`, `dirty`, `input_mode`, `active_theme_kind`, `original_theme_kind`, `show_theme_popup`, `theme_list_state`, `basic_terminal`, `visible_items`.
- **Search**: `search_query`, `last_suggest_query`, `last_search_edit`, `search_suggestions`, `suggest_index`, `search_results`, `search_error`, `is_homepage_mode`, `current_tab_id`, `current_page`, caches (`search_posters` 300, `failed_posters` 300, `search_poster_protocols` 300, `in_flight_posters`), `search_list_state` (TableState), `search_preview`, `preview_loading`, `is_loading`.
- **Details**: `selected_details` (JSON), `active_subject_id`, `selected_resources`, `stream_pool` (map id→`SubjectStreamPool` {episode_index}), `fetch_cancel`, `details_pane`, `selected_season/episode`, list states (season/episode/language/resource), `available_seasons`, `available_episode_numbers`, `language_chosen`, `is_fetching_streams`, `stream_error`, `pending_episode_fetch`, `last_episode_nav`, preview caches.
- **Posters/images**: `poster_image`, `poster_protocol`, `image_picker`, `image_supported`, `clear_terminal_before_draw`, `poster_rows` (default 3), `image_cache` 10.
- **Async request ids (generation counter)**: `active_resource/search/homepage/details/preview/suggest_request`, `last_resize_time`.
- **Playback**: `player_picker_popup`, `player_picker_state/link/subtitle/playback`, `available_players`, `default_player`, `is_resolving_playback`, `is_playing`, `last_playback_launch`.
- **Status/UI**: `status_message`, `status_timer`, `notifications` (VecDeque max 3), `tick_count`, `loading_dots()` (`tick/4 %4`).
- **Update**: `update_available`, `auto_update`, `last_update_check`, `manual_update_check`, `is_checking_updates`, `is_updating`, `update_release`.
- **Download**: `download_progress`, `download_status`, `cancel_download`, `download_dir`, `download_queue`, `download_queue_total`, `show_season/episode_download_confirm`, `yes_selected` flags, `is_waiting_for_download_stream`, subtitle-pref state.
- **Modes/flags**: `bdix_enabled`, `streaming_enabled`, `is_tv_mode`, `tv_enabled`, `tv_config_popup`, `tv_channels`, `tv_playlists`, `tv_manager_selected`, `tv_input_active/buffer/is_file`; `is_addon_mode`, `addons_enabled`, `installed_addons`, `addon_manager_popup/selected/input_*`.
- **Persistence**: `history` (HistoryManager), `favorites` (FavoritesManager), `favorites_focus`, `favorites_landing_state`.

### Draw loop (`run.rs`, `system.rs`, `tui/mod.rs`)
- Main loop: read event (key/mouse/resize/tick/proc-exit), map → `Action`, dispatch to handlers (`handle_key`, `handle_navigation`, `handle_search/system/requests…`), then `draw`.
- `draw` order (in `run.rs`/`home.rs`/`details.rs`): Home → `render_search_state`/list + overlays; Details → header + panes; then top-right `notifications()`, popups/help/update modal last (on top).
- Resize: 300ms debounce → `clear_terminal_before_draw`, clears poster protocol caches, re-derives `poster_rows = ceil(96/cell_h).max(3)`.
- Tick: redraw on loading or every `<15`s; `expire_notifications`, `status_timer` decrement; poster background fetch; suggest debounce.
- Provider switch resets mode state/query/posters and re-runs search if a non-slash query is present.

---

### Screenshot map (assets/screenshots/*.jpg)
01 home landing (logo+search+favorites), 02 search suggestions dropdown, 03 search results list w/ posters, 04 movie details (poster+IMDb+synopsis+panes), 05 series details (seasons/episodes), 06 live TV mode, 07 stream mirrors pane, 08 subtitle picker popup, 09 series seasons/episodes panes, 10 global help overlay.
