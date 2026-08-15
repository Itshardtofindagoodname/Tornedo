/**
 * `tornedo doctor` — self-diagnostics for the local installation.
 */
import type { CliContext } from "../context.js";
import { renderDoctor, runDoctor } from "../../diagnostics/doctor.js";

export async function runDoctorCommand(ctx: CliContext): Promise<number> {
  const report = await runDoctor(ctx.app, { probeSources: ctx.args.check });
  if (ctx.args.json) {
    ctx.jsonOut(report);
    return report.healthy ? 0 : 1;
  }
  ctx.log("TORNEDO DOCTOR");
  ctx.log("");
  ctx.log(renderDoctor(report));
  return report.healthy ? 0 : 1;
}