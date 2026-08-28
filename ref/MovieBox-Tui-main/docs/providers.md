# Providers

MovieBox-Tui aggregates several movie/stream providers plus user M3U playlists. Each
provider is an independent async client exposing a similar shape, normalized into the
shared typed models in `providers/models.rs` and the moviebox JSON schema used by the UI.

## Provider kinds

| Kind            | Module                     | Notes                                       |
| --------------- | -------------------------- | ------------------------------------------- |
| `MovieBox`      | `providers/moviebox`       | Primary. Requires request signing (crypto). |
| `FourKHdHub`    | `providers/fourkhdhub`     | 4K releases; hubcloud mirror resolver.      |
| `BdixCircleFtp` | `providers/bdix/circleftp` | BDIX FTP directory scrapes.                 |
| `BdixDhakaFlix` | `providers/bdix/dhakaflix` | BDIX indexer.                               |
| `Addons`        | `providers/addons`         | Community HTTP addons (Cinemeta, streams).  |

BDIX sources are only reachable from supported Bangladeshi ISPs and are hidden by
default (`bdix_enabled` in config; `/enable-bdix`).

## Shared flow

Search, details, and episode-streams are dispatched per provider. Pluggable provider seams
in `providers/mod.rs` give every client a shared async trait shape:

- `Provider::id(&self) -> ProviderKind`: Returns the provider's unique identifier.
- `Provider::capabilities(&self) -> ProviderCapabilities`: Reports supported capabilities (`supports_search`, `supports_pagination`, `supports_series`, `supports_subtitles`, `supports_homepage`).
- `Provider::search` / `Provider::details`: Dispatches search and metadata queries. MovieBox provides it natively; other providers adapt typed models (`MediaDetails`) via adapters.
- `ReleaseProvider::episode_streams`: Returns the typed `Release` list for release-based providers; MovieBox keeps its own paginated resource path.
- `ProviderError`: Standardized error boundary (`Network`, `RateLimited`, `NotFound`, `Parsing`, `Unavailable`) with `.user_message(provider)` generating clean UI toast notifications.

Playback resolves to a `PlaybackSource { provider, url, headers, subtitle, source_label }`,
which `app/playback.rs::launch_player` feeds to the external player.

## MovieBox

- Base host pool + per-request HMAC-MD5 signature, client token, and a spoofed Android
  device identity (`crypto.rs`) to satisfy the anti-bot gateway.
- Hosts are retried; a shared runtime token is re-initialized when all hosts fail.
- Title normalization lives in `moviebox/title.rs` (`clean_moviebox_title`).

## 4KHDHub

- `client.rs::resolve_release` walks the release's mirrors; each candidate goes through
  `preflight` which validates the URL and issues an **open-range** probe
  (`Range: bytes=0-`) so probe-only trap mirrors (which answer a tiny bounded range but
  refuse real streaming) are rejected. The 4KHD referer and a browser user-agent are
  attached so referer-gated CDNs stream in the player too.
- `hubcloud.rs` resolves hubcloud/hubdrive pages into candidate playable links and
  selects a mirror by score.
- **Multilingual audio detection**: `parser.rs::detect_language` parses release titles and
  metadata for 30+ regional and international languages (Hindi, Tamil, Telugu, Kannada,
  Malayalam, Bengali, Marathi, Punjabi, Gujarati, Urdu, Japanese, Korean, Chinese, Spanish,
  French, German, Italian, etc.) and formats all available audio tracks for stream display.
- Errors are surfaced as `FourKHdHubError`; mirror rejections and the final failure
  reason are logged with the mirror label and a sanitized URL.

## BDIX

- `circleftp` and `dhakaflix` scrape FTP-style indexes; both are used behind the
  Bangladesh-only gate.

## Community HTTP Addons

- `providers/addons` communicates with HTTP addon manifests (`/manifest.json`).
- Cinemeta provides catalog searches and metadata details (`/catalog`, `/meta`).
- Stream addons (e.g. HdHub, direct CDN manifests) resolve playable HTTP/HTTPS streams concurrently. See [addons-mode.md](addons-mode.md).

## M3U playlists (TV mode)

`providers/tv` parses an M3U playlist from an `https://` URL or a local file path.
Each channel yields `{ id, name, logo, group, stream_url }`; TV mode groups channels by
`group-title` and dedupes by `stream_url`. See [tv-mode.md](tv-mode.md).

## Error handling

Each provider defines its own `thiserror` enum (`ScraperError`, `FourKHdHubError`,
`CircleFtpError`, `DhakaFlixError`). Errors bubble to `app/requests.rs` handlers, which
surface them in the UI status bar and log the full detail (see [logging.md](logging.md)).
