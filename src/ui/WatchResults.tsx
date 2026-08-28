/**
 * Watch (streaming) results: compact title rows of MovieBox / 4KHDHub / addon
 * results with a per-provider status bar. Pure presentation — the
 * WatchSearchSession owns selection/cancellation, App owns key dispatch.
 */
import { Box, Text, useWindowSize } from "ink";
import type { Application } from "../app/application.js";
import { providerLabel, StreamCatalogItem, StreamProviderId } from "../stream/models.js";
import type { WatchSearchSession } from "../stream/session.js";
import { palette } from "./theme.js";
import { Spinner } from "./components.js";
import { scrollWindow } from "./text.js";

export interface WatchResultsProps {
  app: Application;
  session: WatchSearchSession;
  compact?: boolean;
  /** Whether the given item is already a favorite (rendered as a star). */
  isFavorite: (item: StreamCatalogItem) => boolean;
  /** Render tick: re-renders while providers are still searching. */
  tick: number;
}

// Each result is a two-line text row (title + meta) — no poster art.
const ROW_HEIGHT = 2;

function statusColor(state: "idle" | "running" | "done" | "error"): string {
  switch (state) {
    case "error":
      return palette.red;
    case "done":
      return palette.green;
    case "running":
      return palette.accent;
    default:
      return palette.faint;
  }
}

function statusGlyph(state: "idle" | "running" | "done" | "error"): string {
  switch (state) {
    case "error":
      return "✕";
    case "done":
      return "✓";
    case "running":
      return "…";
    default:
      return "·";
  }
}

function typeLabel(item: StreamCatalogItem): string {
  switch (item.mediaType) {
    case "movie":
      return "movie";
    case "series":
      return "series";
    case "tv":
      return "live tv";
    default:
      return "title";
  }
}

export function WatchResults({ session, isFavorite, tick }: WatchResultsProps): React.ReactNode {
  void tick;
  const { rows: screenRows } = useWindowSize();
  const screen = screenRows || 24;
  // App header (3) + provider status bar (1) + footer (2) + margins.
  const rowsBudget = Math.max(ROW_HEIGHT, screen - 9);
  const slots = Math.max(1, Math.floor(rowsBudget / ROW_HEIGHT));
  const { start, count } = scrollWindow(session.index, slots, session.results.length);
  const windowed = session.results.slice(start, start + count);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={2} paddingTop={1}>
      <Box height={1} width="100%">
        <Text bold color={palette.text}>
          watch
        </Text>
        <Text color={palette.dim}>  ·  “{session.query}”</Text>
        {!session.done ? (
          <Box marginLeft={1}>
            <Spinner tick={tick} />
          </Box>
        ) : null}
        <Box flexGrow={1} />
        <Text color={palette.faint}>{session.results.length} results</Text>
      </Box>

      <Box height={1} width="100%" marginTop={1}>
        {session.providerStatus.map((p) => (
          <Box key={p.name} marginRight={3}>
            <Text color={statusColor(p.state)} bold>
              {statusGlyph(p.state)}
            </Text>
            <Text color={statusColor(p.state)}> {p.name}</Text>
            {p.state === "running" ? (
              <Text color={palette.faint}>…</Text>
            ) : p.count > 0 ? (
              <Text color={palette.dim}> {p.count}</Text>
            ) : null}
          </Box>
        ))}
      </Box>

      {session.results.length === 0 ? (
        <Box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
          <Text color={palette.dim}>{session.done ? "No streaming sources found." : "Searching providers…"}</Text>
          {session.errors.length > 0 ? (
            <Box marginTop={1} flexDirection="column">
              {session.errors.map((e) => (
                <Text key={e.provider} color={palette.red}>
                  {e.provider}: {e.message}
                </Text>
              ))}
            </Box>
          ) : null}
        </Box>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {windowed.map((item, i) => {
            const idx = start + i;
            const selected = idx === session.index;
            const fav = isFavorite(item);
            return (
              <Box key={`${item.provider}:${item.id}:${idx}`} height={ROW_HEIGHT} width="100%">
                <Box flexDirection="column" flexGrow={1}>
                  <Box height={1} width="100%" backgroundColor={selected ? palette.surfaceAlt : undefined} paddingLeft={1}>
                    <Text bold color={selected ? palette.accent : palette.text} wrap="truncate">
                      {selected ? "›" : " "} {item.title}
                    </Text>
                    {fav ? <Text color={palette.amber}> ★</Text> : null}
                  </Box>
                  <Box height={1} width="100%" paddingLeft={3} backgroundColor={selected ? palette.surfaceAlt : undefined}>
                    <Text color={selected ? palette.accent : palette.subtext} wrap="truncate">
                      {typeLabel(item)}
                      {item.year !== undefined ? <>{`  ·  ${item.year}`}</> : null}
                      {"  ·  "}
                      <Text color={palette.dim}>{providerLabel(item.provider)}</Text>
                      {item.mediaType === "series" && (item.seasonCount ?? 0) > 0 ? (
                        <>
                          {"  ·  "}
                          <Text color={palette.dim}>{item.seasonCount} seasons</Text>
                        </>
                      ) : null}
                    </Text>
                  </Box>
                </Box>
              </Box>
            );
          })}
          {session.results.length > count ? (
            <Box height={1}>
              <Text color={palette.faint}>
                ↑↓ browse · {start + 1}–{start + count} of {session.results.length}
              </Text>
            </Box>
          ) : null}
        </Box>
      )}
    </Box>
  );
}