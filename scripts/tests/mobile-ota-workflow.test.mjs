import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflowUrl = new URL(
  "../../.github/workflows/mobile-ota.yml",
  import.meta.url,
);

const workflow = await readFile(workflowUrl, "utf8");
const easWorkflow = await readFile(
  new URL(
    "../../artifacts/vndrly-mobile/.eas/workflows/mobile-production-ota.yml",
    import.meta.url,
  ),
  "utf8",
);

test("mobile OTA is a manual, guarded iOS production release", () => {
  assert.match(workflow, /^\s*workflow_dispatch:\s*$/m);
  assert.doesNotMatch(workflow, /^\s*push:\s*$/m);
  assert.match(workflow, /secrets\.EXPO_TOKEN/);
  assert.match(workflow, /eas build:list/);
  assert.match(workflow, /node scripts\/eas-production-runtime-commit\.mjs/);
  assert.match(workflow, /node scripts\/mobile-release-impact\.mjs/);
  assert.match(workflow, /--base-ref/);
  assert.match(
    workflow,
    /pnpm --filter @workspace\/vndrly-mobile run typecheck/,
  );
  assert.match(
    workflow,
    /pnpm --filter @workspace\/vndrly-mobile exec vitest run --maxWorkers=2 --retry=1/,
  );
  assert.match(
    workflow,
    /eas update[\s\S]*--channel production[\s\S]*--environment production[\s\S]*--platform ios/,
  );
  assert.match(workflow, /--non-interactive/);
});

test("mobile OTA cannot bypass validation or mutate production data", () => {
  assert.doesNotMatch(workflow, /AllowNativeChanges|--skip-tests/i);
  assert.doesNotMatch(workflow, /DATABASE_URL|\.env\.production/);
  assert.doesNotMatch(workflow, /\b(?:DROP|TRUNCATE|DELETE)\b/i);
  assert.doesNotMatch(workflow, /eas (?:build(?!:)|submit)\b/);
});

test("native-impact releases finish as an intentional OTA skip", () => {
  assert.match(workflow, /id:\s*release-impact/);
  assert.match(workflow, /--github-output/);
  assert.match(
    workflow,
    /if:\s*steps\.release-impact\.outputs\.requires_native_build == 'false'/,
  );
  assert.match(
    workflow,
    /if:\s*steps\.release-impact\.outputs\.requires_native_build == 'true'/,
  );
  assert.match(workflow, /TestFlight-required release detected/);
});

test("EAS publishes iOS OTA only when the installed native fingerprint matches", () => {
  assert.match(easWorkflow, /^\s*push:\s*$/m);
  assert.match(easWorkflow, /^\s*- main\s*$/m);
  assert.match(easWorkflow, /type:\s*fingerprint/);
  assert.match(easWorkflow, /type:\s*get-build/);
  assert.match(easWorkflow, /fingerprint_hash:/);
  assert.match(easWorkflow, /if:[^\n]*build_id/);
  assert.match(easWorkflow, /type:\s*update/);
  assert.match(easWorkflow, /channel:\s*production/);
  assert.match(easWorkflow, /platform:\s*ios/);
  assert.match(easWorkflow, /before_update:/);
  assert.match(easWorkflow, /pnpm run typecheck/);
  assert.doesNotMatch(easWorkflow, /pnpm run typecheck\s+--\s+--/);
  assert.match(easWorkflow, /pnpm exec vitest run --maxWorkers=2/);
  assert.equal(
    [...easWorkflow.matchAll(/corepack prepare pnpm@9\.15\.9 --activate/g)]
      .length,
    2,
  );
  assert.doesNotMatch(easWorkflow, /type:\s*(?:build|submit)\b/);
});

test("EAS builds shared TypeScript declarations before validating mobile", () => {
  const buildLibraries = easWorkflow.indexOf(
    "pnpm --dir ../.. run typecheck:libs",
  );
  const typecheckMobile = easWorkflow.indexOf("pnpm run typecheck");

  assert.notEqual(buildLibraries, -1);
  assert.notEqual(typecheckMobile, -1);
  assert.ok(buildLibraries < typecheckMobile);
});

test("EAS validates and publishes with the production Node runtime", () => {
  assert.match(
    easWorkflow,
    /defaults:\s*\n\s+tools:\s*\n\s+node:\s*22\.14\.0/,
  );
});

test("mobile OTA records the 2026-08-28 full-ship release-path verification", () => {
  assert.match(
    workflow,
    /Full-ship release-path verification: 2026-08-28T15:50Z/,
  );
});
