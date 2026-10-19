/** Retire redundant active gate stations at gated Go sites without deleting history.
 *
 * Keeps the station with the strongest operational history (and always favors
 * a station with a currently active duty session). Other stations remain in
 * place for historical foreign-key readback but are marked inactive. The
 * operation is limited to the synthetic Go partner and aborts above three
 * changes. Dry run unless --apply.
 */
import { createRequire } from "node:module";
import { GO_MARKER } from "./cast";

const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
const url = process.env.GO_DEMO_DATABASE_URL;
if (!url) throw new Error("GO_DEMO_DATABASE_URL is required");
const APPLY = process.argv.includes("--apply");
const MAX_ROWS = 3;
const client = new Client({ connectionString: url });

async function main() {
  await client.connect();
  await client.query("begin");

  const sites = (await client.query(`
    select s.id, s.name
    from site_locations s
    join partners p on p.id=s.partner_id
    where p.blurb=$1
      and exists (
        select 1 from site_work_assignments w join vendors v on v.id=w.vendor_id
        where w.site_location_id=s.id and w.is_gate_contractor and v.blurb=$1
      )
      and (select count(*) from gate_stations g where g.site_id=s.id and g.active)>1
    order by s.id
  `, [GO_MARKER])).rows;

  if (sites.length > MAX_ROWS) throw new Error(`Refusing: ${sites.length} duplicate-station sites exceeds ${MAX_ROWS}`);
  const retired: Array<{ siteId: number; site: string; keep: string; retire: string[] }> = [];

  for (const site of sites) {
    const stations = (await client.query(`
      select g.id, g.name, g.created_at,
        exists(select 1 from gate_duty_sessions d where d.station_id=g.id and d.ended_at is null) active_duty,
        (select count(*) from gate_duty_sessions d where d.station_id=g.id)
          + (select count(*) from work_hub_shifts w where w.gate_station_id=g.id)
          + (select count(*) from gate_shifts s where s.station_id=g.id) reference_count
      from gate_stations g where g.site_id=$1 and g.active
      order by active_duty desc, reference_count desc, g.created_at, g.id
    `, [site.id])).rows;
    const keep = stations[0];
    if (!keep || stations.length < 2) continue;
    if (stations.filter((station: any) => station.active_duty).length > 1) {
      throw new Error(`Refusing: ${site.name} has active duty on more than one station`);
    }
    const retire = stations.slice(1).map((station: any) => station.id as string);
    retired.push({ siteId: site.id, site: site.name, keep: keep.id, retire });
    if (APPLY) {
      const result = await client.query("update gate_stations set active=false, version=version+1 where id=any($1::uuid[]) and active", [retire]);
      if (result.rowCount !== retire.length) throw new Error(`Expected to retire ${retire.length} station(s) at ${site.name}, retired ${result.rowCount}`);
    }
  }

  console.log(JSON.stringify({ apply: APPLY, retired }, null, 1));
  if (APPLY) await client.query("commit"); else await client.query("rollback");
}

main().catch(async (error) => {
  await client.query("rollback").catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
}).finally(() => client.end());
