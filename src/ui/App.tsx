/**
 * TornedoApp: the Ink application root. Owns all UI state, subscribes to the
 * search session and download manager, and translates every keypress into a
 * logical action. The views below it are purely presentational.
 */
import { useEffect, useRef, useState } from "react";
import { Box, Text, useApp, useInput, useWindowSize, type Key } from "ink";
import type { Application } from "../app/application.js";
import type { SearchSession } from "../app/search-service.js";
import type { KeyAction } from "../config/config.js";
import { MEDIA_CATEGORIES, type MediaCategory } from "../model/search.js";
import type { TorrentItem } from "../model/torrent.js";
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
  TextInput,
  Toast,
  type HintItem,
  type SelectOption,
} from "./components.js";
import { DownloadsView } from "./DownloadsView.js";
import { HelpView } from "./HelpView.js";
import { useManagerEvents, useRecovery, useRerenderInterval, useSearchSession } from "./hooks.js";
import { firstKey, matchKey } from "./keys.js";
import { filteredReleases, ResultsView } from "./ResultsView.js";
import { SearchHome } from "./SearchHome.js";
import { palette } from "./theme.js";
import { applyTyping } from "./text.js";

type View = "home" | "results" | "downloads" | "help";

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
  const { rows } = useWindowSize();

  const [view, setView] = useState<View>("home");
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState(0);
  const [selectedDownload, setSelectedDownload] = useState(0);
  const [downloadDiagnostics, setDownloadDiagnostics] = useState(false);
  const [details, setDetails] = useState(false);
  const [filter, setFilter] = useState("");
  const [session, setSession] = useState<SearchSession | null>(null);

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

  const [message, setMessage] = useState<string | null>(null);

  const prevView = useRef<View>("home");
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useRerenderInterval(250);
  useSearchSession(session);
  useManagerEvents(app);
  const recovery = useRecovery(app);

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

  const goto = (next: View): void => {
    prevView.current = view;
    setView(next);
  };

  // --- search ---------------------------------------------------------------

  const startSearch = (): void => {
    const q = query.trim();
    if (!q) {
      showMessage("Type a query first.");
      return;
    }
    if (session) session.cancel();
    const s = app.searchService.createSession(q);
    setSession(s);
    s.start();
    setSelected(0);
    setFilter("");
    setCategoryScope(null);
    setReleaseFilter({});
    setFilterText("");
    setSortOption(SORT_OPTIONS[0]!);
    setDetails(false);
    setView("results");
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
    } else {
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

  const currentReleases = (): ReturnType<typeof filteredReleases> => filteredReleases(session, filter, releaseFilter, categoryScope);

  const downloadSelected = (destination?: string): void => {
    const rels = currentReleases();
    const idx = Math.min(selected, Math.max(0, rels.length - 1));
    const r = rels[idx];
    if (!r) return;
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

  // --- key dispatch ------------------------------------------------------------

  const handleResultsKey = (action: KeyAction | null): void => {
    const rels = currentReleases();
    const last = Math.max(0, rels.length - 1);
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
      case "download":
        downloadSelected();
        break;
      case "downloadTo":
        openPrompt("download to", app.getConfig().downloadDir, (dir) => {
          if (dir.trim()) downloadSelected(dir.trim());
        });
        break;
      case "toggleDetails":
        setDetails((d) => !d);
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
      case "search":
        setView("home");
        setCursor(query.length);
        break;
      case "downloads":
        goto("downloads");
        break;
      case "help":
        goto("help");
        break;
      case "back":
        setView("home");
        break;
      case "copyMagnet": {
        const idx = Math.min(selected, last);
        const r = rels[idx];
        if (r) showMessage(`magnet: ${truncate(r.magnet, 140)}`);
        break;
      }
      default:
        break;
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
        if (action === "confirm") {
          startSearch();
        } else if (action === "downloads") {
          goto("downloads");
        } else if (action === "help") {
          goto("help");
        } else if (action === "back") {
          exit();
        } else {
          const next = applyTyping(query, cursor, input, key);
          setQuery(next.value);
          setCursor(next.cursor);
        }
        break;
      case "results":
        handleResultsKey(action);
        break;
      case "downloads":
        handleDownloadsKey(action);
        break;
      case "help":
        if (action === "quit") exit();
        else setView(prevView.current);
        break;
    }
  });

  // --- layout -------------------------------------------------------------------

  const cfg = app.getConfig();
  const bindings = cfg.keybindings;
  const fk = (action: KeyAction, fallback: string): string => firstKey(bindings, action, fallback);

  let hints: readonly HintItem[];
  switch (view) {
    case "home":
      hints = [
        { keys: "enter", label: "search" },
        { keys: fk("downloads", "v"), label: "downloads" },
        { keys: fk("help", "?"), label: "help" },
        { keys: "esc", label: "quit" },
      ];
      break;
    case "results":
      hints = [
        { keys: fk("confirm", "enter"), label: "download" },
        { keys: fk("downloadTo", "D"), label: "download to" },
        { keys: fk("filter", "ctrl+f"), label: "filter" },
        { keys: fk("category", "c"), label: "category" },
        { keys: fk("sort", "o"), label: "sort" },
        { keys: fk("downloads", "v"), label: "downloads" },
        { keys: fk("help", "?"), label: "help" },
        { keys: fk("quit", "q"), label: "quit" },
      ];
      break;
    case "downloads":
      hints = [
        { keys: fk("pause", "p"), label: "pause" },
        { keys: fk("resume", "r"), label: "resume" },
        { keys: fk("menu", "m"), label: "actions" },
        { keys: fk("toggleSeed", "s"), label: "seed" },
        { keys: fk("toggleDetails", "i"), label: "diagnostics" },
        { keys: fk("back", "esc"), label: "back" },
        { keys: fk("help", "?"), label: "help" },
        { keys: fk("quit", "q"), label: "quit" },
      ];
      break;
    case "help":
      hints = [{ keys: "any", label: "key to go back" }];
      break;
  }

  const enabledSources = app.sources.filter((s) => app.isSourceEnabled(s.id)).length;
  const healthSources = app.sources.filter((s) => s.reportsHealth && app.isSourceEnabled(s.id)).length;
  const summary = app.manager.summary();

  const headerRight = (
    <Text color={palette.bg}>
      {enabledSources} sources · {summary.active + summary.seeding} active
    </Text>
  );

  return (
    <Box flexDirection="column" height={rows}>
      <Header right={headerRight} />
      <Box flexGrow={1} flexDirection="column" minHeight={0}>
        {view === "home" ? (
          <SearchHome
            query={query}
            cursor={cursor}
            enabledSources={enabledSources}
            healthSources={healthSources}
            maxActiveDownloads={cfg.maxActiveDownloads}
          />
        ) : null}
        {view === "results" ? (
          <ResultsView
            app={app}
            session={session}
            selected={selected}
            details={details}
            filter={filter}
            sortSpec={sortOption.spec}
            categoryScope={categoryScope}
            releaseFilter={releaseFilter}
            tick={tick}
          />
        ) : null}
        {view === "downloads" ? <DownloadsView app={app} selected={selectedDownload} diagnostics={downloadDiagnostics} tick={tick} /> : null}
        {view === "help" ? <HelpView app={app} /> : null}
      </Box>
      {message ? <Toast>{message}</Toast> : null}
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
          <TextInput value={promptValue} cursor={promptCursor} />
          <Box marginTop={1} width={58}>
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

function RecoveryBanner({ resumed, completed, failed }: { resumed: number; completed: number; failed: number }): React.ReactNode {
  return (
    <Box width="100%" height={1} backgroundColor={palette.yellow} paddingLeft={1} alignItems="center">
      <Text color={palette.bg} bold>
        ⚠ recovered from previous run
      </Text>
      <Text color={palette.bg}>
        {"  ·  "}{resumed} resumed · {completed} verified complete
        {failed > 0 ? <Text color={palette.bg} bold> · {failed} failed</Text> : null}
      </Text>
    </Box>
  );
}