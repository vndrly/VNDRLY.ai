import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workflow = await readFile(
  new URL("../../.github/workflows/verify-release.yml", import.meta.url),
  "utf8",
);

const stepStarts = [...workflow.matchAll(/^      - /gm)].map(({ index }) => index);
const steps = stepStarts.map((start, index) =>
  workflow.slice(start, stepStarts[index + 1] ?? workflow.length),
);

function namedStep(name) {
  const matches = steps.filter((step) =>
    step.match(/^      - name: ([^\r\n]+)/)?.[1] === name,
  );
  assert.equal(matches.length, 1, `expected exactly one step named ${name}`);
  return matches[0];
}

function stepContaining(fragment) {
  const matches = steps.filter((step) => step.includes(fragment));
  assert.equal(matches.length, 1, `expected exactly one step containing ${fragment}`);
  return matches[0];
}

function compact(value) {
  return value.replace(/\s+/g, " ").trim();
}

function assertCondition(step, condition) {
  assert.match(step, /^        if:/m);
  assert.ok(
    compact(step).includes(compact(condition)),
    `step did not contain condition: ${condition}`,
  );
}

test("release gates have unique stable step identities", () => {
  const expected = {
    dependencies: "pnpm install --frozen-lockfile",
    browser: "Install the pinned test browser",
    postgres: "Start a new runner-local PostgreSQL cluster",
    "db-safety": "Verify fresh test database safety invariants",
    static: "Typecheck and locale parity",
    api: "Independent database-backed API gate",
    "full-chain": "Full required test chain",
  };

  for (const [id, marker] of Object.entries(expected)) {
    const step = marker.startsWith("pnpm ")
      ? stepContaining(marker)
      : namedStep(marker);
    assert.match(step, new RegExp(`^      - id: ${id}$|^        id: ${id}$`, "m"));
    assert.equal(
      [
        ...workflow.matchAll(
          new RegExp(`^      - id: ${id}$|^        id: ${id}$`, "gm"),
        ),
      ].length,
      1,
      `expected id ${id} exactly once`,
    );
  }
});

test("browser, PostgreSQL, safety, and static gates depend only on installation", () => {
  const dependenciesOnly =
    "${{ !cancelled() && steps.dependencies.outcome == 'success' }}";

  for (const name of [
    "Install the pinned test browser",
    "Start a new runner-local PostgreSQL cluster",
    "Verify fresh test database safety invariants",
    "Typecheck and locale parity",
  ]) {
    const step = namedStep(name);
    assertCondition(step, dependenciesOnly);
    assert.doesNotMatch(step, /steps\.(?:browser|postgres|db-safety|static|api|full-chain)\.outcome/);
  }
});

test("database safety is a pure preceding Node gate and static retains only type and locale checks", () => {
  const safety = namedStep("Verify fresh test database safety invariants");
  const staticChecks = namedStep("Typecheck and locale parity");

  assert.match(
    safety,
    /^          node --test scripts\/tests\/fresh-test-database\.test\.mjs scripts\/tests\/verify-release-workflow\.test\.mjs$/m,
  );
  assert.doesNotMatch(safety, /pnpm run test:api|pnpm test|DATABASE_URL|psql|createdb/);
  assert.ok(workflow.indexOf(safety) < workflow.indexOf(staticChecks));

  assert.match(staticChecks, /^          pnpm run typecheck$/m);
  assert.match(staticChecks, /^          pnpm lint:i18n$/m);
  assert.doesNotMatch(staticChecks, /fresh-test-database|node --test/);
});

test("API starts after database prerequisites regardless of browser or static outcomes", () => {
  const api = namedStep("Independent database-backed API gate");
  assertCondition(
    api,
    "${{ !cancelled() && steps.dependencies.outcome == 'success' && steps.postgres.outcome == 'success' && steps.db-safety.outcome == 'success' }}",
  );
  assert.doesNotMatch(api, /steps\.(?:browser|static|api|full-chain)\.outcome/);
  assert.match(
    api,
    /^          pnpm run test:api 2>&1 \| tee "\$RUNNER_TEMP\/vndrly-api-tests\.log"$/m,
  );
});

test("full chain starts after browser and database prerequisites regardless of static or API outcomes", () => {
  const fullChain = namedStep("Full required test chain");
  assertCondition(
    fullChain,
    "${{ !cancelled() && steps.dependencies.outcome == 'success' && steps.browser.outcome == 'success' && steps.postgres.outcome == 'success' && steps.db-safety.outcome == 'success' }}",
  );
  assert.doesNotMatch(fullChain, /steps\.(?:static|api|full-chain)\.outcome/);
  assert.match(
    fullChain,
    /^          pnpm test 2>&1 \| tee "\$RUNNER_TEMP\/vndrly-tests\.log"$/m,
  );
});

test("browser diagnosis is cancellation-safe and responds only to a failed full chain", () => {
  const diagnostic = namedStep(
    "Diagnose browser gate after an earlier chain failure",
  );
  assertCondition(
    diagnostic,
    "${{ !cancelled() && steps.full-chain.outcome == 'failure' }}",
  );
  assert.match(
    diagnostic,
    /^          pnpm run test:e2e 2>&1 \| tee "\$RUNNER_TEMP\/vndrly-browser-tests\.log"$/m,
  );
});

test("failures remain fatal while evidence and owned-cluster cleanup always run", () => {
  assert.doesNotMatch(workflow, /continue-on-error|\|\|\s*true/);

  const evidence = namedStep("Retain verification evidence");
  assert.match(evidence, /^        if: always\(\)$/m);

  const cleanup = namedStep("Stop the runner-local PostgreSQL cluster");
  assert.match(
    cleanup,
    /^        if: always\(\) && env\.VNDRLY_CI_PG_DATA != ''$/m,
  );
  assert.match(
    cleanup,
    /"\$VNDRLY_CI_PG_BIN\/pg_ctl" --pgdata="\$VNDRLY_CI_PG_DATA" --mode=fast --wait stop/,
  );
});

test("the fresh loopback cluster and secret-isolation boundary remain unchanged", () => {
  assert.match(workflow, /VNDRLY_TEST_DB_MODE: fresh-local/);
  assert.match(
    workflow,
    /VNDRLY_TEST_DB_MAINTENANCE_URL: postgresql:\/\/postgres@127\.0\.0\.1:55439\/postgres/,
  );
  assert.match(workflow, /VNDRLY_LOAD_ENV_LOCAL: '0'/);
  assert.match(workflow, /pg_data="\$RUNNER_TEMP\/vndrly-verification-postgres"/);
  assert.match(workflow, /test ! -e "\$pg_data"/);
  assert.match(
    workflow,
    /"\$pg_bin\/initdb" --pgdata="\$pg_data" --username=postgres --auth=trust/,
  );
  assert.match(
    workflow,
    /--options="-h 127\.0\.0\.1 -p 55439 -k '\$RUNNER_TEMP'" --wait start/,
  );
  assert.doesNotMatch(
    workflow,
    /secrets\.|DATABASE_URL|TEST_DATABASE_URL|SUPABASE|POSTGRES_(?:HOST|URL|PASSWORD)/i,
  );
});
