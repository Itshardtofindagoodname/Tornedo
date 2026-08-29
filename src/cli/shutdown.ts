/**
 * Process-level shutdown hooks. Registered by long-running commands (watch, tui)
 * and flushed during graceful shutdown before the process exits.
 */
const hooks: Array<() => void | Promise<void>> = [];

export function registerShutdownHook(hook: () => void | Promise<void>): void {
  hooks.push(hook);
}

export async function runShutdownHooks(): Promise<void> {
  while (hooks.length > 0) {
    const hook = hooks.shift()!;
    try {
      await hook();
    } catch (e) {
      process.stderr.write(`shutdown hook failed: ${e instanceof Error ? e.message : String(e)}\n`);
    }
  }
}