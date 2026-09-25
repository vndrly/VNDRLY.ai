import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { rehearseWorkHubMigrations } from "../work-hub-migration-rehearsal.mjs";

function harness({ alreadyCurrent = false, brokenGate = false, changedRows = false } = {}) {
  const fields = new Set(["gate_stations.id", "asset_custody_events.id"]);
  if (alreadyCurrent) fields.add("asset_custody_events.command_fingerprint");
  const calls = [];
  let gateApplied = false;
  return {
    calls,
    inspect: async () => ({ fields: [...fields], gateIndex: gateApplied, originalRows: changedRows && gateApplied ? "changed" : "same-original-values" }),
    migrate: async command => {
      calls.push(command);
      if (command === "migrate:asset-custody-fingerprint") fields.add("asset_custody_events.command_fingerprint");
      else if (!brokenGate) { for (const name of ["latitude", "longitude", "geofence_radius_m", "active", "version"]) fields.add(`gate_stations.${name}`); gateApplied = true; }
    },
  };
}
test("requests both guarded migrations against a previous schema, checks the upgrade, and replays both", async () => {
  const h = harness();
  await rehearseWorkHubMigrations(h);
  assert.deepEqual(h.calls, ["migrate:asset-custody-fingerprint", "migrate:gate-locations", "migrate:asset-custody-fingerprint", "migrate:gate-locations"]);
});
test("rejects current-schema replay masquerading as first-application evidence before migrating", async () => {
  const h = harness({ alreadyCurrent: true });
  await assert.rejects(rehearseWorkHubMigrations(h), /previous schema/);
  assert.deepEqual(h.calls, []);
});
test("does not accept a missing gate upgrade or changed existing values", async () => {
  await assert.rejects(rehearseWorkHubMigrations(harness({ brokenGate: true })), /missing|index/i);
  await assert.rejects(rehearseWorkHubMigrations(harness({ changedRows: true })), /original rows/);
});
test("the runner provisions only fresh loopback data from the pinned full previous schema", async () => {
  const runner = await readFile(new URL("../../artifacts/api-server/scripts/rehearse-work-hub-migrations.ts", import.meta.url), "utf8");
  assert.match(runner, /const previousRef = "e20a568d23e1a0b8919acd7106e62afc892d3b5d"/);
  assert.match(runner, /assert\.equal\(process\.env\.VNDRLY_LOAD_ENV_LOCAL, "0"/);
  assert.match(runner, /resolveFreshLocalTestDatabaseTarget\(process\.env\)/);
  assert.match(runner, /freshLocalChildEnvironment\(process\.env, target\)/);
  assert.match(runner, /provisionFreshLocalTestDatabase\(target/);
  assert.match(runner, /"ls-tree", "-r", "--name-only", previousRef, prefix/);
  assert.match(runner, /"show", `\$\{previousRef\}:\$\{path\}`/);
  assert.match(runner, /const schema = await previousSchema\(\)/);
  assert.match(runner, /pushSchema\(schema, drizzle\(client, \{ schema \}\)/);
  assert.match(runner, /"--filter", "@workspace\/api-server", "run", command/);
  assert.match(runner, /env: childEnvironment/);
  assert.doesNotMatch(runner, /@workspace\/db|dotenv|DROP\s|TRUNCATE\s|DELETE\s+FROM|\.env\.local|\.env\.production/);
});
