/** Remove unreferenced duplicate gate stations at gated Go sites.
 *
 * Production's site trigger auto-creates a "Main gate" station, so the first
 * provisioning run left each gated Go site with a second, empty station. A row
 * is removed only when its site belongs to GasGo (Go marker), the site has
 * another station, and no column that can hold a station id references it.
 * Only stations created before the production provisioning cutoff qualify, so
 * stations added later through the app are never touched. Aborts if more than
 * 3 rows qualify. Dry run unless --apply.
 *
 *   GO_DEMO_DATABASE_URL=... npx tsx go-ecosphere/remove-duplicate-stations.ts [--apply]
 */
import { createRequire } from "node:module";
import { GO_MARKER } from "./cast";

const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
const url = process.env.GO_DEMO_DATABASE_URL;
if (!url) throw new Error("GO_DEMO_DATABASE_URL is required");
const APPLY = process.argv.includes("--apply");
const MAX_ROWS = 3;
const CREATED_BEFORE = process.env.GO_STATION_CREATED_BEFORE ?? "2026-10-19T01:40:00Z";
const c = new Client({ connectionString: url });

async function main() {
  await c.connect();
  await c.query("begin");
  const refColumns: { tbl: string; col: string }[] = (await c.query(`
    select distinct conrelid::regclass::text tbl, quote_ident(a.attname) col from pg_constraint k join pg_attribute a on a.attrelid=k.conrelid and a.attnum=any(k.conkey)
      where k.contype='f' and k.confrelid='gate_stations'::regclass
    union
    select format('%I.%I', table_schema, table_name), quote_ident(column_name) from information_schema.columns
      where table_schema='public' and column_name like '%station_id' and table_name<>'gate_stations'`)).rows;
  const unreferenced = refColumns.map(({ tbl, col }) => `not exists (select 1 from ${tbl} r where r.${col}::text = g.id::text)`).join(" and ");
  const candidates = (await c.query(`
    select g.id, g.name, s.id site_id, s.name site from gate_stations g join site_locations s on s.id=g.site_id join partners p on p.id=s.partner_id
    where p.blurb=$1 and g.created_at < $2
      and exists (select 1 from site_work_assignments w join vendors v on v.id=w.vendor_id where w.site_location_id=s.id and w.is_gate_contractor and v.blurb=$1)
      and exists (select 1 from gate_stations o where o.site_id=g.site_id and o.id<>g.id)
      and ${unreferenced}
    order by s.id`, [GO_MARKER, CREATED_BEFORE])).rows;
  console.log(JSON.stringify({ apply: APPLY, referenceColumnsChecked: refColumns.map((r) => `${r.tbl}.${r.col}`), candidates }, null, 1));
  if (candidates.length > MAX_ROWS) throw new Error(`Refusing: ${candidates.length} candidate stations exceeds ${MAX_ROWS}`);
  if (new Set(candidates.map((r: any) => r.site_id)).size !== candidates.length) throw new Error("Refusing: more than one candidate at the same site");
  if (!APPLY || candidates.length === 0) { await c.query("rollback"); return; }
  const ids = candidates.map((r: any) => r.id);
  const { rowCount } = await c.query("delete from gate_stations where id = any($1::uuid[])", [ids]);
  if (rowCount !== ids.length) throw new Error(`Expected to delete ${ids.length}, deleted ${rowCount}`);
  await c.query("commit");
  console.log(`Deleted ${rowCount} duplicate gate station(s)`);
}
main().catch(async (e) => { await c.query("rollback").catch(() => undefined); console.error(e); process.exitCode = 1; }).finally(() => c.end());
