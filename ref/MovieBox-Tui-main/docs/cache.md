# Cache

Disk caching lives in `cache.rs`; in-memory caches live in `AppState`.

## Disk layout

```
<cache dir>/moviebox-tui/
  <provider>/            moviebox, fourkhdhub, bdix_circleftp, bdix_dhakaflix, addons
    search/<hash>_<page>.json
    details/details_<hash>.json
    streams/v3_<hash>_<season>_<episode>.json   (v3_ prefix only for 4KHD)
    images/<md5>.img
  moviebox/
    homepage/<tab>_<page>.json
    captions/captions_<hash>.json
  addons/
    catalogs/catalog_<hash>.json
    manifests/manifest_<hash>.json
    streams/<hash>_<season>_<episode>.json
  tv_playlists/<md5>.m3u       cached remote playlist snapshots
```

The cache directory is `dirs::cache_dir()/moviebox-tui` (macOS
`~/Library/Caches`, Windows `%LOCALAPPDATA%`, Linux `$XDG_CACHE_HOME`).

## Properties

- **Provider namespacing**: keys include `provider.cache_key()`, so results from
  different providers never collide. Image caches are namespaced by provider (or
  `iptv` for channel logos) with fallback resolution across `posters`, `moviebox`,
  `fourkhdhub`, `iptv`, `circleftp`, `dhakaflix`, and `addons`.
- **TTL**: streams expire after 2h; search/details/captions/manifests after 24h;
  homepage/catalogs after 1h; remote TV playlist snapshots after 24h; images after 30 days
  (`IMAGE_CACHE_EXPIRY_SECS`). Local file playlists are reread directly instead of
  being served from the cache.
- **Atomic writes**: data is written to a temp file then renamed, so a crash never
  leaves a corrupt cache entry.
- **Validation**: search/stream entries are only cached (and only served) if they
  contain real results, so empty responses are never reused.
- **Purge**: `clean_old_cache_background` (startup) deletes entries older than 7 days.
  `ClearCache` (`/clear-cache`) removes the whole cache tree, the legacy
  `data_dir/moviebox-tui/iptv_cache` directory, and resets the in-memory caches so the
  next fetch is genuinely fresh.

## In-memory caches (AppState)

- `image_cache` (30), `search_posters` (300), `failed_posters` (300),
  `search_poster_protocols` (300), `preview_cache` (30): `lru::LruCache` for poster
  images, negative lookup cache, and terminal image protocols; `stream_pool`:
  resolved streams per subject.

All disk access in async code is wrapped in `tokio::task::spawn_blocking` so the event
loop never blocks. Failures are logged (see [logging.md](logging.md)) and treated as
cache misses.
