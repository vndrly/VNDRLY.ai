import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// Additive only: existing tickets, assignments, AFEs and evidence are untouched.
async function main() {
  await db.transaction(async tx => {
    await tx.execute(sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS engagement_job_offer_id integer CONSTRAINT tickets_engagement_job_offer_id_job_offers_id_fk REFERENCES job_offers(id)`);
    await tx.execute(sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS engagement_ticket_key text`);
    await tx.execute(sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS submission_revision integer NOT NULL DEFAULT 0`);
    await tx.execute(sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS proof_submissions jsonb`);
    await tx.execute(sql`ALTER TABLE tickets ADD COLUMN IF NOT EXISTS approved_submission_revision integer`);
    await tx.execute(sql`CREATE UNIQUE INDEX IF NOT EXISTS tickets_engagement_key_unique ON tickets(engagement_job_offer_id,engagement_ticket_key)`);
    const columns = (await tx.execute(sql`SELECT column_name,data_type,is_nullable,column_default
      FROM information_schema.columns WHERE table_schema='public' AND table_name='tickets'
      AND column_name IN ('engagement_job_offer_id','engagement_ticket_key','submission_revision','proof_submissions','approved_submission_revision')`)).rows;
    const expected: Record<string, string> = { engagement_job_offer_id: "integer", engagement_ticket_key: "text",
      submission_revision: "integer", proof_submissions: "jsonb", approved_submission_revision: "integer" };
    for (const [name, type] of Object.entries(expected)) {
      const column = columns.find(row => row.column_name === name);
      if (!column || column.data_type !== type || (name === "submission_revision" &&
        (column.is_nullable !== "NO" || !/^0(?:::integer)?$/.test(String(column.column_default)))))
        throw new Error(`Job handshake column mismatch: ${name}; existing data was not changed`);
    }
    const index = (await tx.execute(sql`SELECT i.indisunique,i.indisvalid,
      ARRAY(SELECT pg_get_indexdef(i.indexrelid,n,true) FROM generate_series(1,i.indnkeyatts) n) AS columns,
      pg_get_expr(i.indpred,i.indrelid) AS predicate FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid
      WHERE i.indrelid='public.tickets'::regclass AND c.relname='tickets_engagement_key_unique'`)).rows[0];
    if (!index?.indisunique || !index.indisvalid || index.predicate != null ||
      JSON.stringify(index.columns) !== JSON.stringify(["engagement_job_offer_id", "engagement_ticket_key"]))
      throw new Error("Job handshake idempotency index mismatch; existing data was not changed");
    const reference = (await tx.execute(sql`SELECT c.oid FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid=c.conrelid AND a.attnum=c.conkey[1]
      JOIN pg_attribute b ON b.attrelid=c.confrelid AND b.attnum=c.confkey[1]
      WHERE c.contype='f' AND c.conrelid='public.tickets'::regclass AND c.confrelid='public.job_offers'::regclass
        AND cardinality(c.conkey)=1 AND a.attname='engagement_job_offer_id' AND b.attname='id'`)).rows[0];
    if (!reference) throw new Error("Job handshake reference mismatch; existing data was not changed");
  });
  console.log("Additive job handshake migration complete; existing records preserved.");
}
main().then(() => process.exit(0)).catch(error => { console.error(error); process.exit(1); });
