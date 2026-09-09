import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`CREATE TABLE IF NOT EXISTS work_hub_finance_records (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(), org_type text NOT NULL,
    org_id integer NOT NULL, kind text NOT NULL, record_key text NOT NULL,
    data jsonb NOT NULL, created_by integer NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
  )`);
  await db.execute(
    sql`CREATE UNIQUE INDEX IF NOT EXISTS work_hub_finance_record_unique ON work_hub_finance_records (org_type, org_id, kind, record_key)`,
  );
  await db.execute(
    sql`CREATE INDEX IF NOT EXISTS work_hub_finance_owner_kind_idx ON work_hub_finance_records (org_type, org_id, kind)`,
  );
  console.log("Work Hub finance additive migration complete");
}
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
