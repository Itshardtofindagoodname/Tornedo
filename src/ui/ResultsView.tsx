/**
 * Results view: query summary, live source status strip, scrollable release
 * list, and an optional details panel. Presentational — App owns all input.
 */
import { useMemo, useRef } from "react";
import { Box, Text, useBoxMetrics, type DOMElement } from "ink";
import type { Application } from "../app/application.js";
import type { SearchSession, SourceReport } from "../app/search-service.js";
import type { Release } from "../model/search.js";
import { formatAudio } from "../media/audio.js";
import { formatBytes } from "../utils/bytes.js";
import { truncate } from "../utils/duration.js";
import { categoryColor, categoryTag, sourceColor } from "./format.js";
import { Spinner } from "./components.js";
import { palette } from "./theme.js";
import { scrollWindow } from "./text.js";

export interface ResultsViewProps {
  app: Application;
  session: SearchSession | null;
  selected: number;
  details: boolean;
  filter: string;
  tick: number;
}

export function filteredReleases(session: SearchSession | null, filter: string): Release[] {
  const releases = session?.releases() ?? [];
  if (!filter) return releases;
  const f = filter.toLowerCase();
  return releases.filter(
    (r) => r.title.toLowerCase().includes(f) || r.rawTitle.toLowerCase().includes(f),
  );
}

export function ResultsView({
  app,
  session,
  selected,
  details,
  filter,
  tick,
}: ResultsViewProps): React.ReactNode {
  const releases = filteredReleases(session, filter);
  const len = releases.length;
  const sel = Math.min(selected, Math.max(0, len - 1));

  const listRef = useRef<DOMElement | null>(null);
  const metrics = useBoxMetrics(listRef);
  const rows = Math.max(1, metrics.height);
  const { start, count } = scrollWindow(sel, rows, len);

  const summary = session?.summary();
  const done = session?.isDone();
  const reports = session?.sourceReports();

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box height={1} paddingLeft={1}>
        <Text bold color={palette.text}>
          {session?.query ?? ""}
        </Text>
        <Text dimColor>  ·  {len} unique results</Text>
        {done ? (
          <Text dimColor>
            {" "}· {summary?.sourcesSucceeded ?? 0} sources ok in {summary?.elapsedMs ?? 0}ms
          </Text>
        ) : (
          <Text>
            {"  "}
            <Spinner tick={tick} />
            <Text dimColor> searching…</Text>
          </Text>
        )}
      </Box>

      <SourceStrip app={app} reports={reports} />
      {reports && reports.size > 0 ? <Box height={1} /> : null}

      <Box ref={listRef} flexGrow={1} flexDirection="column" overflow="hidden">
        {len === 0 ? (
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Text dimColor>{done ? "No results matched." : "Waiting for sources…"}</Text>
          </Box>
        ) : (
          releases.slice(start, start + count).map((r, i) => {
            const idx = start + i;
            return <ResultRow key={r.infohash} release={r} selected={idx === sel} />;
          })
        )}
      </Box>

      {details && len > 0 ? (
        <Box marginBottom={1}>
          <ReleaseDetails release={releases[sel]!} />
        </Box>
      ) : null}
    </Box>
  );
}

// --- pieces ----------------------------------------------------------------

function SourceStrip({
  app,
  reports,
}: {
  app: Application;
  reports?: Map<string, SourceReport>;
}): React.ReactNode {
  const sourceNames = useMemo(
    () => new Map(app.sources.map((s) => [s.id, s.name])),
    [app],
  );
  if (!reports || reports.size === 0) return null;
  const entries = [...reports.entries()];
  const kindLabel: Record<NonNullable<SourceReport["failure"]>["kind"], string> = {
    timeout: "timeout",
    http: "HTTP",
    parse: "parse",
    unavailable: "down",
    cancelled: "aborted",
  };
  return (
    <Box height={1} paddingLeft={1} gap={2}>
      {entries.map(([id, r]) => {
        const name = sourceNames.get(id) ?? id;
        const color =
          r.status === "ok" ? sourceColor(id) : r.status === "error" ? palette.red : palette.dim;
        const text =
          r.status === "ok"
            ? `${name}:${r.results}`
            : r.status === "error"
              ? `${name}:✗${r.failure ? ` ${kindLabel[r.failure.kind]}` : ""}`
              : `${name}:…`;
        return (
          <Text key={id} color={color} wrap="truncate">
            {text}
          </Text>
        );
      })}
    </Box>
  );
}

function ResultRow({ release, selected }: { release: Release; selected: boolean }): React.ReactNode {
  const md = release.metadata;
  const quality = md.quality ?? "";
  const size = formatBytes(release.size);
  const seeds = release.seeders === undefined ? "–" : String(release.seeders);
  const titleColor = selected ? palette.bg : palette.text;

  return (
    <Box
      height={1}
      width="100%"
      backgroundColor={selected ? palette.accent : undefined}
      paddingLeft={1}
    >
      <Box width={2}>
        <Text color={selected ? palette.bg : palette.faint}>{selected ? "❯" : " "}</Text>
      </Box>
      <Box width={6}>
        <Text color={selected ? palette.bg : categoryColor(release.category)}>
          {categoryTag(release.category)}
        </Text>
      </Box>
      <Box flexGrow={1} paddingRight={1}>
        <Text wrap="truncate" color={titleColor}>
          {release.title}
        </Text>
      </Box>
      <Box width={8}>
        <Text color={selected ? palette.bg : palette.dim} wrap="truncate">
          {quality}
        </Text>
      </Box>
      <Box width={11}>
        <Text color={selected ? palette.bg : palette.subtext}>{size}</Text>
      </Box>
      <Box width={7}>
        <Text color={selected ? palette.bg : palette.green}>{seeds}</Text>
      </Box>
      <Box width={1} />
    </Box>
  );
}

function ReleaseDetails({ release }: { release: Release }): React.ReactNode {
  const md = release.metadata;
  const audio = formatAudio(md.audio);
  const seg = [md.quality, md.resolution, md.codec, md.container, md.source, md.group, audio]
    .filter(Boolean)
    .join(" · ");
  const tags: string[] = [];
  if (md.year) tags.push(`year ${md.year}`);
  if (md.season) tags.push(`S${String(md.season).padStart(2, "0")}`);
  if (md.episode) tags.push(`E${String(md.episode).padStart(2, "0")}`);
  if (md.languages?.length) tags.push(md.languages.join("/"));
  if (md.subtitles?.length) tags.push(`subs ${md.subtitles.join("/")}`);
  if (md.edition?.length) tags.push(md.edition.join(", "));

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor={palette.border}
      paddingX={2}
      paddingY={1}
    >
      <Text bold color={palette.text}>
        {release.title}
      </Text>
      {seg ? (
        <Text dimColor>
          specs: <Text color={palette.subtext}>{seg}</Text>
        </Text>
      ) : null}
      {tags.length > 0 ? (
        <Text dimColor>
          tags: <Text color={palette.subtext}>{truncate(tags.join("  "), 120)}</Text>
        </Text>
      ) : null}
      <Text dimColor>
        sources: <Text color={palette.subtext}>{truncate(release.sources.join(", "), 120)}</Text>
      </Text>
      <Text dimColor>
        size: <Text color={palette.subtext}>{formatBytes(release.size)}</Text>
        <Text dimColor>
          {"  "}seeders {release.seeders ?? "-"} · leechers {release.leechers ?? "-"} · files{" "}
          {release.files ?? "-"}
        </Text>
      </Text>
    </Box>
  );
}