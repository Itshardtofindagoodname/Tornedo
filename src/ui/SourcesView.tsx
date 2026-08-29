/**
 * Sources view: makes the federated search network visible. Each source shows a
 * health glyph + label, its last-search outcome (results / failure), and its
 * enabled state. Selecting a source reveals its profile (groups, categories,
 * homepage). All values are real - health comes from the last search session,
 * and sources that have never run are honestly marked "untested".
 */
import { useMemo, useRef } from "react";
import { Box, Text, useBoxMetrics, type DOMElement } from "ink";
import type { Application } from "../app/application.js";
import type { SourceReport, SourceHealth } from "../app/search-service.js";
import type { SourceAdapter } from "../model/source.js";
import { sourceGlyph, sourceHealthColor, sourceHealthLabel } from "./format.js";
import { Separator, EmptyState } from "./components.js";
import { palette } from "./theme.js";
import { scrollWindow } from "./text.js";

export interface SourcesViewProps {
  app: Application;
  /** Reports from the most recent search session (may be empty). */
  reports: Map<string, SourceReport>;
  selected: number;
}

type SourceStatus = {
  adapter: SourceAdapter;
  enabled: boolean;
  health: SourceHealth | "untested";
  results: number | null;
  failure?: string;
};

export function SourcesView({ app, reports, selected }: SourcesViewProps): React.ReactNode {
  const rows = useMemo(() => {
    const out: SourceStatus[] = [];
    for (const s of app.sources) {
      const enabled = app.isSourceEnabled(s.id);
      const report = reports.get(s.id);
      let health: SourceHealth | "untested" = "untested";
      let results: number | null = null;
      let failure: string | undefined;
      if (report) {
        health = report.health;
        results = report.status === "ok" ? report.results : null;
        if (report.status === "error" && report.failure) failure = report.failure.message || report.failure.kind;
      }
      out.push({ adapter: s, enabled, health, results, failure });
    }
    return out;
  }, [app, reports]);

  const enabled = rows.filter((r) => r.enabled).length;
  const healthy = rows.filter((r) => r.enabled && (r.health === "healthy" || r.health === "working")).length;
  const degraded = rows.filter((r) => r.enabled && r.health === "degraded").length;
  const unavailable = rows.filter((r) => r.enabled && (r.health === "failed" || r.health === "unsupported")).length;
  const untested = rows.filter((r) => r.enabled && r.health === "untested").length;

  const len = rows.length;
  const sel = Math.min(selected, Math.max(0, len - 1));
  const listRef = useRef<DOMElement | null>(null);
  const metrics = useBoxMetrics(listRef);
  const rowSlots = Math.max(1, metrics.height);
  const { start, count } = scrollWindow(sel, rowSlots, len);

  return (
    <Box flexDirection="column" flexGrow={1} paddingX={1}>
      <Box height={1} paddingLeft={1}>
        <Text bold color={palette.text}>
          Sources
        </Text>
        <Text dimColor>
          {"  |  "}
          {enabled} enabled
          {healthy > 0 ? <Text color={palette.green}> | {healthy} healthy</Text> : null}
          {degraded > 0 ? <Text color={palette.amber}> | {degraded} degraded</Text> : null}
          {unavailable > 0 ? <Text color={palette.red}> | {unavailable} unavailable</Text> : null}
          {untested > 0 ? <Text color={palette.dim}> | {untested} untested</Text> : null}
        </Text>
      </Box>

      <Box paddingX={1} marginTop={1}>
        <Separator />
      </Box>

      <Box ref={listRef} flexGrow={1} flexDirection="column" overflow="hidden" marginTop={1}>
        {len === 0 ? (
          <EmptyState message="No sources configured." hint="run a search to see live federation health" />
        ) : (
          rows.slice(start, start + count).map((row, i) => {
            const idx = start + i;
            return <SourceRow key={row.adapter.id} status={row} selected={idx === sel} />;
          })
        )}
      </Box>

      {rows[sel] ? <SourceProfile status={rows[sel]!} /> : null}
    </Box>
  );
}

function SourceRow({ status, selected }: { status: SourceStatus; selected: boolean }): React.ReactNode {
  const { adapter, enabled, health } = status;
  const color = health === "untested" ? palette.dim : sourceHealthColor(health);
  const glyph = health === "untested" ? "◌" : sourceGlyph(health);
  const label = health === "untested" ? (enabled ? "untested" : "disabled") : sourceHealthLabel(health);
  const results = status.results !== null ? `${status.results} result${status.results === 1 ? "" : "s"}` : null;
  const failure = status.failure ? failureShort(status.failure) : null;

  return (
    <Box height={1} width="100%" backgroundColor={selected ? palette.surfaceAlt : undefined} paddingLeft={1}>
      <Box width={2}>
        <Text color={color} bold={selected}>{selected ? "›" : glyph}</Text>
      </Box>
      <Box flexGrow={1} paddingRight={1}>
        <Text wrap="truncate" color={enabled ? palette.subtext : palette.dim} bold={selected || !enabled}>
          {adapter.name}
        </Text>
      </Box>
      {!enabled ? (
        <Box paddingRight={2}>
          <Text color={palette.dim}>disabled</Text>
        </Box>
      ) : null}
      <Box width={22}>
        <Text color={selected ? palette.text : color} wrap="truncate">
          {results ? `${label} | ${results}` : failure ? `${label} | ${failure}` : label}
        </Text>
      </Box>
    </Box>
  );
}

function SourceProfile({ status }: { status: SourceStatus }): React.ReactNode {
  const { adapter } = status;
  return (
    <Box flexDirection="column" paddingX={2} paddingBottom={1}>
      <Box width="100%">
        <Text color={palette.faint} wrap="truncate">
          {adapter.id} | {adapter.groups.join(" / ")} | {adapter.categories.join(" / ")} | timeout {adapter.timeoutMs}ms
          {"  "}|  {adapter.homepage}
          {adapter.reportsHealth ? " | reports swarm health" : ""}
        </Text>
      </Box>
    </Box>
  );
}

function failureShort(message: string): string {
  if (!message) return "error";
  const clean = message.replace(/\s+/g, " ").trim();
  return clean.length > 28 ? `${clean.slice(0, 27)}...` : clean;
}