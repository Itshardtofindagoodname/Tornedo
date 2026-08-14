/**
 * Terminal UI entry point: mounts the Ink application and keeps running until
 * the user quits. The whole TUI is component-driven (React + Ink); this module
 * only owns the render lifecycle and terminal restoration.
 */
import { render } from "ink";
import type { CliContext } from "../cli/context.js";
import { registerShutdownHook } from "../cli/shutdown.js";
import { TornedoApp } from "./App.js";

export async function runTui(ctx: CliContext): Promise<number> {
  const { unmount, waitUntilExit } = render(<TornedoApp app={ctx.app} />, {
    exitOnCtrlC: true,
    alternateScreen: true,
    incrementalRendering: true,
  });

  // If the process is signalled externally (SIGTERM/SIGINT), restore the
  // terminal before the shutdown path suspends the app and exits.
  registerShutdownHook(async () => {
    unmount();
    await waitUntilExit();
  });

  await waitUntilExit();
  return 0;
}