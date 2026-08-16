/**
 * Results view: query summary, live source status strip, and a scrollable
 * release list with strong typographic hierarchy. Each result spans two lines:
 * the title (focus state via accent marker + bold) and a muted metadata line.
 * Presentational — App owns all input.
 */
import { useMemo, useRef } from "react";
import { Box, Text, useBoxMetrics, type DOMElement } from "ink";
import type { Application } from "../app/application.js";
import type { SearchSession, SourceReport, SourceHealth } from "../app/search-service.js";
import type { MediaCategory, Release } from "../model/search.js";
import type { SourceErrorKind } from "../model/source.js";
import type { ReleaseFilter, SortSpec } from "../results/filter.js";
import { formatAudio } from "../media/audio.js";
import { describeFilter, sortLabel } from "../results/filter.js";
import { formatBytes } from "../utils/bytes.js";
import { categoryColor, categoryTag, sourceGlyph, sourceHealthColor } from "./format.js";
import { Spinner, EmptyState } from "./components.js";
import { palette } from "./theme.js";
import { scrollWindow } from "./text.js";

export interface ResultsViewProps {
  app: Application;
  session: SearchSession | null;
  selected: number;
  filter: string;
  sortSpec: SortSpec;
  categoryScope: MediaCategory | null;
  releaseFilter: ReleaseFilter;
  tick: number;
  wide: boolean;
}

export function filteredReleases(
  session: SearchSession | null,
  filter: string,
  releaseFilter: ReleaseFilter,
  categoryScope: MediaCategory | null,
): Release[] {
  const releases = session?.releases() ?? [];
  const cat = categoryScope;
  const scope = releases.filter((r) => (cat === null ? true : r.category === cat));
  const ff = filter.toLowerCase();
  const text = ff ? scope.filter((r) => r.title.toLowerCase().includes(ff) || r.rawTitle.toLowerCase().includes(ff)) : scope;
  return applyReleaseFilter(text, releaseFilter);
}

function applyReleaseFilter(releases: Release[], f: ReleaseFilter): Release[] {
  if (f.maxSize && f.maxSize > 0) {
    releases = releases.filter((r) => (r.size ?? 0) <= f.maxSize!);
  }
  if (f.minSeeders && f.minSeeders > 0) {
    releases = releases.filter((r) => (r.seeders ?? 0) >= f.minSeeders!);
  }
  if (f.quality) {
    releases = releases.filter((r) => r.metadata.quality === f.quality);
  }
  if (f.resolution) {
    releases = releases.filter((r) => r.metadata.resolution === f.resolution);
  }
  if (f.source) {
    releases = releases.filter((r) => r.sources.includes(f.source!));
  }
  if (f.codec) {
    releases = releases.filter((r) => r.metadata.codec?.toLowerCase() === f.codec!.toLowerCase());
  }
  if (f.audioFormat) {
    releases = releases.filter((r) => r.metadata.audio?.codec?.toLowerCase() === f.audioFormat!.toLowerCase());
  }
  if (f.language) {
    releases = releases.filter((r) => r.metadata.languages?.some((l) => l.toLowerCase() === f.language!.toLowerCase()));
  }
  return releases;
}

export function ResultsView({
  app,
  session,
  selected,
  filter,
  sortSpec,
  categoryScope,
  releaseFilter,
  tick,
  wide,
}: ResultsViewProps): React.ReactNode {
  const releases = filteredReleases(session, filter, releaseFilter, categoryScope);
  const len = releases.length;
  const sel = Math.min(selected, Math.max(0, len - 1));

  const listRef = useRef<DOMElement | null>(null);
  const metrics = useBoxMetrics(listRef);
  const rowSlots = Math.max(1, Math.floor(metrics.height / 2));
  const { start, count } = scrollWindow(sel, rowSlots, len);

  const summary = session?.summary();
  const done = session?.isDone();
  const reports = session?.sourceReports();

  const inferred = session?.inference();
  const filterChips = describeFilter(releaseFilter);
  const sortIsDefault = sortSpec.by === "score" && sortSpec.dir === "desc";
  const hasFilterChips = categoryScope !== null || filter.length > 0 || filterChips.length > 0 || !sortIsDefault;

  const sourceNames = useMemo(
    () => new Map(app.sources.map((s) => [s.id, s.name])),
    [app],
  );

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box height={1} paddingLeft={1}>
        <Text bold color={palette.text}>
          {session?.query ?? ""}
        </Text>
        <Text dimColor>  ·  {len} unique results</Text>
        {done ? (
          <Text dimColor>
            {" "}· {summary?.sourcesSucceeded ?? 0} sources ok in {(summary?.elapsedMs ?? 0) / 1000}s
          </Text>
        ) : (
          <Text>
            {"  "}
            <Spinner tick={tick} />
            <Text dimColor> searching…</Text>
          </Text>
        )}
      </Box>

      {inferred ? (
        <Box height={1} paddingLeft={1}>
          <Text color={palette.accent} bold>⚡</Text>
          <Text dimColor> understood:</Text>
          <Text color={palette.subtext}> {describeInference(inferred)}</Text>
          {inferred.mediaType ? (
            <Text dimColor>
              {"  ·  "}preferring sources for <Text color={palette.subtext}>{inferred.mediaType}</Text>
            </Text>
          ) : null}
        </Box>
      ) : null}

      {hasFilterChips ? (
        <Box height={1} paddingLeft={1} gap={2}>
          {categoryScope ? (
            <Chip color={categoryColor(categoryScope)} label={`cat ${categoryTag(categoryScope).trim()}`} />
          ) : null}
          <Chip color={palette.accent} label={`sort ${sortLabel(sortSpec)}`} />
          {filter ? <Chip color={palette.amber} label={`query "${filter}"`} /> : null}
          {filterChips.map((c) => (
            <Chip key={c} color={palette.green} label={c} />
          ))}
        </Box>
      ) : null}

      <SourceStrip app={app} reports={reports} />
      {reports && reports.size > 0 ? <Box height={1} /> : null}

      <Box ref={listRef} flexGrow={1} flexDirection="column" overflow="hidden">
        {len === 0 ? (
          done ? (
            <EmptyState message="No results matched the current scope." hint="try a broader query, or widen the filters" />
          ) : (
            <EmptyState message="Waiting for sources…" hint="results stream in as each source settles" />
          )
        ) : (
          releases.slice(start, start + count).map((r, i) => {
            const idx = start + i;
            return <ResultRow key={r.infohash} release={r} selected={idx === sel} sourceNames={sourceNames} wide={wide} />;
          })
        )}
      </Box>
    </Box>
  );
}

function Chip({ color, label }: { color: string; label: string }): React.ReactNode {
  return (
    <Text color={color}>
      <Text dimColor>·</Text> {label}
    </Text>
  );
}

function describeInference(inferred: NonNullable<ReturnType<SearchSession["inference"]>>): string {
  const parts: string[] = [];
  if (inferred.title) parts.push(`"${inferred.title}"`);
  if (inferred.mediaType) parts.push(inferred.mediaType);
  if (inferred.artist) parts.push(`by ${inferred.artist}`);
  if (inferred.year) parts.push(`(${inferred.year})`);
  if (inferred.season) parts.push(`S${inferred.season}`);
  if (inferred.episode) parts.push(`E${inferred.episode}`);
  return parts.join(" ") || "generic search";
}

// --- pieces ----------------------------------------------------------------

function healthOf(r: SourceReport): SourceHealth {
  return r.health ?? (r.status === "ok" ? (r.results > 0 ? "healthy" : "working") : "failed");
}

const FAILURE_LABEL: Record<SourceErrorKind, string> = {
  timeout: "timeout",
  http: "HTTP failure",
  parse: "parser failure",
  unavailable: "network failure",
  cancelled: "aborted",
  unsupported: "unsupported",
};

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
  return (
    <Box height={1} paddingLeft={1} gap={2}>
      {entries.map(([id, r]) => {
        const name = sourceNames.get(id) ?? id;
        const health = healthOf(r);
        const glyph = sourceGlyph(health);
        const color = sourceHealthColor(health);
        const text =
          r.status === "ok"
            ? r.results > 0
              ? `${glyph} ${name} ${r.results}`
              : `${glyph} ${name} 0`
            : r.status === "pending"
              ? `${glyph} ${name} …`
              : `${glyph} ${name} ${r.failure ? FAILURE_LABEL[r.failure.kind] : "error"}`;
        return (
          <Text key={id} color={color} wrap="truncate">
            {text}
          </Text>
        );
      })}
    </Box>
  );
}

function ResultRow({
  release,
  selected,
  sourceNames,
  wide,
}: {
  release: Release;
  selected: boolean;
  sourceNames: Map<string, string>;
  wide: boolean;
}): React.ReactNode {
  const md = release.metadata;
  const size = formatBytes(release.size);
  const seeds = release.seeders === undefined ? "–" : String(release.seeders);
  const peers = release.leechers === undefined ? "–" : String(release.leechers);
  const files = release.files === undefined ? "–" : String(release.files);
  const metaBits = [
    size,
    `${seeds} seeds`,
    `${peers} peers`,
    `${release.sources.length} source${release.sources.length === 1 ? "" : "s"}`,
  ];
  if (files !== "–") metaBits.push(`${files} files`);
  const sources = release.sources.map((s) => sourceNames.get(s) ?? s).join(", ");
  const spec = [md.quality, md.resolution, md.codec].filter(Boolean).join(" · ");
  const audio = formatAudio(md.audio);

  return (
    <Box flexDirection="column" width="100%">
      <Box height={1} width="100%" backgroundColor={selected ? palette.surfaceAlt : undefined} paddingLeft={1}>
        <Box width={2}>
          <Text color={selected ? palette.accent : palette.faint} bold={selected}>
            {selected ? "›" : " "}
          </Text>
        </Box>
        <Box flexGrow={1} paddingRight={1}>
          <Text wrap="truncate" color={selected ? palette.text : palette.subtext} bold={selected}>
            {release.title}
          </Text>
        </Box>
        <Box width={8} justifyContent="flex-end" paddingRight={2}>
          <Text color={selected ? palette.accent : palette.dim} wrap="truncate">
            {spec}
          </Text>
        </Box>
      </Box>
      <Box height={1} width="100%" paddingLeft={4}>
        <Text color={selected ? palette.dim : palette.faint} wrap="truncate">
          {metaBits.join("  ·  ")}
          {wide && sources.length > 0 ? <Text dimColor>  —  {sources}</Text> : null}
        </Text>
      </Box>
    </Box>
  );
}