/** Authorized one-time score transition. No incident, readiness, credential or company deletion. */
import "./load-env-local.mjs";
import { createRequire } from "node:module";
import { existingCompanyGoQuery, isCompanyGoFixture } from "./go-ecosphere/existing-company-identity.mjs";
import { MATURITY_CATEGORIES, projectSafetyMaturity, SafetyMaturityRecordSchema } from "../lib/api-zod/src/safety-maturity";
const { Client } = createRequire(new URL("../lib/db/package.json", import.meta.url))("pg");
const target = new URL(process.env.DATABASE_URL ?? "");
if (!target.hostname.endsWith(".pooler.supabase.com") || target.username !== "postgres.bihjmgbdzbhcnsuhzzwo" || target.pathname !== "/postgres") throw Error("Unexpected transition database");
const client = new Client({ connectionString: target.toString() });
const apply = process.argv.includes("--apply");
const marker = "Synthetic VNDRLY test company (go-ecosphere-v1). No real work, person, credential, vehicle, or payment is represented.";
const levels: Record<string, number[]> = { GasGo: [3,3,4,3,2,3], FieldGo: [3,3,2,3,2,2], FleetGo: [4,3,4,4,3,3], GateGo: [2,2,3,2,1,2] };
const examples = ["Assigned safety owner and worker consultation records", "Task hazard assessment and control verification", "Role competency matrix and assessment records", "Inspection and maintenance program records", "Investigation and corrective-action effectiveness records", "Emergency exercise and improvement records"];
await client.connect();
try {
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '1500ms'");
  await client.query("SET LOCAL statement_timeout = '20s'");
  const { rows: candidates } = await client.query(existingCompanyGoQuery, [["gasgo", "fieldgo", "fleetgo", "gatego"]]);
  if (candidates.length !== 4 || candidates.some((row: any) => !isCompanyGoFixture(row, marker))) throw Error("CompanyGo identity verification failed");
  const { rows: midcon } = await client.query("SELECT id,name FROM vendors WHERE lower(btrim(name))=$1", ["midcon solutions"]);
  if (midcon.length !== 1 || midcon[0].id !== 1054) throw Error("MidCon identity verification failed");
  await client.query(`CREATE TABLE IF NOT EXISTS safety_maturity_assessments (org_type text NOT NULL, org_id integer NOT NULL, assessment jsonb NOT NULL, PRIMARY KEY(org_type, org_id))`);
  await client.query("ALTER TABLE safety_maturity_assessments ENABLE ROW LEVEL SECURITY");
  const report = [];
  for (const company of candidates) {
    const record = SafetyMaturityRecordSchema.parse({ version: 1, demo: true, assessedAt: new Date().toISOString(), categories: MATURITY_CATEGORIES.map((category, index) => ({ id: category.id, level: levels[company.name][index], evidence: `DEMO ONLY: ${examples[index]}. Synthetic illustration; no actual verification or credential.` })) });
    // Idempotent: never overwrite later assessments on a repeated run.
    const result = await client.query(`INSERT INTO safety_maturity_assessments(org_type,org_id,assessment) VALUES($1,$2,$3::jsonb) ON CONFLICT DO NOTHING RETURNING org_id`, [company.kind, company.id, JSON.stringify(record)]);
    report.push({ company: company.name, seeded: result.rowCount, exampleScore: projectSafetyMaturity(record).score });
  }
  // Drop only obsolete score caches/history, retaining the underlying operational evidence.
  const cleared = await client.query(`UPDATE vendors SET fleet_compliance_configuration=fleet_compliance_configuration - 'scoreHistory' - 'partnerScorePreview' WHERE fleet_compliance_configuration ? 'scoreHistory' OR fleet_compliance_configuration ? 'partnerScorePreview'`);
  const current = await client.query("SELECT assessment FROM safety_maturity_assessments WHERE org_type=$1 AND org_id=$2", ["vendor",1054]);
  if (projectSafetyMaturity(current.rows[0]?.assessment).score !== 0) throw Error("MidCon unexpectedly has maturity credit");
  console.log(JSON.stringify({ mode: apply ? "apply" : "dry-run", companies: report, oldScoreCachesRemoved: cleared.rowCount, midcon: { id: 1054, score: 0, incomplete: true } }));
  await client.query(apply ? "COMMIT" : "ROLLBACK");
} catch (error) { await client.query("ROLLBACK"); throw error; }
finally { await client.end(); }
