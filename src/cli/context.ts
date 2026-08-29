/**
 * Command context: output plumbing that keeps JSON mode JSON-only on stdout.
 */
import type { Application } from "../app/application.js";
import type { CliArgs } from "./args.js";

export class CliContext {
  readonly app: Application;
  readonly args: CliArgs;

  constructor(app: Application, args: CliArgs) {
    this.app = app;
    this.args = args;
  }

  get json(): boolean {
    return this.args.json;
  }

  /** Always to stdout - reserved for machine-readable output. */
  stdout(text: string): void {
    process.stdout.write(text + "\n");
  }

  /** Human output: stdout normally, stderr in JSON mode. */
  log(text: string): void {
    if (this.args.json) process.stderr.write(text + "\n");
    else process.stdout.write(text + "\n");
  }

  /** Errors always go to stderr. */
  err(text: string): void {
    process.stderr.write(text + "\n");
  }

  /** Print a JSON value to stdout (the only stdout content in JSON mode). */
  jsonOut(value: unknown): void {
    process.stdout.write(JSON.stringify(value) + "\n");
  }
}