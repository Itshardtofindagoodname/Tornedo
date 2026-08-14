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
import type { TorrentItem } from "../model/torrent.js";
import { truncate } from "../utils/duration.js";
import { Footer, Header, Modal, TextInput, Toast, type HintItem } from "./components.js";
import { DownloadsView } from "./DownloadsView.js";
import { HelpView } from "./HelpView.js";
import { useManagerEvents, useRerenderInterval, useSearchSession } from "./hooks.js";
import { firstKey, matchKey } from "./keys.js";
import { filteredReleases, ResultsView } from "./ResultsView.js";
import { SearchHome } from "./SearchHome.js";
import { palette } from "./theme.js";
import { applyTyping } from "./text.js";

type View = "home" | "results" | "downloads" | "help";

interface PromptState {
  title: string;
  onSubmit: (value: string) => void;
}

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
  const [details, setDetails] = useState(false);
  const [filter, setFilter] = useState("");
  const [session, setSession] = useState<SearchSession | null>(null);
  const [prompt, setPrompt] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const [promptCursor, setPromptCursor] = useState(0);
  const [message, setMessage] = useState<string | null>(null);

  const prevView = useRef<View>("home");
  const messageTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const tick = useRerenderInterval(250);
  useSearchSession(session);
  useManagerEvents(app);

  useEffect(() => {
    showMessage("Queued: Dune");
  }, []);

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
    setDetails(false);
    setView("results");
  };

  const openPrompt = (title: string, initial: string, onSubmit: (value: string) => void): void => {
    setPrompt({ title, onSubmit });
    setPromptValue(initial);
    setPromptCursor(initial.length);
  };

  const closePrompt = (): void => {
    setPrompt(null);
    setPromptValue("");
    setPromptCursor(0);
  };

  const confirmPrompt = (): void => {
    const p = prompt;
    const value = promptValue;
    closePrompt();
    if (p) p.onSubmit(value);
  };

  const handlePromptKey = (input: string, key: Key): void => {
    if (key.return) {
      confirmPrompt();
      return;
    }
    if (key.escape) {
      closePrompt();
      return;
    }
    const next = applyTyping(promptValue, promptCursor, input, key);
    setPromptValue(next.value);
    setPromptCursor(next.cursor);
  };

  // --- downloads --------------------------------------------------------------

  const downloadSelected = (destination?: string): void => {
    const rels = filteredReleases(session, filter);
    const idx = Math.min(selected, Math.max(0, rels.length - 1));
    const r = rels[idx];
    if (!r) return;
    const cfg = app.getConfig();
    const item = app.manager.add({
      infohash: r.infohash,
      magnet: r.magnet,
      name: r.title,
      category: r.category,
      metadata: r.metadata,
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

  // --- key dispatch ------------------------------------------------------------

  const handleResultsKey = (action: KeyAction | null): void => {
    const rels = filteredReleases(session, filter);
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
        openPrompt("filter results", filter, (v) => {
          setFilter(v.trim());
          setSelected(0);
        });
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
      case "remove":
        void removeSelected();
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
    if (prompt) {
      handlePromptKey(input, key);
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
          // Typing in the search box; bound actions like `v` take priority.
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
        { keys: fk("search", "/"), label: "search" },
        { keys: fk("downloads", "v"), label: "downloads" },
        { keys: fk("help", "?"), label: "help" },
        { keys: fk("quit", "q"), label: "quit" },
      ];
      break;
    case "downloads":
      hints = [
        { keys: fk("pause", "p"), label: "pause" },
        { keys: fk("resume", "r"), label: "resume" },
        { keys: fk("remove", "x"), label: "remove" },
        { keys: fk("toggleSeed", "s"), label: "seed" },
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
            tick={tick}
          />
        ) : null}
        {view === "downloads" ? <DownloadsView app={app} selected={selectedDownload} /> : null}
        {view === "help" ? <HelpView app={app} /> : null}
      </Box>
      {message ? <Toast>{message}</Toast> : null}
      <Footer hints={hints} />
      {prompt ? (        <Modal title={prompt.title}>
          <TextInput value={promptValue} cursor={promptCursor} />
          <Box marginTop={1}>
            <Text dimColor>enter confirm · esc cancel</Text>
          </Box>
        </Modal>
      ) : null}
    </Box>
  );
}
