/**
 * TornedoApp: the Ink application root. Owns all UI/navigation state, subscribes
 * to the search session and download manager, and translates every keypress
 * into a logical action. The views below it are purely presentational.
 *
 * Navigation model:
 *   1 Search · 2 Downloads · 3 Sources · 4 Settings
 *   ? help · esc back/close · q quit · ctrl+c quit safely
 */
import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize, type Key } from "ink";
import { spawn } from "node:child_process";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Application } from "../app/application.js";
import { MAX_RECENT_SEARCHES } from "../app/application.js";
import type { SearchSession, SourceReport } from "../app/search-service.js";
import type { DownloadAction, KeyAction } from "../config/config.js";
import { MEDIA_CATEGORIES, type MediaCategory } from "../model/search.js";
import type { Release } from "../model/search.js";
import type { TorrentFileInfo, TorrentItem } from "../model/torrent.js";
import type { Favorite } from "../stream/favorites.js";
import { StreamCatalogItem, StreamDetails, StreamRelease, StreamSubtitleOption } from "../stream/models.js";
import { WatchSearchSession } from "../stream/session.js";
import { StreamDownloader, type DownloadProgress } from "../stream/download.js";
import { readTrackerState } from "../stream/history.js";
import { detectPlayers, pickPlayer, spawnPlayer, writeTrackerScript } from "../stream/players.js";
import {
  parseFilterText,
  SORT_OPTIONS,
  type ReleaseFilter,
  type SortOption,
} from "../results/filter.js";
import { truncate } from "../utils/duration.js";
import {
  Confirm,
  Footer,
  Header,
  Modal,
  SelectList,
  SearchInput,
  Toast,
  type HintItem,
  type Section,
  type SelectOption,
} from "./components.js";
import { DetailView } from "./DetailView.js";
import { DownloadsView } from "./DownloadsView.js";
import { HelpView } from "./HelpView.js";
import { useManagerEvents, useRecovery, useRerenderInterval, useSearchSession, useWatchSession } from "./hooks.js";
import { firstKey, matchKey } from "./keys.js";
import { filteredReleases, ResultsView } from "./ResultsView.js";
import { SearchHome } from "./SearchHome.js";
import { SettingsView, type SettingsRow } from "./SettingsView.js";
import { SourcesView } from "./SourcesView.js";
import { applyTheme, currentThemeName, THEME_CHOICES } from "./theme.js";
import { palette } from "./theme.js";
import { applyTyping } from "./text.js";
import { WatchDetails, flattenEpisodes, type WatchDownloadState } from "./WatchDetails.js";
import { WatchResults } from "./WatchResults.js";

type View = "home" | "results" | "details" | "downloads" | "sources" | "settings" | "help" | "watch" | "watchdetails";

type Overlay =
  | { kind: "prompt"; title: string; hint?: string; onSubmit: (value: string) => void }
  | { kind: "select"; title: string; options: SelectOption<string>[]; hint?: string; onPick: (value: string) => void }
  | { kind: "confirm"; prompt: string; onConfirm: () => void };

export interface TornedoAppProps {
  app: Application;
}

const PAGE_STEP = 10;

export function TornedoApp({ app }: TornedoAppProps): React.ReactNode {
  const { exit } = useApp();
  const { rows, columns } = useWindowSize();
  const wide = columns >= 120;
  const compact = columns < 64;

  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [recentQueries, setRecentQueries] = useState<string[]>(() => [...app.recentSearches()].slice(0, MAX_RECENT_SEARCHES));
  const [recentIndex, setRecentIndex] = useState(0);
  const [recentActive, setRecentActive] = useState(false);
  const [selected, setSelected] = useState(0);
  const [selectedDownload, setSelectedDownload] = useState(0);
  const [sourcesSelected, setSourcesSelected] = useState(0);
  const [settingsSelectedId, setSettingsSelectedId] = useState("");
  const [downloadDiagnostics, setDownloadDiagnostics] = useState(false);
  const [filter, setFilter] = useState("");
  const [session, setSession] = useState<SearchSession | null>(null);

  // --- watch (streaming) state -------------------------------------------------
  const [searchAction, setSearchAction] = useState<DownloadAction>(() => app.getConfig().searchAction);
  const [watchSession, setWatchSession] = useState<WatchSearchSession | null>(null);
  const [watchDetails, setWatchDetails] = useState<{ item: StreamCatalogItem } | null>(null);
  const [watchMeta, setWatchMeta] = useState<{ details: StreamDetails | null; loading: boolean; error: string | null }>({ details: null, loading: false, error: null });
  const [watchSeason, setWatchSeason] = useState(0);
  const [watchEpisode, setWatchEpisode] = useState(0);
  const [watchPane, setWatchPane] = useState<"episodes" | "streams">("streams");
  const [watchPaneCursor, setWatchPaneCursor] = useState(0);
  const [watchReleases, setWatchReleases] = useState<{
    releases: StreamRelease[];
    subtitles: StreamSubtitleOption[];
    resolutions: string[];
    loading: boolean;
    error: string | null;
    notice: string | null;
  }>({ releases: [], subtitles: [], resolutions: [], loading: false, error: null, notice: null });
  const [watchResolution, setWatchResolution] = useState("");
  const [watchSubtitle, setWatchSubtitle] = useState<string | undefined>(undefined);
  const [watchDownload, setWatchDownload] = useState<WatchDownloadState | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<string | null>(null);
  const [watchIsFav, setWatchIsFav] = useState(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [themeTick, setThemeTick] = useState(0);

  // --- refinement state -----------------------------------------------------
  const [sortOption, setSortOption] = useState<SortOption>(SORT_OPTIONS[0]!);
  const [categoryScope, setCategoryScope] = useState<MediaCategory | null>(null);
  const [releaseFilter, setReleaseFilter] = useState<ReleaseFilter>({});
  const [filterText, setFilterText] = useState("");

  // --- overlay state ---------------------------------------------------------
  const [overlay, setOverlay] = useState<Overlay | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptCursor, setPromptCursor] = useState(0);
  const [overlaySelect, setOverlaySelect] = useState(0);
  const [overlayYes, setOverlayYes] = useState(false);

  // --- file-selection state (details view, default) ---------------------------
  // Opening a release's details auto-resolves its file list; the user toggles
  // the checkbox list right there (space / a / n) and commits with download.
  const [detailsFilesId, setDetailsFilesId] = useState<string | null>(null);
  const [detailsFilesCreated, setDetailsFilesCreated] = useState(false);
  const [fileCursor, setFileCursor] = useState(0);
  const [fileChecks, setFileChecks] = useState<ReadonlySet<string>>(new Set());
  const fileChecksInitId = useRef<string | null>(null);

  const [message, setMessage] = useState<string | null>(null);

  const prevView = useRef<View>("home");
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useRerenderInterval(250);
  useSearchSession(session);
  useWatchSession(watchSession);
  useManagerEvents(app);
  const recovery = useRecovery(app);

  // Boot: apply the configured theme and load watch favorites once.
  useEffect(() => {
    applyTheme(app.getConfig().theme);
    if (app.favorites !== undefined && typeof app.favorites.list === "function") {
      void app.favorites.list().then(setFavorites).catch(() => undefined);
    }
  }, [app]);

  // Cancel any running search when the app tears down (or a newer one starts).
  useEffect(() => {
    if (!session) return;
    return () => session.cancel();
  }, [session]);

  const showMessage = (m: string): void => {
    setMessage(m);
    if (messageTimer.current) clearTimeout(messageTimer.current);
    messageTimer.current = setTimeout(() => setMessage(null), 5000);
  };

  // Pre-warm torrent playback so the player window opens the instant `enter` is
  // pressed (like MovieBox-Tui). The WebTorrent engine is loaded as soon as a
  // search returns torrent results; here we additionally fetch each highlighted
  // release's metadata in the background (no pieces are downloaded). A later
  // resolve() then reuses the memoized serve and returns in a few milliseconds.
  const warmTorrentFor = (rel: StreamRelease): void => {
    const mirror = rel.mirrors[0];
    if (mirror !== undefined && mirror.resolverUrl.startsWith("magnet:")) {
      try {
        app.warmWatchStream(rel, mirror);
      } catch {
        /* best effort */
      }
    }
  };
  useEffect(() => {
    if (watchReleases.releases.length === 0) return;
    // The top release is what enter plays by default — warm it immediately.
    const top = watchReleases.releases[0];
    if (top !== undefined) warmTorrentFor(top);
  }, [watchReleases.releases]);
  useEffect(() => {
    const releases = watchReleases.releases;
    const rel = releases[Math.min(Math.max(watchPaneCursor, 0), releases.length - 1)];
    if (rel === undefined) return;
    const t = setTimeout(() => warmTorrentFor(rel), 250);
    return () => clearTimeout(t);
  }, [view, watchPane, watchPaneCursor, watchReleases.releases]);

  // Once the details view's torrent resolves its metadata, initialize the file
  // checkboxes (everything checked by default) so the user can adjust them.
  useEffect(() => {
    if (!detailsFilesId) return;
    const item = app.manager.get(detailsFilesId);
    if (!item) {
      if (fileChecksInitId.current === detailsFilesId) {
        setDetailsFilesId(null);
        setDetailsFilesCreated(false);
        setFileChecks(new Set());
        fileChecksInitId.current = null;
      }
      return;
    }
    if (item.fileList && item.fileList.length > 0 && fileChecksInitId.current !== detailsFilesId) {
      fileChecksInitId.current = detailsFilesId;
      setFileChecks(new Set(item.fileList.map((f) => f.path)));
      setFileCursor(0);
    }
  }, [detailsFilesId, tick]);

  const goto = (next: View): void => {
    prevView.current = view;
    setView(next);
  };

  /** Return to the search home, clearing any recent-list focus. */
  const goHome = (): void => {
    setView("home");
    setRecentActive(false);
    setRecentIndex(0);
    setCursor(query.length);
  };

  const back = (): void => {
    switch (view) {
      case "home":
        exit();
        break;
      case "results":
        goHome();
        break;
      case "details":
        setView("results");
        break;
      case "watch":
        goHome();
        break;
      case "watchdetails":
        setPlaybackStatus(null);
        setView("watch");
        break;
      default:
        setView(prevView.current);
        break;
    }
  };

  // --- watch (streaming) -------------------------------------------------------

  const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

  const toggleSearchMode = (): void => {
    const next: DownloadAction = searchAction === "watch" ? "download" : "watch";
    setSearchAction(next);
    void app.updateConfig({ searchAction: next });
    showMessage(next === "watch" ? "Watch mode — enter searches streaming sources (tab to switch back)." : "Download mode — enter searches torrents (tab to switch).");
  };

  const startWatchSearch = (q?: string): void => {
    const text = (q ?? query).trim();
    if (!text) {
      showMessage("Type a query first.");
      return;
    }
    if (watchSession) watchSession.cancel();
    const s = new WatchSearchSession(app.streams, text);
    setWatchSession(s);
    setWatchDetails(null);
    setWatchMeta({ details: null, loading: false, error: null });
    setWatchReleases({ releases: [], subtitles: [], resolutions: [], loading: false, error: null, notice: null });
    setWatchDownload(null);
    setView("watch");
    setRecentActive(false);
    setRecentIndex(0);
    app.addRecentSearch(text);
    setRecentQueries((prev) => [text, ...prev.filter((x) => x !== text)].slice(0, MAX_RECENT_SEARCHES));
    void s.run();
  };

  const isFavoriteItem = (item: StreamCatalogItem): boolean => favorites.some((f) => f.id === item.id);

  const loadWatchStreams = (item: StreamCatalogItem, season: number, episode: number, resolution: string): void => {
    setWatchReleases({ releases: [], subtitles: [], resolutions: [], loading: true, error: null, notice: null });
    void app.streams
      .releaseSources(item, season, episode, resolution)
      .then((res) => {
        setWatchReleases({ releases: res.releases, subtitles: res.subtitles, resolutions: res.resolutions, loading: false, error: null, notice: res.notice ?? null });
      })
      .catch((err) => {
        setWatchReleases((prev) => ({ ...prev, loading: false, error: messageOf(err) }));
      });
  };

  const openWatchDetails = (): void => {
    const item = watchSession?.selected;
    if (!item) return;
    setWatchDetails({ item });
    setWatchSeason(0);
    setWatchEpisode(0);
    setWatchPane("streams");
    setWatchPaneCursor(0);
    setWatchResolution("");
    setWatchSubtitle(undefined);
    setWatchDownload(null);
    setPlaybackStatus(null);
    setWatchMeta({ details: null, loading: true, error: null });
    setWatchReleases({ releases: [], subtitles: [], resolutions: [], loading: false, error: null, notice: null });
    void app.favorites.is(item).then(setWatchIsFav).catch(() => setWatchIsFav(false));
    setView("watchdetails");
    void app.streams
      .details(item)
      .then((details) => {
        setWatchMeta({ details, loading: false, error: null });
        if (details.mediaType === "series" && details.seasons.length > 0) {
          const firstSeason = details.seasons[0]!;
          const season = firstSeason.number;
          const episode = firstSeason.episodes[0]?.number ?? 1;
          setWatchSeason(season);
          setWatchEpisode(episode);
          setWatchPane("episodes");
          loadWatchStreams(item, season, episode, "");
        } else {
          setWatchPane("streams");
          loadWatchStreams(item, 0, 0, "");
        }
      })
      .catch((err) => {
        setWatchMeta({ details: null, loading: false, error: messageOf(err) });
      });
  };

  const selectWatchEpisode = (): void => {
    const item = watchDetails?.item;
    const details = watchMeta.details;
    if (!item || !details) return;
    const flat = flattenEpisodes(details);
    const ep = flat[Math.min(watchPaneCursor, flat.length - 1)];
    if (!ep) return;
    setWatchSeason(ep.season);
    setWatchEpisode(ep.number);
    setWatchPane("streams");
    setWatchPaneCursor(0);
    setWatchDownload(null);
    loadWatchStreams(item, ep.season, ep.number, watchResolution);
  };

  const currentStreamRelease = (): StreamRelease | null => {
    const releases = watchReleases.releases;
    const idx = Math.min(watchPaneCursor, releases.length - 1);
    return releases[idx] ?? null;
  };

  const playWatchStream = (playerId: string | null): void => {
    const item = watchDetails?.item;
    const rel = currentStreamRelease();
    if (!item || !rel) return;
    const mirror = rel.mirrors[0];
    if (!mirror) {
      showMessage("No playable mirror for this stream.");
      return;
    }
    const player = pickPlayer(playerId ?? app.getConfig().defaultPlayer);
    if (!player) {
      showMessage("No media player found. Install mpv, VLC or IINA to play.");
      return;
    }
    const title = `${item.title}${watchSeason > 0 ? ` S${watchSeason}E${watchEpisode}` : ""}`;
    const mediaType = item.mediaType === "series" ? "series" : item.mediaType === "tv" ? "tv" : "movie";
    const season = watchSeason > 0 ? watchSeason : undefined;
    const episode = watchEpisode > 0 ? watchEpisode : undefined;
    void (async () => {
      setPlaybackStatus(`Preparing ${player.name}…`);
      const prior = await app.history.find({ id: item.id, season, episode });
      const startSeconds = prior !== undefined && prior.time > 30 && !prior.completed ? prior.time : 0;
      const trackerFile = player.id === "mpv" ? await writeTrackerScript() : undefined;
      showMessage(`Starting ${player.name}…`);
      const source = await app.streams.resolve(item, rel, mirror, watchSubtitle, undefined, (stage, fraction) => {
        if (fraction !== undefined && fraction > 0 && fraction < 1) {
          setPlaybackStatus(`${player.name}: ${stage} ${Math.round(fraction * 100)}%`);
        } else {
          setPlaybackStatus(`${player.name}: ${stage}…`);
        }
      });
      setPlaybackStatus(null);
      const child = spawnPlayer(player, {
        url: source.url,
        headers: source.headers,
        subtitle: source.subtitle,
        title,
        startSeconds,
        trackerStateFile: trackerFile,
      });
      if (trackerFile !== undefined) {
        child.once("exit", () => {
          void reconcilePlayback(trackerFile, item, season, episode);
        });
      }
      child.unref();
      showMessage(`✓ ${player.name} opened — ${truncate(source.url, 44)}`);
      await app.history.record({
        provider: item.provider,
        id: item.id,
        title: item.title,
        year: item.year,
        posterUrl: item.posterUrl,
        mediaType,
        season,
        episode,
        time: 0,
        duration: 0,
        completed: false,
      });
    })().catch((err) => {
      setPlaybackStatus(null);
      showMessage(`Playback failed: ${messageOf(err)}`);
    });
  };

  const reconcilePlayback = async (trackerFile: string, item: StreamCatalogItem, season?: number, episode?: number): Promise<void> => {
    const state = await readTrackerState(trackerFile);
    await rm(trackerFile, { force: true }).catch(() => undefined);
    if (state === null) return;
    const ref = { id: item.id, season, episode };
    const duration = state.duration > 0 ? state.duration : 0;
    const time = Math.max(0, Math.min(state.time, duration > 0 ? duration : state.time));
    if (duration > 0 && time > duration - 120) {
      await app.history.markCompleted(ref);
    } else {
      await app.history.updateProgress(ref, time, duration);
    }
  };

  const downloadWatchStream = (): void => {
    const item = watchDetails?.item;
    const rel = currentStreamRelease();
    if (!item || !rel) return;
    const mirror = rel.mirrors[0];
    if (!mirror) {
      showMessage("No downloadable mirror for this stream.");
      return;
    }
    const dir = app.streamDownloadDir();
    const safeName = rel.filename.replace(/[\\/:*?"<>|]/g, "_").trim() || `tornedo-${item.title.slice(0, 40)}.mp4`;
    const dest = join(dir, safeName);
    setWatchDownload({ phase: "resolving", label: safeName, percent: null, speed: null });
    const downloader = new StreamDownloader();
    void app.streams
      .resolve(item, rel, mirror)
      .then((source) =>
        downloader.download({
          url: source.url,
          headers: source.headers,
          dest,
          retries: 3,
          onProgress: (p: DownloadProgress) =>
            setWatchDownload({ phase: "downloading", label: safeName, percent: p.percent, speed: p.rateBytesPerSec }),
        }),
      )
      .then((result) => {
        setWatchDownload({ phase: "done", label: safeName, percent: 1, speed: null, message: result.path });
      })
      .catch((err) => {
        setWatchDownload({ phase: "error", label: safeName, percent: null, speed: null, message: messageOf(err) });
      });
  };

  const refreshFavorites = (): void => {
    void app.favorites.list().then(setFavorites).catch(() => undefined);
  };

  const toggleWatchFavorite = (): void => {
    const item = watchDetails?.item ?? watchSession?.selected;
    if (!item) return;
    void app.favorites
      .toggle(app.favorites.fromItem(item))
      .then((isNow) => {
        setWatchIsFav(isNow);
        refreshFavorites();
        if (item.mediaType === "series" && watchSeason > 0 && watchEpisode > 0) {
          showMessage(isNow ? `★ ${item.title} S${watchSeason}E${watchEpisode}` : `Removed ${item.title} S${watchSeason}E${watchEpisode} ★`);
        } else {
          showMessage(isNow ? `★ ${item.title} added to favorites` : `Removed ${item.title} from favorites`);
        }
      })
      .catch((err) => showMessage(`Favorite: ${messageOf(err)}`));
  };

  const openSubtitlesPicker = (): void => {
    const item = watchDetails?.item;
    const rel = currentStreamRelease();
    if (!item || !rel) return;
    if (item.provider !== "moviebox") {
      showMessage("This source offers no subtitles. Load a subtitle file in the player instead.");
      return;
    }
    void app.streams
      .subtitles(item, rel.resourceId ?? "")
      .then((list) => {
        if (list.length === 0) {
          showMessage("No subtitles available for this stream.");
          return;
        }
        const opts: SelectOption<string>[] = [
          { value: "__none__", label: "No subtitle" },
          ...list.map((s) => ({ value: s.url, label: s.name })),
        ];
        const cur = opts.findIndex((o) => o.value === watchSubtitle);
        openSelect("subtitles", opts, (v) => {
          setWatchSubtitle(v === "__none__" ? undefined : v);
          showMessage(v === "__none__" ? "Subtitle cleared." : "Subtitle attached to next playback.");
        }, Math.max(0, cur), "↑/↓ move · enter pick · esc close");
      })
      .catch((err) => showMessage(`Subtitles unavailable: ${messageOf(err)}`));
  };

  const openResolutionPicker = (): void => {
    const item = watchDetails?.item;
    if (!item) return;
    const opts: SelectOption<string>[] = [{ value: "", label: "Auto" }, ...watchReleases.resolutions.map((r) => ({ value: r, label: r }))];
    const cur = opts.findIndex((o) => o.value === watchResolution);
    openSelect("resolution", opts, (v) => {
      setWatchResolution(v);
      setWatchPaneCursor(0);
      setWatchDownload(null);
      loadWatchStreams(item, watchSeason, watchEpisode, v);
    }, Math.max(0, cur), "↑/↓ move · enter pick · esc close");
  };

  const openPlayerPicker = (): void => {
    const players = detectPlayers();
    const opts: SelectOption<string>[] = [
      { value: "", label: "Auto", hint: players[0] !== undefined ? `first available: ${players[0].name}` : "none found" },
      ...players.map((p) => ({ value: p.id, label: p.name, hint: p.command })),
    ];
    openSelect("open with", opts, (v) => {
      playWatchStream(v === "" ? null : v);
    }, 0, "↑/↓ move · enter play · esc close");
  };

  const openWatchActionsMenu = (): void => {
    const item = watchDetails?.item;
    if (!item) return;
    const opts: SelectOption<string>[] = [
      { value: "play", label: "Play", hint: "open in media player" },
      { value: "open", label: "Open with…", hint: "choose the player" },
    ];
    if (watchPane === "streams") {
      opts.push({ value: "download", label: "Download stream", hint: app.streamDownloadDir() });
      opts.push({ value: "subtitles", label: "Subtitles", hint: "for this stream" });
    }
    opts.push({ value: "resolution", label: "Resolution", hint: watchResolution || "auto" });
    opts.push({ value: "favorite", label: watchIsFav ? "Remove favorite" : "Add favorite", hint: "★" });
    openSelect("actions", opts, (v) => {
      switch (v) {
        case "play":
          playWatchStream(null);
          break;
        case "open":
          openPlayerPicker();
          break;
        case "download":
          downloadWatchStream();
          break;
        case "subtitles":
          openSubtitlesPicker();
          break;
        case "resolution":
          openResolutionPicker();
          break;
        case "favorite":
          toggleWatchFavorite();
          break;
      }
    });
  };

  // --- search ---------------------------------------------------------------

  const startSearch = (q?: string): void => {
    const text = (q ?? query).trim();
    if (!text) {
      showMessage("Type a query first.");
      return;
    }
    if (session) session.cancel();
    const s = app.searchService.createSession(text);
    setSession(s);
    s.start();
    setSelected(0);
    setFilter("");
    setCategoryScope(null);
    setReleaseFilter({});
    setFilterText("");
    setSortOption(SORT_OPTIONS[0]!);
    setView("results");
    setRecentActive(false);
    setRecentIndex(0);
    app.addRecentSearch(text);
    setRecentQueries((prev) => {
      const next = [text, ...prev.filter((x) => x !== text)];
      return next.slice(0, MAX_RECENT_SEARCHES);
    });
  };

  // --- overlays ---------------------------------------------------------------

  const openPrompt = (title: string, initial: string, onSubmit: (value: string) => void, hint?: string): void => {
    setOverlay({ kind: "prompt", title, hint, onSubmit });
    setPromptValue(initial);
    setPromptCursor(initial.length);
  };

  const openSelect = (title: string, options: SelectOption<string>[], onPick: (value: string) => void, selected = 0, hint?: string): void => {
    setOverlay({ kind: "select", title, options, hint, onPick });
    setOverlaySelect(selected);
  };

  const openConfirm = (promptText: string, onConfirm: () => void): void => {
    setOverlay({ kind: "confirm", prompt: promptText, onConfirm });
    setOverlayYes(false);
  };

  const closeOverlay = (): void => {
    setOverlay(null);
    setPromptValue("");
    setPromptCursor(0);
    setOverlaySelect(0);
    setOverlayYes(false);
  };

  const confirmOverlay = (): void => {
    const o = overlay;
    if (!o) return;
    if (o.kind === "prompt") {
      const value = promptValue;
      closeOverlay();
      o.onSubmit(value);
    } else if (o.kind === "select") {
      const opt = o.options[overlaySelect];
      closeOverlay();
      if (opt) o.onPick(opt.value);
    } else if (o.kind === "confirm") {
      const yes = overlayYes;
      closeOverlay();
      if (yes) o.onConfirm();
    }
  };

  const handleOverlayKey = (input: string, key: Key): void => {
    const o = overlay;
    if (!o) return;
    if (o.kind === "prompt") {
      if (key.return) {
        confirmOverlay();
        return;
      }
      if (key.escape) {
        closeOverlay();
        return;
      }
      const next = applyTyping(promptValue, promptCursor, input, key);
      setPromptValue(next.value);
      setPromptCursor(next.cursor);
      return;
    }
    if (o.kind === "select") {
      if (key.upArrow) {
        setOverlaySelect((i) => Math.max(0, i - 1));
        return;
      }
      if (key.downArrow) {
        setOverlaySelect((i) => Math.min(o.options.length - 1, i + 1));
        return;
      }
      if (key.return) {
        confirmOverlay();
        return;
      }
      if (key.escape) {
        closeOverlay();
        return;
      }
      return;
    }
    // confirm dialog
    if (key.return) {
      confirmOverlay();
      return;
    }
    if (key.escape) {
      closeOverlay();
      return;
    }
    if (key.tab || key.leftArrow || key.rightArrow || input === " ") {
      setOverlayYes((y) => !y);
      return;
    }
    if (input.toLowerCase() === "y") {
      setOverlayYes(true);
      return;
    }
    if (input.toLowerCase() === "n") {
      setOverlayYes(false);
    }
  };

  // --- downloads --------------------------------------------------------------

  const currentReleases = (): ReturnType<typeof filteredReleases> => filteredReleases(session, filter, releaseFilter, categoryScope, sortOption.spec);

  const currentRelease = (): { rels: ReturnType<typeof filteredReleases>; index: number } | null => {
    const rels = currentReleases();
    const len = rels.length;
    if (len === 0) return null;
    const index = Math.min(selected, len - 1);
    return { rels, index };
  };

  const downloadSelected = (destination?: string): void => {
    const cur = currentRelease();
    if (!cur) return;
    const r = cur.rels[cur.index]!;
    if (r.magnet && !/^magnet:/i.test(r.magnet)) {
      showMessage(`Direct-download source (${r.category}); the torrent engine cannot fetch "${truncate(r.magnet, 30)}"`);
      return;
    }
    const cfg = app.getConfig();
    const item = app.manager.add({
      infohash: r.infohash,
      magnet: r.magnet,
      name: r.title,
      category: r.category,
      metadata: r.metadata,
      size: r.size,
      destination: destination ?? cfg.downloadDir,
      seedEnabled: cfg.seedAfterComplete,
    });
    showMessage(`Queued: ${truncate(item.name, 60)}`);
  };

  // --- details-view file selection (default state, no keybind) -----------------

  const detailsFileList = (): TorrentFileInfo[] => {
    if (!detailsFilesId) return [];
    return app.manager.get(detailsFilesId)?.fileList ?? [];
  };

  /** Resolve the release's file list as soon as its details view opens. */
  const resolveDetailsFiles = (release: Release): void => {
    if (release.magnet && !/^magnet:/i.test(release.magnet)) {
      setDetailsFilesId(null);
      setDetailsFilesCreated(false);
      setFileChecks(new Set());
      fileChecksInitId.current = null;
      return;
    }
    const existing = app.manager.get(release.infohash.toLowerCase());
    if (existing?.fileList && existing.fileList.length > 0) {
      fileChecksInitId.current = existing.id;
      setDetailsFilesId(existing.id);
      setDetailsFilesCreated(false);
      // Reflect the actual selection when the torrent already has one (e.g. a
      // download in progress): show only the chosen files checked, not every
      // file. A fresh torrent has no selection yet and defaults to all checked.
      setFileChecks(
        existing.selectedFiles && existing.selectedFiles.length > 0
          ? new Set(existing.selectedFiles)
          : new Set(existing.fileList.map((f) => f.path)),
      );
      setFileCursor(0);
      return;
    }
    const cfg = app.getConfig();
    const item = app.manager.add({
      infohash: release.infohash,
      magnet: release.magnet,
      name: release.title,
      category: release.category,
      metadata: release.metadata,
      size: release.size,
      destination: cfg.downloadDir,
      seedEnabled: cfg.seedAfterComplete,
      // Nothing downloads until the user commits a file selection.
      startDeselected: true,
    });
    const known = item.fileList && item.fileList.length > 0;
    // Only mark the selection as initialized when the file list is already
    // known. Otherwise the tick-effect below initializes "all checked" the
    // moment metadata arrives, so the user never sees an empty (wrong) default.
    fileChecksInitId.current = known ? item.id : null;
    setDetailsFilesId(item.id);
    setDetailsFilesCreated(!known);
    setFileChecks(known ? new Set(item.fileList!.map((f) => f.path)) : new Set());
    setFileCursor(0);
  };

  /** Commit the current file selection in the details view and start downloading. */
  const commitDetailsDownload = async (destination?: string): Promise<void> => {
    const cur = currentRelease();
    if (!cur) return;
    const r = cur.rels[cur.index]!;
    if (r.magnet && !/^magnet:/i.test(r.magnet)) {
      showMessage(`Direct-download source (${r.category}); the torrent engine cannot fetch "${truncate(r.magnet, 30)}"`);
      return;
    }
    const cfg = app.getConfig();
    const item = detailsFilesId ? app.manager.get(detailsFilesId) : null;
    if (item?.fileList && item.fileList.length > 0) {
      if (fileChecks.size === 0) {
        showMessage("Select at least one file to download.");
        return;
      }
      app.manager.setFileSelection(item.id, [...fileChecks]);
      setDetailsFilesId(null);
      setDetailsFilesCreated(false);
      setFileChecks(new Set());
      fileChecksInitId.current = null;
      goto("downloads");
      showMessage(`Downloading ${fileChecks.size} of ${item.fileList.length} files.`);
      return;
    }
    // File list not resolved yet — download the whole torrent normally.
    if (item) await app.manager.remove(item.id);
    const fresh = app.manager.add({
      infohash: r.infohash,
      magnet: r.magnet,
      name: r.title,
      category: r.category,
      metadata: r.metadata,
      size: r.size,
      destination: destination ?? cfg.downloadDir,
      seedEnabled: cfg.seedAfterComplete,
    });
    setDetailsFilesId(null);
    setDetailsFilesCreated(false);
    setFileChecks(new Set());
    fileChecksInitId.current = null;
    goto("downloads");
    showMessage(`Queued: ${truncate(fresh.name, 60)}`);
  };

  /** Remove the auto-resolved browsing item when leaving details without committing. */
  const cleanupDetailsFiles = (): void => {
    if (!detailsFilesId) return;
    const item = app.manager.get(detailsFilesId);
    if (item && detailsFilesCreated && item.status !== "downloading") {
      void app.manager.remove(detailsFilesId);
    }
    setDetailsFilesId(null);
    setDetailsFilesCreated(false);
    setFileChecks(new Set());
    fileChecksInitId.current = null;
  };

  const toggleFile = (path: string): void => {
    setFileChecks((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  // Resolve the release's file list the moment its details view opens; drop the
  // auto-created browsing item when the user leaves without committing.
  useEffect(() => {
    if (view !== "details") {
      cleanupDetailsFiles();
      return;
    }
    const cur = currentRelease();
    if (cur) resolveDetailsFiles(cur.rels[cur.index]!);
  }, [view]);

  const currentDownload = (): TorrentItem | undefined => {
    const items = app.manager.list();
    const idx = Math.min(selectedDownload, Math.max(0, items.length - 1));
    return items[idx];
  };

  const removeSelected = async (): Promise<void> => {
    const item = currentDownload();
    if (!item) return;
    await app.manager.remove(item.id);
    showMessage(`Removed: ${truncate(item.name, 50)}`);
  };

  const cancelSelected = (): void => {
    const item = currentDownload();
    if (!item) return;
    app.manager.cancel(item.id);
    showMessage(`Cancelled: ${truncate(item.name, 50)}`);
  };

  const deleteFilesSelected = async (): Promise<void> => {
    const item = currentDownload();
    if (!item) return;
    await app.manager.deleteFiles(item.id);
    showMessage(`Deleted files: ${truncate(item.name, 50)}`);
  };

  const openLocationSelected = (): void => {
    const item = currentDownload();
    if (!item) return;
    if (app.manager.openLocation(item.id)) {
      showMessage(`Opening: ${truncate(item.destination ?? item.name, 60)}`);
    } else {
      showMessage(`Location: ${item.destination ?? "unknown"}`);
    }
  };

  const showMagnetSelected = (): void => {
    const cur = currentRelease();
    if (!cur) return;
    const r = cur.rels[cur.index]!;
    showMessage(`magnet: ${truncate(r.magnet, 140)}`);
  };

  const openMagnetSelected = (): void => {
    const cur = currentRelease();
    if (!cur) return;
    const r = cur.rels[cur.index]!;
    const uri = r.magnet;
    const platform = process.platform;
    let cmd: string;
    let args: string[];
    if (platform === "win32") {
      cmd = "explorer";
      args = [uri];
    } else if (platform === "darwin") {
      cmd = "open";
      args = [uri];
    } else {
      cmd = "xdg-open";
      args = [uri];
    }
    try {
      const child = spawn(cmd, args, { detached: true, stdio: "ignore" });
      child.on("error", () => showMessage(`Cannot open magnet externally — magnet: ${truncate(uri, 120)}`));
      child.unref();
      showMessage("Opening magnet in your default handler…");
    } catch {
      showMessage(`magnet: ${truncate(uri, 140)}`);
    }
  };

  const openActionMenu = (): void => {
    const item = currentDownload();
    if (!item) return;
    const opts: SelectOption<string>[] = [];
    const cancellable = ["queued", "downloading", "stalled", "starting", "waiting_metadata", "checking", "ready", "paused", "stopped", "error"].includes(item.status);
    const resumable = ["paused", "stopped"].includes(item.status) || item.status === "error";
    const pausable = ["downloading", "stalled", "starting", "waiting_metadata", "checking", "ready", "queued"].includes(item.status) || item.status === "seeding";
    if (resumable) opts.push({ value: "resume", label: "Resume", hint: `status ${item.status}` });
    if (pausable) opts.push({ value: "pause", label: "Pause", hint: `status ${item.status}` });
    if (item.status === "completed") opts.push({ value: "toggleSeed", label: item.seedEnabled ? "Stop seeding" : "Start seeding" });
    if (cancellable) opts.push({ value: "cancel", label: "Cancel download", hint: "keep files, stop transfer" });
    if (item.destination) opts.push({ value: "open", label: "Open location", hint: item.destination });
    opts.push({ value: "delete", label: "Remove + delete files", hint: "dangerous — deletes on disk" });
    opts.push({ value: "remove", label: "Remove from list", hint: "keeps files on disk" });
    openSelect("download actions", opts, (v) => {
      switch (v) {
        case "pause":
          app.manager.pause(item.id);
          break;
        case "resume":
          app.manager.resume(item.id);
          break;
        case "toggleSeed":
          app.manager.toggleSeeding(item.id);
          break;
        case "cancel":
          openConfirm(`Cancel "${truncate(item.name, 50)}"? Files stay on disk.`, cancelSelected);
          break;
        case "open":
          openLocationSelected();
          break;
        case "delete":
          openConfirm(`Delete files for "${truncate(item.name, 50)}" and remove it from the list?`, () => void deleteFilesSelected());
          break;
        case "remove":
          openConfirm(`Remove "${truncate(item.name, 50)}" from the list? Files stay on disk.`, () => void removeSelected());
          break;
        default:
          break;
      }
    });
  };

  // --- refinement handlers ------------------------------------------------------

  const openCategorySelector = (): void => {
    const all: SelectOption<string>[] = [
      { value: "", label: "All categories", hint: "clear scope" },
      ...MEDIA_CATEGORIES.map((c) => ({ value: c, label: c })),
    ];
    const cur = all.findIndex((o) => o.value === categoryScope) ?? 0;
    openSelect("category scope", all, (v) => {
      setCategoryScope((v === "" ? null : v) as MediaCategory | null);
      setSelected(0);
    }, Math.max(0, cur), "↑/↓ move · enter pick · esc close");
  };

  const openSortSelector = (): void => {
    const opts: SelectOption<string>[] = SORT_OPTIONS.map((o) => ({ value: o.id, label: o.label }));
    const cur = SORT_OPTIONS.findIndex((o) => o.id === sortOption.id);
    openSelect("sort results", opts, (id) => {
      const found = SORT_OPTIONS.find((o) => o.id === id);
      if (found) setSortOption(found);
      setSelected(0);
    }, Math.max(0, cur), "↑/↓ move · enter pick · esc close");
  };

  const openFilterEditor = (): void => {
    openPrompt(
      "filter results",
      filterText,
      (text) => {
        const trimmed = text.trim();
        const parsed = parseFilterText(trimmed);
        const structured = Object.values(parsed).some((v) => v !== undefined);
        setReleaseFilter(parsed);
        setFilterText(trimmed);
        setFilter(structured ? "" : trimmed);
        setSelected(0);
      },
      "min:<seeds> max:<size> src:<id> res:<res> codec:<codec> audio:<audio> lang:<lang>",
    );
  };

  // --- settings ----------------------------------------------------------------

  const buildSettingsRows = (): SettingsRow[] => {
    const cfg = app.getConfig();
    const rate = (v: number): string => (v > 0 ? `${Math.round(v)} B/s` : "unlimited");
    const rows: SettingsRow[] = [
      { type: "header", label: "DOWNLOADS" },
      { type: "item", id: "downloadDir", label: "Download directory", value: cfg.downloadDir },
      { type: "item", id: "maxActiveDownloads", label: "Max active downloads", value: cfg.maxActiveDownloads > 0 ? String(cfg.maxActiveDownloads) : "unlimited" },
      { type: "toggle", id: "seedAfterComplete", label: "Seed after complete", value: cfg.seedAfterComplete },
      { type: "item", id: "maxDownloadSpeed", label: "Download speed limit", value: rate(cfg.maxDownloadSpeed) },
      { type: "item", id: "maxUploadSpeed", label: "Upload speed limit", value: rate(cfg.maxUploadSpeed) },
      { type: "header", label: "SEARCH" },
      { type: "item", id: "sourceTimeoutMs", label: "Source timeout", value: `${cfg.sourceTimeoutMs} ms` },
      { type: "toggle", id: "internetArchive", label: "Internet Archive", value: cfg.internetArchive.enabled },
      { type: "header", label: "WATCH" },
      { type: "toggle", id: "streamingEnabled", label: "Streaming providers", value: cfg.streamingEnabled },
      { type: "toggle", id: "bdixEnabled", label: "BDIX (Bangladesh ISPs)", value: cfg.bdixEnabled },
      { type: "item", id: "searchAction", label: "Search mode", value: cfg.searchAction === "watch" ? "watch" : "download" },
      { type: "item", id: "streamDownloadDir", label: "Stream download dir", value: cfg.streamDownloadDir ?? cfg.downloadDir },
      { type: "item", id: "defaultPlayer", label: "Default player", value: cfg.defaultPlayer ?? "auto (detect)" },
      { type: "header", label: "APPEARANCE" },
      { type: "item", id: "theme", label: "Theme", value: currentThemeName() },
      { type: "header", label: "SOURCES" },
      ...app.sources.map((s) => ({ type: "source" as const, id: `source:${s.id}`, label: s.name, value: app.isSourceEnabled(s.id) })),
      { type: "header", label: "ADVANCED" },
      { type: "toggle", id: "recoveryAutoResume", label: "Auto-resume after crash", value: cfg.recoveryAutoResume },
      { type: "item", id: "watchIntervalMs", label: "Watch interval", value: `${cfg.watchIntervalMs} ms` },
      { type: "item", id: "diskSpaceWarningMb", label: "Disk space warning", value: `${cfg.diskSpaceWarningMb} MiB` },
    ];
    return rows;
  };

  const settingsOrder = (): string[] => {
    return buildSettingsRows().filter((r) => r.type !== "header").map((r) => r.id);
  };

  const moveSettings = (dir: 1 | -1): void => {
    const order = settingsOrder();
    if (order.length === 0) return;
    const idx = order.indexOf(settingsSelectedId);
    const next = idx < 0 ? 0 : Math.max(0, Math.min(order.length - 1, idx + dir));
    setSettingsSelectedId(order[next]!);
  };

  const editSettings = (): void => {
    const cfg = app.getConfig();
    const id = settingsSelectedId;
    const row = buildSettingsRows().find((r) => r.type !== "header" && r.id === id);
    if (!row) return;

    const update = (patch: Partial<typeof cfg>): void => {
      void app.updateConfig(patch);
      showMessage("Settings updated.");
    };
    const updateNumber = (label: string, patch: (n: number) => Partial<typeof cfg>): void => {
      openPrompt(label, "", (raw) => {
        const n = Number(raw.trim());
        if (!raw.trim() || !Number.isFinite(n) || n < 0) {
          showMessage("Enter a valid number.");
          editSettings();
          return;
        }
        update(patch(n));
      }, "number, 0 = unlimited where applicable");
    };

    switch (row.type) {
      case "toggle":
        if (id === "internetArchive") {
          update({ internetArchive: { ...cfg.internetArchive, enabled: !cfg.internetArchive.enabled } });
        } else {
          update({ [id]: !row.value } as Partial<typeof cfg>);
        }
        break;
      case "source": {
        const sourceId = id.slice("source:".length);
        app.setSourceEnabled(sourceId, !row.value);
        showMessage(`${row.label} ${!row.value ? "enabled" : "disabled"}.`);
        break;
      }
      case "item":
        switch (id) {
          case "downloadDir":
            openPrompt("download directory", cfg.downloadDir, (v) => {
              if (v.trim()) update({ downloadDir: v.trim() });
            });
            break;
          case "maxActiveDownloads":
            updateNumber("max active downloads", (n) => ({ maxActiveDownloads: Math.floor(n) }));
            break;
          case "maxDownloadSpeed":
            updateNumber("download speed limit (B/s)", (n) => ({ maxDownloadSpeed: Math.floor(n) }));
            break;
          case "maxUploadSpeed":
            updateNumber("upload speed limit (B/s)", (n) => ({ maxUploadSpeed: Math.floor(n) }));
            break;
          case "sourceTimeoutMs":
            updateNumber("source timeout (ms)", (n) => ({ sourceTimeoutMs: Math.max(1, Math.floor(n)) }));
            break;
          case "watchIntervalMs":
            updateNumber("watch interval (ms)", (n) => ({ watchIntervalMs: Math.max(50, Math.floor(n)) }));
            break;
          case "diskSpaceWarningMb":
            updateNumber("disk space warning (MiB)", (n) => ({ diskSpaceWarningMb: Math.floor(n) }));
            break;
          case "searchAction":
            openSelect("search mode", [
              { value: "download", label: "download", hint: "enter searches torrents" },
              { value: "watch", label: "watch", hint: "enter searches streaming sources" },
            ], (v) => {
              const next = v as DownloadAction;
              setSearchAction(next);
              update({ searchAction: next });
            }, cfg.searchAction === "watch" ? 1 : 0, "enter search to switch · esc close");
            break;
          case "streamDownloadDir":
            openPrompt("stream download directory", cfg.streamDownloadDir ?? cfg.downloadDir, (v) => {
              if (v.trim()) update({ streamDownloadDir: v.trim() });
            });
            break;
          case "defaultPlayer": {
            const players = detectPlayers();
            openSelect("default player", [
              { value: "", label: "auto (detect)", hint: "mpv > VLC > IINA" },
              ...players.map((p) => ({ value: p.id, label: p.name, hint: p.command })),
            ], (v) => {
              update({ defaultPlayer: v === "" ? null : v });
            }, cfg.defaultPlayer === null || cfg.defaultPlayer === "" ? 0 : Math.max(0, players.findIndex((p) => p.id === cfg.defaultPlayer) + 1));
            break;
          }
          case "theme":
            openSelect("theme", THEME_CHOICES.map((t) => ({ value: t, label: t })), (v) => {
              applyTheme(v);
              setThemeTick((n) => n + 1);
              update({ theme: v });
            }, Math.max(0, THEME_CHOICES.indexOf(currentThemeName())), "applies immediately");
            break;
          default:
            break;
        }
        break;
    }
  };

  // --- key dispatch ------------------------------------------------------------

  const navigateAction = (action: KeyAction | null): boolean => {
    switch (action) {
      case "search":
        goHome();
        return true;
      case "downloads":
        goto("downloads");
        return true;
      case "sources":
        goto("sources");
        return true;
      case "settings":
        goto("settings");
        if (!settingsSelectedId) {
          const order = settingsOrder();
          if (order.length > 0) setSettingsSelectedId(order[0]!);
        }
        return true;
      default:
        return false;
    }
  };

  const handleResultsKey = (action: KeyAction | null): void => {
    const cur = currentRelease();
    const last = Math.max(0, (cur?.rels.length ?? 1) - 1);
    switch (action) {
      case "up":
        setSelected((s) => Math.max(0, s - 1));
        break;
      case "down":
        setSelected((s) => Math.min(last, s + 1));
        break;
      case "pageup":
        setSelected((s) => Math.max(0, s - PAGE_STEP));
        break;
      case "pagedown":
        setSelected((s) => Math.min(last, s + PAGE_STEP));
        break;
      case "home":
        setSelected(0);
        break;
      case "end":
        setSelected(last);
        break;
      case "confirm":
        if (cur) goto("details");
        break;
      case "downloadTo":
        openPrompt("download to", app.getConfig().downloadDir, (dir) => {
          if (dir.trim()) downloadSelected(dir.trim());
        });
        break;
      case "filter":
        openFilterEditor();
        break;
      case "category":
        openCategorySelector();
        break;
      case "sort":
        openSortSelector();
        break;
      case "copyMagnet":
        showMagnetSelected();
        break;
      case "openMagnet":
        openMagnetSelected();
        break;
      case "back":
        goHome();
        break;
      case "help":
        goto("help");
        break;
      default:
        navigateAction(action);
        break;
    }
  };

  const handleDetailsKey = (action: KeyAction | null, input: string): void => {
    const files = detailsFileList();
    const last = Math.max(0, files.length - 1);
    switch (action) {
      case "up":
        setFileCursor((i) => Math.max(0, i - 1));
        break;
      case "down":
        setFileCursor((i) => Math.min(last, i + 1));
        break;
      case "pageup":
        setFileCursor((i) => Math.max(0, i - PAGE_STEP));
        break;
      case "pagedown":
        setFileCursor((i) => Math.min(last, i + PAGE_STEP));
        break;
      case "confirm":
        void commitDetailsDownload();
        break;
      case "download": {
        // d toggles the highlighted file for download — enter is the download key.
        if (files.length > 0) {
          const cur = files[Math.min(fileCursor, last)];
          if (cur) toggleFile(cur.path);
        }
        break;
      }
      case "downloadTo":
        openPrompt("download to", app.getConfig().downloadDir, (dir) => {
          if (dir.trim()) void commitDetailsDownload(dir.trim());
        });
        break;
      case "copyMagnet":
        showMagnetSelected();
        break;
      case "openMagnet":
        openMagnetSelected();
        break;
      case "back":
        setView("results");
        break;
      case "help":
        goto("help");
        break;
      default:
        navigateAction(action);
        break;
    }
    if (files.length > 0) {
      if (input === " ") {
        const cur = files[Math.min(fileCursor, last)];
        if (cur) toggleFile(cur.path);
      } else if (input.toLowerCase() === "a") {
        setFileChecks(new Set(files.map((f) => f.path)));
      } else if (input.toLowerCase() === "n") {
        setFileChecks(new Set());
      }
    }
  };

  const handleDownloadsKey = (action: KeyAction | null): void => {
    const last = Math.max(0, app.manager.list().length - 1);
    switch (action) {
      case "up":
        setSelectedDownload((s) => Math.max(0, s - 1));
        break;
      case "down":
        setSelectedDownload((s) => Math.min(last, s + 1));
        break;
      case "pageup":
        setSelectedDownload((s) => Math.max(0, s - PAGE_STEP));
        break;
      case "pagedown":
        setSelectedDownload((s) => Math.min(last, s + PAGE_STEP));
        break;
      case "home":
        setSelectedDownload(0);
        break;
      case "end":
        setSelectedDownload(last);
        break;
      case "pause": {
        const item = currentDownload();
        if (item) app.manager.pause(item.id);
        break;
      }
      case "resume": {
        const item = currentDownload();
        if (item) app.manager.resume(item.id);
        break;
      }
      case "toggleSeed": {
        const item = currentDownload();
        if (item) app.manager.toggleSeeding(item.id);
        break;
      }
      case "toggleDetails":
        setDownloadDiagnostics((v) => !v);
        break;
      case "menu":
        openActionMenu();
        break;
      case "remove":
        openConfirm(`Remove "${truncate(currentDownload()?.name ?? "", 50)}" from the list? Files stay on disk.`, () => void removeSelected());
        break;
      case "back":
      case "downloads":
        setView(prevView.current);
        break;
      case "help":
        goto("help");
        break;
      default:
        navigateAction(action);
        break;
    }
  };

  const handleSourcesKey = (action: KeyAction | null): void => {
    const last = Math.max(0, app.sources.length - 1);
    switch (action) {
      case "up":
        setSourcesSelected((s) => Math.max(0, s - 1));
        break;
      case "down":
        setSourcesSelected((s) => Math.min(last, s + 1));
        break;
      case "back":
        setView(prevView.current);
        break;
      case "help":
        goto("help");
        break;
      default:
        navigateAction(action);
        break;
    }
  };

  const handleSettingsKey = (action: KeyAction | null): void => {
    switch (action) {
      case "up":
        moveSettings(-1);
        break;
      case "down":
        moveSettings(1);
        break;
      case "pageup":
        for (let i = 0; i < 5; i++) moveSettings(-1);
        break;
      case "pagedown":
        for (let i = 0; i < 5; i++) moveSettings(1);
        break;
      case "confirm":
        editSettings();
        break;
      case "back":
        setView(prevView.current);
        break;
      case "help":
        goto("help");
        break;
      default:
        navigateAction(action);
        break;
    }
  };

  const handleHomeKey = (action: KeyAction | null, input: string, key: Key): void => {
    // tab toggles between watch (streaming) and download (torrent) mode.
    if (key.tab) {
      toggleSearchMode();
      return;
    }
    // The search box must never eat letters: j/k are bound to up/down for
    // navigation elsewhere, but here they are query text.
    if ((action === "up" || action === "down") && input && input.length === 1 && !key.ctrl && !key.meta) {
      const next = applyTyping(query, cursor, input, key);
      setQuery(next.value);
      setCursor(next.cursor);
      if (next.value !== query) {
        setRecentIndex(0);
        setRecentActive(false);
      }
      return;
    }
    const hasRecents = recentQueries.length > 0;
    switch (action) {
      case "up":
        // Exit the recent list (back to the input) when the first entry is reached.
        if (recentActive && recentIndex > 0) setRecentIndex((i) => i - 1);
        else if (recentActive) setRecentActive(false);
        break;
      case "down":
        // ↓ drops focus onto the recent searches; repeated ↓ moves further down.
        if (!hasRecents) break;
        if (!recentActive) {
          setRecentActive(true);
          setRecentIndex(0);
        } else {
          setRecentIndex((i) => Math.min(recentQueries.length - 1, i + 1));
        }
        break;
      case "confirm":
        if (recentActive) {
          const recent = recentQueries[recentIndex];
          if (searchAction === "watch") startWatchSearch(recent);
          else startSearch(recent);
        } else if (query.trim()) {
          if (searchAction === "watch") startWatchSearch();
          else startSearch();
        } else {
          showMessage("Type a query first.");
        }
        break;
      case "help":
        goto("help");
        break;
      case "back":
        exit();
        break;
      default:
        // Only navigate via 1-4 while the search field is empty, so queries
        // that start with digits keep working while typing.
        if (query.length === 0 && navigateAction(action)) return;
        const next = applyTyping(query, cursor, input, key);
        setQuery(next.value);
        setCursor(next.cursor);
        if (next.value !== query) {
          setRecentIndex(0);
          setRecentActive(false);
        }
        break;
    }
  };

  const handleWatchResultsKey = (action: KeyAction | null, input: string): void => {
    const ch = input.length === 1 ? input : "";
    if (ch === "*" || ch.toLowerCase() === "f") {
      toggleWatchFavorite();
      return;
    }
    const last = Math.max(0, (watchSession?.results.length ?? 1) - 1);
    switch (action) {
      case "up":
        watchSession?.move(-1);
        break;
      case "down":
        watchSession?.move(1);
        break;
      case "pageup":
        watchSession?.setIndex((watchSession?.index ?? 0) - PAGE_STEP);
        break;
      case "pagedown":
        watchSession?.setIndex((watchSession?.index ?? 0) + PAGE_STEP);
        break;
      case "home":
        watchSession?.setIndex(0);
        break;
      case "end":
        watchSession?.setIndex(last);
        break;
      case "confirm":
        if ((watchSession?.results.length ?? 0) > 0) openWatchDetails();
        break;
      case "search":
        goHome();
        break;
      case "back":
        goHome();
        break;
      case "help":
        goto("help");
        break;
      default:
        navigateAction(action);
        break;
    }
  };

  const watchPaneLast = (): number => {
    if (watchPane === "episodes") {
      const details = watchMeta.details;
      return details !== null ? Math.max(0, flattenEpisodes(details).length - 1) : 0;
    }
    return Math.max(0, watchReleases.releases.length - 1);
  };

  const handleWatchDetailsKey = (action: KeyAction | null, input: string, key: Key): void => {
    if (key.tab) {
      const details = watchMeta.details;
      if (details !== null && flattenEpisodes(details).length > 0) {
        setWatchPane(watchPane === "episodes" ? "streams" : "episodes");
        setWatchPaneCursor(0);
        setWatchDownload(null);
      }
      return;
    }
    const ch = input.length === 1 ? input : "";
    if (ch === "*" || ch === "f") {
      toggleWatchFavorite();
      return;
    }
    if (ch === "o") {
      openPlayerPicker();
      return;
    }
    if (ch === "s") {
      openSubtitlesPicker();
      return;
    }
    if (ch.toLowerCase() === "r" && ch === "R") {
      openResolutionPicker();
      return;
    }
    if (ch === "m") {
      openWatchActionsMenu();
      return;
    }
    const last = watchPaneLast();
    switch (action) {
      case "up":
        setWatchPaneCursor((i) => Math.max(0, i - 1));
        break;
      case "down":
        setWatchPaneCursor((i) => Math.min(last, i + 1));
        break;
      case "pageup":
        setWatchPaneCursor((i) => Math.max(0, i - PAGE_STEP));
        break;
      case "pagedown":
        setWatchPaneCursor((i) => Math.min(last, i + PAGE_STEP));
        break;
      case "home":
        setWatchPaneCursor(0);
        break;
      case "end":
        setWatchPaneCursor(last);
        break;
      case "confirm":
        if (watchPane === "streams") playWatchStream(null);
        else selectWatchEpisode();
        break;
      case "pause":
        playWatchStream(null);
        break;
      case "download":
        if (watchPane === "streams") downloadWatchStream();
        break;
      case "menu":
        openWatchActionsMenu();
        break;
      case "back":
        setView("watch");
        break;
      case "help":
        goto("help");
        break;
      default:
        navigateAction(action);
        break;
    }
  };

  useInput((input, key) => {
    if (overlay) {
      handleOverlayKey(input, key);
      return;
    }
    const action = matchKey(app.getConfig().keybindings, input, key);
    switch (view) {
      case "home":
        handleHomeKey(action, input, key);
        break;
      case "results":
        handleResultsKey(action);
        break;
      case "details":
        handleDetailsKey(action, input);
        break;
      case "watch":
        handleWatchResultsKey(action, input);
        break;
      case "watchdetails":
        handleWatchDetailsKey(action, input, key);
        break;
      case "downloads":
        handleDownloadsKey(action);
        break;
      case "sources":
        handleSourcesKey(action);
        break;
      case "settings":
        handleSettingsKey(action);
        break;
      case "help":
        if (action === "quit") exit();
        else setView(prevView.current);
        break;
    }
  });

  // --- layout -------------------------------------------------------------------

  const cfg = app.getConfig();
  void themeTick; // theme changes re-render here (applyTheme mutates the palette)
  const bindings = cfg.keybindings;
  const fk = (action: KeyAction, fallback: string): string => firstKey(bindings, action, fallback);

  let hints: readonly HintItem[];
  switch (view) {
    case "home":
      hints = [
        { keys: fk("confirm", "enter"), label: "search" },
        { keys: "↓", label: "recent" },
        { keys: fk("help", "?"), label: "help" },
        { keys: "esc", label: "quit" },
      ];
      break;
    case "results":
      hints = [
        { keys: fk("confirm", "enter"), label: "open" },
        { keys: fk("search", "/"), label: "search" },
        { keys: fk("downloads", "2"), label: "downloads" },
        { keys: fk("help", "?"), label: "help" },
      ];
      break;
    case "watch":
      hints = [
        { keys: fk("confirm", "enter"), label: "open" },
        { keys: "*", label: "favorite" },
        { keys: fk("search", "/"), label: "search" },
        { keys: "esc", label: "home" },
        { keys: fk("help", "?"), label: "help" },
      ];
      break;
    case "watchdetails":
      hints = [
        { keys: fk("confirm", "enter"), label: "play" },
        { keys: fk("download", "d"), label: "download" },
        { keys: "s", label: "subtitles" },
        { keys: "o", label: "open with" },
        { keys: "*", label: "favorite" },
        { keys: "esc", label: "back" },
      ];
      break;
    case "details":
      hints = [
        { keys: fk("confirm", "enter"), label: "download" },
        { keys: fk("download", "d"), label: "toggle file" },
        { keys: fk("downloadTo", "D"), label: "download to" },
        { keys: fk("copyMagnet", "y"), label: "copy magnet" },
        { keys: "esc", label: "back" },
      ];
      break;
    case "downloads":
      hints = [
        { keys: fk("pause", "p"), label: "pause" },
        { keys: fk("resume", "r"), label: "resume" },
        { keys: fk("menu", "m"), label: "actions" },
        { keys: fk("toggleDetails", "i"), label: "diagnostics" },
        { keys: "esc", label: "back" },
        { keys: fk("help", "?"), label: "help" },
      ];
      break;
    case "sources":
      hints = [
        { keys: "↑↓", label: "inspect" },
        { keys: fk("search", "1"), label: "search" },
        { keys: fk("downloads", "2"), label: "downloads" },
        { keys: fk("settings", "4"), label: "settings" },
        { keys: fk("help", "?"), label: "help" },
      ];
      break;
    case "settings":
      hints = [
        { keys: "enter", label: "edit" },
        { keys: "↑↓", label: "navigate" },
        { keys: "esc", label: "back" },
        { keys: fk("help", "?"), label: "help" },
      ];
      break;
    case "help":
      hints = [{ keys: "any", label: "key to go back" }];
      break;
  }

  const enabledSources = app.sources.filter((s) => app.isSourceEnabled(s.id)).length;
  const summary = app.manager.summary();

  const section: Section = view === "help" ? (prevView.current as Section) : sectionForView(view);

  const reports = session?.sourceReports() ?? new Map<string, SourceReport>();
  const healthCounts: { healthy: number; degraded: number; unavailable: number } = { healthy: 0, degraded: 0, unavailable: 0 };
  for (const [id, r] of reports) {
    if (!app.isSourceEnabled(id)) continue;
    if (r.health === "healthy" || r.health === "working") healthCounts.healthy++;
    else if (r.health === "degraded") healthCounts.degraded++;
    else if (r.health === "failed" || r.health === "unsupported") healthCounts.unavailable++;
  }

  const headerRight = (
    <Text color={palette.dim}>
      {enabledSources} sources ·{" "}
      <Text color={summary.active > 0 ? palette.accent : palette.dim}>
        {summary.active + summary.seeding} active
      </Text>
    </Text>
  );

  const detailsRelease = ((): Release | null => {
    if (view !== "details") return null;
    const cur = currentRelease();
    return cur ? (cur.rels[cur.index] ?? null) : null;
  })();

  const settingsRows = view === "settings" ? buildSettingsRows() : [];

  return (
    <Box flexDirection="column" height={rows}>
      <Header active={section} right={headerRight} compact={compact} />
      <Box flexGrow={1} flexDirection="column" minHeight={0} overflow="hidden">
        {view === "home" ? (
          <SearchHome
            query={query}
            cursor={cursor}
            recentSearches={recentQueries}
            recentIndex={recentIndex}
            recentActive={recentActive}
            downloads={app.manager.list()}
            enabledSources={enabledSources}
            healthCounts={healthCounts}
            activeDownloads={summary.active}
            searchAction={searchAction}
            streamingEnabled={app.getConfig().streamingEnabled}
            compact={compact}
          />
        ) : null}
        {view === "watch" && watchSession ? (
          <WatchResults app={app} session={watchSession} isFavorite={isFavoriteItem} tick={tick} />
        ) : null}
        {view === "watchdetails" && watchDetails ? (
          <WatchDetails
            app={app}
            item={watchDetails.item}
            details={watchMeta.details}
            loading={watchMeta.loading}
            error={watchMeta.error}
            pane={watchPane}
            paneCursor={watchPaneCursor}
            season={watchSeason}
            episode={watchEpisode}
            releases={watchReleases.releases}
            resolutions={watchReleases.resolutions}
            resolution={watchResolution}
            sourcesLoading={watchReleases.loading}
            sourcesError={watchReleases.error}
            sourcesNotice={watchReleases.notice}
            isFavorite={watchIsFav}
            download={watchDownload}
            tick={tick}
          />
        ) : null}
        {view === "results" ? (
          <ResultsView
            app={app}
            session={session}
            selected={selected}
            filter={filter}
            sortSpec={sortOption.spec}
            categoryScope={categoryScope}
            releaseFilter={releaseFilter}
            tick={tick}
            wide={wide}
          />
        ) : null}
        {view === "details" && detailsRelease ? (
          <DetailView
            app={app}
            release={detailsRelease}
            fileItem={detailsFilesId ? app.manager.get(detailsFilesId) : null}
            fileChecks={fileChecks}
            fileCursor={fileCursor}
            tick={tick}
            onToggleFile={toggleFile}
            onSelectAll={() => setFileChecks(new Set(detailsFileList().map((f) => f.path)))}
            onSelectNone={() => setFileChecks(new Set())}
          />
        ) : null}
        {view === "downloads" ? (
          <DownloadsView app={app} selected={selectedDownload} diagnostics={downloadDiagnostics} tick={tick} wide={wide} />
        ) : null}
        {view === "sources" ? <SourcesView app={app} reports={reports} selected={sourcesSelected} /> : null}
        {view === "settings" ? <SettingsView rows={settingsRows} selectedId={settingsSelectedId} /> : null}
        {view === "help" ? <HelpView app={app} /> : null}
      </Box>
      {message ? <Toast>{message}</Toast> : null}
      {playbackStatus !== null ? (
        <Box width="100%" height={1} backgroundColor={palette.surfaceAlt} paddingLeft={1} alignItems="center">
          <Text color={palette.accent} bold wrap="truncate">
            {playbackStatus}
          </Text>
        </Box>
      ) : null}
      {recovery ? (
        <RecoveryBanner
          resumed={recovery.resumed.length}
          completed={recovery.completed.length}
          failed={recovery.failed.length}
        />
      ) : null}
      <Footer hints={hints} />

      {overlay?.kind === "prompt" ? (
        <Modal title={overlay.title}>
          <SearchInput value={promptValue} cursor={promptCursor} prompt="›" />
          <Box marginTop={1} width="100%">
            <Text dimColor wrap="truncate">{overlay.hint ?? "enter confirm · esc cancel"}</Text>
          </Box>
        </Modal>
      ) : null}
      {overlay?.kind === "select" ? (
        <SelectList
          title={overlay.title}
          options={overlay.options}
          selected={overlaySelect}
          hint={overlay.hint}
        />
      ) : null}
      {overlay?.kind === "confirm" ? (
        <Confirm prompt={overlay.prompt} yes={overlayYes} />
      ) : null}
    </Box>
  );
}

function sectionForView(view: View): Section {
  switch (view) {
    case "downloads":
      return "downloads";
    case "sources":
      return "sources";
    case "settings":
      return "settings";
    default:
      return "search";
  }
}

function RecoveryBanner({ resumed, completed, failed }: { resumed: number; completed: number; failed: number }): React.ReactNode {
  return (
    <Box width="100%" height={1} backgroundColor={palette.surfaceAlt} paddingLeft={1} alignItems="center">
      <Text color={palette.accent} bold>
        ⚠ recovered from previous run
      </Text>
      <Text color={palette.dim}>
        {"  ·  "}{resumed} resumed · {completed} verified complete
        {failed > 0 ? <Text color={palette.red} bold> · {failed} failed</Text> : null}
      </Text>
    </Box>
  );
}
