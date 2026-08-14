/**
 * `tornedo sources` — list sources and their enabled state.
 */
import { SOURCES } from "../../sources/registry.js";
import type { CliContext } from "../context.js";

export async function runSources(ctx: CliContext): Promise<number> {
  const rows = SOURCES.map((s) => ({
    id: s.id,
    name: s.name,
    groups: s.groups,
    categories: s.categories,
    reportsHealth: s.reportsHealth,
    enabled: ctx.app.isSourceEnabled(s.id),
  }));
  if (ctx.args.json) {
    ctx.jsonOut(rows);
    return rows.length;
  }
  ctx.log("ID                 ENABLED  GROUPS          HEALTH");
  for (const r of rows) {
    ctx.log(
      `${r.id.padEnd(18)} ${r.enabled ? "on " : "off"}  ${r.groups.join("/").padEnd(15)} ${r.reportsHealth ? "yes" : "no "}`,
    );
  }
  ctx.log("");
  ctx.log('Enable/disable: tornedo config set sources.<id> true|false');
  return rows.length;
}