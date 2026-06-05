import { defineConfig } from "vitest/config";

// Vitest config for the opt-in model-output evals. Kept separate from
// the default `vitest.config.ts` so:
//   - `pnpm --filter @workspace/api-server run test` stays hermetic
//     (no network, no API key) and runs on every CI build,
//   - `pnpm --filter @workspace/api-server run eval` picks up only
//     `**/*.eval.ts` files and is gated on ANTHROPIC_API_KEY at the
//     suite level (see src/assistant/__evals__/language.eval.ts).
//
// Tests still get the same setup file so DATABASE_URL / SESSION_SECRET
// are populated, even though the language eval doesn't touch the DB.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.eval.ts"],
    setupFiles: ["src/test/setup.ts"],
    // Each eval call to Claude can take a few seconds; the per-test
    // timeout is set in the eval file itself (CALL_TIMEOUT_MS) but
    // we also raise the suite hook timeout so beforeAll has room.
    hookTimeout: 60_000,
    // Run the prompts serially so a developer running the eval
    // locally doesn't trip rate limits. The suite is small enough
    // that the wall-clock cost is still under a minute.
    fileParallelism: false,
    pool: "forks",
    forks: { singleFork: true },
  },
});
