# Downloads

The download engine in `download.rs` streams a video URL to disk with resume, ranges,
and optional segmentation. Orchestration lives in `app/download.rs`.

## How it works

- Single-episode downloads write to `<dest>.part` plus a `<dest>.part.json` metadata
  sidecar (etag, last-modified, total size, segment count).
- **Resume**: on a retry, the engine checks what is already in the `.part` file and
  continues from there using `Range` requests.
- **Segmentation**: files above a size threshold can be downloaded in parallel
  segments (up to a capped count), then stitched.
- **Retries**: a failed attempt is retried a limited number of times; 30s idle
  timeouts apply to streaming reads.
- **Cancel**: an `AtomicBool` cancel flag pauses/resumes cleanly, preserving the
  partial file for a later resume.

## File names and directories

`safe_file_stem` sanitizes titles for all platforms: control/whitespace/illegal
characters are replaced, Windows reserved names (`CON`, `COM1`-`COM9`, …) are avoided,
and length is capped.

- **Series downloads:** Saved under `<base_dir>/Series/<Title>/Season <N>/<Title> - S<N:02>E<E:02>.<ext>` (and subtitle `<Title> - S<N:02>E<E:02>.<lang>.<sub_ext>`).
- **Movie downloads:** Saved under `<base_dir>/Movies/<Title>/<Title>.<ext>` (and subtitle `<Title>.<lang>.<sub_ext>`).
- **Default path:** Files go to the user's OS download directory (`~/Downloads/MovieBox-TUI`). On Android-family environments the code prefers shared `storage/downloads` when present.
- **Custom path:** Users can set a custom download directory using `/download-dir <path>` or revert with `/download-dir reset`. Target directories are validated with a write probe before saving, and the code creates the `MovieBox-TUI` subfolder hierarchy (`Movies/` and `Series/`). If custom storage becomes unavailable at runtime, the engine falls back to the default download location.

## Contextual triggers & Seasons

- **Contextual trigger**: Pressing `d` (or clicking `[Download]`) while focused on the **Seasons** pane prompts to download all episodes of the selected season. Triggering download while on the **Episodes** or **Streams** pane prompts to download only that single episode.
- **Duplication prevention**: When starting a download or processing a season batch queue, the engine checks if the target media file is already completed on disk. Existing completed episodes are skipped.
- A season download enqueues every episode (`download_queue`) and processes them one at a time, each resolving its stream and subtitle. Progress is reported through `Action::UpdateDownload` and the status bar; failures pause and preserve partial data.
- Season downloads ask for the subtitle policy once per batch. The selected language, including an explicit `None` choice, is reused for every queued episode.

Selected subtitle sidecars are saved next to the video using ISO 639-1 language codes (e.g. `.en.srt`, `.hi.srt`) and supported subtitle extensions (`.srt`, `.vtt`, `.ass`, `.ssa`, `.sub`).

## Outcomes

`DownloadCompleted` / `DownloadPaused` / `DownloadFailed` drive the UI status and
notifications. `ClearCache` and stale-file cleanup do not touch in-progress downloads.
