import os from "node:os";
import path from "node:path";
import { defineConfig } from "vitest/config";

// Keep tests off the real user data dir: redirect all persisted state into a
// temp folder via the TORNEDO_STATE_DIR override honored by src/config/paths.ts.
export default defineConfig({
  test: {
    env: {
      TORNEDO_STATE_DIR: path.join(os.tmpdir(), "tornedo-test-state"),
    },
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "src/**/*.test.ts"],
    coverage: {
      reporter: ["text", "json-summary"],
    },
  },
  benchmark: {
    include: ["bench/**/*.bench.ts"],
  },
});