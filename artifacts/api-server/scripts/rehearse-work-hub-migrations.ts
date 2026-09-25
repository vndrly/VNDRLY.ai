import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { drizzle } from "drizzle-orm/node-postgres";
import type { PgDatabase } from "drizzle-orm/pg-core";
import { pushSchema } from "drizzle-kit/api";
import pg from "pg";
import { freshLocalChildEnvironment, provisionFreshLocalTestDatabase, resolveFreshLocalTestDatabaseTarget } from "../../../scripts/fresh-test-database.mjs";
import { rehearseWorkHubMigrations } from "../../../scripts/work-hub-migration-rehearsal.mjs";

// Exact parent of the Work Hub/Gate release. Import its full schema, never a
// current schema with columns removed, so this rehearses the actual upgrade.
const previousRef = "e20a568d23e1a0b8919acd7106e62afc892d3b5d";
const root = fileURLToPath(new URL("../../../", import.meta.url));
assert.equal(process.env.VNDRLY_LOAD_ENV_LOCAL, "0", "Rehearsal must not load a shared environment");
const target = resolveFreshLocalTestDatabaseTarget(process.env);
const childEnvironment = freshLocalChildEnvironment(process.env, target);

async function previousSchema() {
  const prefix = "lib/db/src/schema/";
  const files = execFileSync("git", ["ls-tree", "-r", "--name-only", previousRef, prefix], { cwd: root, encoding: "utf8" }).trim().split(/\r?\n/);
  assert.ok(files.includes(`${prefix}index.ts`), "Pinned previous schema was not fetched");
  // A new ignored directory beneath the DB package retains its normal module
  // resolution. It and the scratch database remain available for diagnosis.
  const directory = await mkdtemp(join(root, "lib/db/.work-hub-previous-"));
  for (const path of files) {
    assert.ok(path.startsWith(prefix) && !path.includes(".."), "Unexpected previous schema path");
    const destination = join(directory, path.slice(prefix.length));
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, execFileSync("git", ["show", `${previousRef}:${path}`], { cwd: root }));
  }
  return import(pathToFileURL(join(directory, "index.ts")).href);
}

console.log(`First-application rehearsal from ${previousRef}; new loopback database ${target.testDbName}`);
await provisionFreshLocalTestDatabase(target, (url: string) => new pg.Client({ connectionString: url }), async (client: pg.Client) => {
  const schema = await previousSchema();
  return pushSchema(schema, drizzle(client, { schema }) as unknown as PgDatabase<never>);
});
const client = new pg.Client({ connectionString: target.testUrl });
await client.connect();
try {
  // Sentinel records exist before migration, including the independent wellhead
  // location and historical custody. Every existing field must survive replay.
  const partner = await client.query("INSERT INTO partners(name, contact_name, contact_email) VALUES ('Rehearsal', 'Fixture', 'fixture@example.invalid') RETURNING id");
  const site = await client.query("INSERT INTO site_locations(partner_id, name, address, latitude, longitude, site_code) VALUES ($1, 'Wellhead', 'Fixture', 35, -97, 'REHEARSAL') RETURNING id", [partner.rows[0].id]);
  await client.query("INSERT INTO gate_stations(site_id, name) VALUES ($1, 'Original gate')", [site.rows[0].id]);
  const asset = await client.query("INSERT INTO assets(name, category, legal_owner_name, responsible_org_type, responsible_org_id) VALUES ('Radio', 'Equipment', 'Fixture', 'partner', $1) RETURNING id", [partner.rows[0].id]);
  await client.query("INSERT INTO asset_custody_events(asset_id, event_type, operation_id, asset_version, note) VALUES ($1, 'condition', $2, 1, 'Keep original history')", [asset.rows[0].id, randomUUID()]);
  await rehearseWorkHubMigrations({
    inspect: async () => {
      const fields = await client.query("SELECT table_name || '.' || column_name AS name FROM information_schema.columns WHERE table_schema = 'public' AND table_name IN ('gate_stations', 'asset_custody_events') ORDER BY table_name, ordinal_position");
      const index = await client.query("SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'gate_stations_site_active_idx'");
      const gates = await client.query("SELECT jsonb_agg(to_jsonb(g) - ARRAY['latitude','longitude','geofence_radius_m','active','version'] ORDER BY id) AS records FROM gate_stations g");
      const custody = await client.query("SELECT jsonb_agg(to_jsonb(c) - 'command_fingerprint' ORDER BY id) AS records FROM asset_custody_events c");
      const sites = await client.query("SELECT jsonb_agg(to_jsonb(s) ORDER BY id) AS records FROM site_locations s");
      return { fields: fields.rows.map(row => row.name), gateIndex: index.rowCount === 1, originalRows: JSON.stringify([gates.rows, custody.rows, sites.rows]) };
    },
    migrate: async (command: string) => {
      console.log(`Applying ${command} to owned scratch database`);
      await new Promise<void>((resolve, reject) => {
        const process = spawn("corepack", ["pnpm", "--filter", "@workspace/api-server", "run", command], { cwd: root, env: childEnvironment, stdio: "inherit" });
        process.once("error", reject);
        process.once("exit", code => code === 0 ? resolve() : reject(new Error(`${command} exited ${code}`)));
      });
    },
  });
  const gate = (await client.query("SELECT latitude, longitude, geofence_radius_m, active, version FROM gate_stations")).rows[0];
  assert.deepEqual(gate, { latitude: null, longitude: null, geofence_radius_m: 500, active: true, version: 1 });
  assert.equal((await client.query("SELECT command_fingerprint FROM asset_custody_events")).rows[0].command_fingerprint, null);
  console.log("PASS: first application, replay, defaults, original gate/site values and custody history preserved");
} finally {
  await client.end();
}
