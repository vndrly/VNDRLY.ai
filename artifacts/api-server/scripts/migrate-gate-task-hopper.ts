import pg from "pg";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const gateTaskHopperStatements = ["ALTER TABLE work_hub_tasks ADD COLUMN IF NOT EXISTS gate_hopper jsonb"] as const;
/** Existing action IDs become task IDs; ambiguous vendor attribution remains in
 * the original action history and is reported instead of guessing an employer. */
export async function migrateGateTaskHopper(c: Pick<pg.Client, "query">) {
  // Caller owns the transaction. Freeze gate creation and serialize existing
  // stations against the old API's action/handoff locks before reading history.
  await c.query("LOCK TABLE gate_stations IN SHARE MODE");
  await c.query("SELECT id FROM gate_stations ORDER BY id FOR UPDATE");
  const existing = await c.query("SELECT data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='work_hub_tasks' AND column_name='gate_hopper'");
  if (existing.rows.length && existing.rows[0].data_type !== "jsonb") throw new Error("Existing gate_hopper column must be jsonb; no data was changed");
  // Avoid an unnecessary AccessExclusive task-table lock during repeat runs.
  if (!existing.rows.length) for (const statement of gateTaskHopperStatements) await c.query(statement);
  const result = await c.query(`WITH latest AS (
    SELECT DISTINCT ON(item_id) item_id,station_id,kind FROM gate_shift_actions WHERE kind IN ('open','resolve','reopen') ORDER BY item_id,created_at DESC,id DESC
  ), origins AS (
    SELECT DISTINCT ON(a.item_id) a.* FROM gate_shift_actions a JOIN latest l ON l.item_id=a.item_id AND l.kind<>'resolve'
    WHERE a.kind='open' ORDER BY a.item_id,a.created_at,a.id
  ), candidates AS (
    SELECT DISTINCT o.item_id,m.vendor_id FROM origins o JOIN gate_stations g ON g.id=o.station_id
    JOIN user_org_memberships m ON m.user_id=o.actor_id AND m.org_type='vendor'
    JOIN site_work_assignments a ON a.site_location_id=g.site_id AND a.vendor_id=m.vendor_id AND a.is_gate_contractor=true
  ), owners AS (SELECT item_id,min(vendor_id) AS vendor_id FROM candidates GROUP BY item_id HAVING count(*)=1), inserted AS (
    INSERT INTO work_hub_tasks(id,owner_org_type,owner_org_id,title,description,created_by_id,created_at,updated_at,gate_hopper)
    SELECT o.item_id,'vendor',v.vendor_id,left(o.text,200),o.text,o.actor_id,o.created_at,o.created_at,
      jsonb_build_object('stationId',g.id,'siteId',g.site_id,'legacy',true)
    FROM origins o JOIN owners v ON v.item_id=o.item_id JOIN gate_stations g ON g.id=o.station_id ON CONFLICT(id) DO NOTHING RETURNING id,created_by_id
  ) INSERT INTO work_hub_task_events(task_id,actor_user_id,event_type,detail) SELECT id,created_by_id,'hopper.imported',jsonb_build_object('source','gate_shift_actions') FROM inserted RETURNING task_id`);
  const unresolved = await c.query(`SELECT count(DISTINCT a.item_id)::int AS count FROM gate_shift_actions a
    WHERE a.kind IN ('open','reopen') AND NOT EXISTS(SELECT 1 FROM work_hub_tasks t WHERE t.id=a.item_id)
    AND a.id=(SELECT id FROM gate_shift_actions b WHERE b.item_id=a.item_id AND b.kind IN ('open','resolve','reopen') ORDER BY b.created_at DESC,b.id DESC LIMIT 1)`);
  return { imported: result.rowCount ?? 0, unresolved: unresolved.rows[0]?.count ?? 0 };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is required");
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  try {
    await c.connect(); await c.query("BEGIN"); await c.query("SET LOCAL lock_timeout='5s'"); await c.query("SET LOCAL statement_timeout='60s'");
    const result = await migrateGateTaskHopper(c); await c.query("COMMIT"); console.log("Gate task hopper additive migration passed", result);
  } catch (error) { await c.query("ROLLBACK"); throw error; } finally { await c.end(); }
}
