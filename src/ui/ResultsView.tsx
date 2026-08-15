/**
 * Results view: query summary, live source status strip, scrollable release
 * list, and an optional details panel. Presentational — App owns all input.
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
  sortSpec: SortSpec;
  categoryScope: MediaCategory | null;
  releaseFilter: ReleaseFilter;
  tick: number;
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
  details,
  filter,
  sortSpec,
  categoryScope,
  releaseFilter,
  tick,
}: ResultsViewProps): React.ReactNode {
  const releases = filteredReleases(session, filter, releaseFilter, categoryScope);
  const len = releases.length;
  const sel = Math.min(selected, Math.max(0, len - 1));

  const listRef = useRef<DOMElement | null>(null);
  const metrics = useBoxMetrics(listRef);
  const rows = Math.max(1, metrics.height);
  const { start, count } = scrollWindow(sel, rows, len);

  const summary = session?.summary();
  const done = session?.isDone();
  const reports = session?.sourceReports();

  const inferred = session?.inference();
  const filterChips = describeFilter(releaseFilter);
  const sortIsDefault = sortSpec.by === "score" && sortSpec.dir === "desc";
  const hasFilterChips = categoryScope !== null || filter.length > 0 || filterChips.length > 0 || !sortIsDefault;

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

      {inferred ? (
        <Box height={1} paddingLeft={1}>
          <Text color={palette.magenta} bold>⚡</Text>
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
          {filter ? <Chip color={palette.yellow} label={`query "${filter}"`} /> : null}
          {filterChips.map((c) => (
            <Chip key={c} color={palette.green} label={c} />
          ))}
        </Box>
      ) : null}

      <SourceStrip app={app} reports={reports} />
      {reports && reports.size > 0 ? <Box height={1} /> : null}

      <Box ref={listRef} flexGrow={1} flexDirection="column" overflow="hidden">
        {len === 0 ? (
          <Box flexGrow={1} alignItems="center" justifyContent="center">
            <Text dimColor>{done ? "No results matched the current scope." : "Waiting for sources…"}</Text>
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

const HEALTH_GLYPH: Record<SourceHealth, string> = {
  healthy: "●",
  working: "◐",
  idle: "◌",
  degraded: "⚠",
  failed: "✕",
  unsupported: "—",
};

const HEALTH_COLOR: Record<SourceHealth, string> = {
  healthy: sourceColor("x"),
  working: palette.dim,
  idle: palette.dim,
  degraded: palette.yellow,
  failed: palette.red,
  unsupported: palette.dim,
};

const FAILURE_LABEL: Record<SourceErrorKind, string> = {
  timeout: "timeout",
  http: "HTTP failure",
  parse: "parser failure",
  unavailable: "network failure",
  cancelled: "aborted",
  unsupported: "unsupported",
};

function healthOf(r: SourceReport): SourceHealth {
  return r.health ?? (r.status === "ok" ? (r.results > 0 ? "healthy" : "working") : "failed");
}

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
        const glyph = HEALTH_GLYPH[health];
        const color = HEALTH_COLOR[health];
        const text =
          r.status === "ok"
            ? r.results > 0
              ? `${glyph} ${name}:${r.results}`
              : `${glyph} ${name}:0`
            : r.status === "pending"
              ? `${glyph} ${name}:…`
              : `${glyph} ${name}: ${r.failure ? FAILURE_LABEL[r.failure.kind] : "error"}`;
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