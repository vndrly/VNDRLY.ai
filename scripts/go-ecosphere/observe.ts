/** Read-only observation report for the Go companies: per-company footprint,
 * daily trends, and work-life consistency checks. Exits 1 on any violation.
 *
 *   GO_DEMO_DATABASE_URL=postgres://.../db npx tsx go-ecosphere/observe.ts
 */
import { createRequire } from "node:module";
import { FleetRunSchema, type FleetRun } from "../../lib/api-zod/src/fleet";
import { FleetTicketPlanSchema } from "../../lib/api-zod/src/fleet-commercial";
import { GO_MARKER } from "./cast";

const { Client } = createRequire(new URL("../../lib/db/package.json", import.meta.url))("pg");
const url = process.env.GO_DEMO_DATABASE_URL;
if (!url) throw new Error("GO_DEMO_DATABASE_URL is required");
const c = new Client({ connectionString: url });

const checks: { name: string; violations: number; sample?: unknown }[] = [];
async function check(name: string, sql: string, params: unknown[] = []) {
  const { rows } = await c.query(sql, params);
  checks.push({ name, violations: rows.length, ...(rows.length ? { sample: rows.slice(0, 3) } : {}) });
}

async function main() {
  await c.connect();
  await c.query("begin read only");
  const { rows: orgs } = await c.query("select 'partner' kind,id,name from partners where blurb=$1 union all select 'vendor',id,name from vendors where blurb=$1 order by 1,2", [GO_MARKER]);
  if (orgs.length !== 4) throw new Error(`Expected 4 Go companies, found ${orgs.length}`);
  const partnerId = orgs.find((o: any) => o.kind === "partner").id;
  const vendorIds: number[] = orgs.filter((o: any) => o.kind === "vendor").map((o: any) => o.id);
  const p = [partnerId, vendorIds];
  const goTickets = "select t.* from tickets t join site_locations s on s.id=t.site_location_id where s.partner_id=$1 and t.vendor_id=any($2)";

  // ---------- footprint
  const footprint: Record<string, unknown> = {};
  for (const o of orgs) {
    const isP = o.kind === "partner";
    const q = async (sql: string) => Number((await c.query(sql, [o.id])).rows[0].n);
    footprint[o.name] = {
      people: await q(`select count(*) n from user_org_memberships where ${isP ? "partner_id" : "vendor_id"}=$1`),
      tickets: isP ? await q("select count(*) n from tickets t join site_locations s on s.id=t.site_location_id where s.partner_id=$1") : await q("select count(*) n from tickets where vendor_id=$1"),
      ticketStatus: Object.fromEntries((await c.query(isP ? "select t.status,count(*)::int n from tickets t join site_locations s on s.id=t.site_location_id where s.partner_id=$1 group by 1 order by 1" : "select status,count(*)::int n from tickets where vendor_id=$1 group by 1 order by 1", [o.id])).rows.map((r: any) => [r.status, r.n])),
      workHubMessages: await q(`select count(*) n from work_hub_messages m join work_hub_channels ch on ch.id=m.channel_id where ch.owner_org_type='${isP ? "partner" : "vendor"}' and ch.owner_org_id=$1`),
      workHubTasks: await q(`select count(*) n from work_hub_tasks where owner_org_type='${isP ? "partner" : "vendor"}' and owner_org_id=$1`),
      shifts: await q(`select count(*) n from work_hub_shifts where owner_org_type='${isP ? "partner" : "vendor"}' and owner_org_id=$1`),
      invoices: await q(`select count(*) n from invoices where ${isP ? "partner_id" : "vendor_id"}=$1`),
      notifications: await q(`select count(*) n from notifications n join user_org_memberships m on m.user_id=n.user_id where m.${isP ? "partner_id" : "vendor_id"}=$1`),
      assistantUsage: Object.fromEntries((await c.query(`select client_surface,count(*)::int n from assistant_action_audit where ${isP ? "partner_id" : "vendor_id"}=$1 and target_type='synthetic' group by 1 order by 1`, [o.id])).rows.map((r: any) => [r.client_surface, r.n])),
    };
  }
  const fleetVendor = orgs.find((o: any) => o.name === "FleetGo").id;
  const gateVendor = orgs.find((o: any) => o.name === "GateGo").id;
  const runs: FleetRun[] = (await c.query("select distinct on (target_id) target_id, tool_output from assistant_action_audit where vendor_id=$1 and target_type='fleet-run' order by target_id, id desc", [fleetVendor])).rows.map((r: any) => FleetRunSchema.parse(r.tool_output));
  const fleet = {
    runsByStatus: runs.reduce((m: Record<string, number>, r) => ({ ...m, [r.status]: (m[r.status] ?? 0) + 1 }), {}),
    openRunsOnVendorRow: (await c.query("select jsonb_array_length(fleet_ops_state->'runs')::int n from vendors where id=$1", [fleetVendor])).rows[0].n,
    routePoints: Number((await c.query("select count(*) n from assistant_action_audit where vendor_id=$1 and target_type='fleet-location'", [fleetVendor])).rows[0].n),
    loadsByCommodity: runs.flatMap((r) => r.loads).reduce((m: Record<string, number>, l) => ({ ...m, [l.commodity.startsWith("Produced") ? "Produced water (bbl)" : l.commodity.startsWith("Crude") ? "Crude oil (bbl)" : "Hotshot loads"]: Math.round((m[l.commodity.startsWith("Produced") ? "Produced water (bbl)" : l.commodity.startsWith("Crude") ? "Crude oil (bbl)" : "Hotshot loads"] ?? 0) + (l.unit === "bbl" ? l.quantity : 1)) }), {}),
  };
  const gate = {
    visitsByCategory: Object.fromEntries((await c.query("select coalesce(entry_category,'(unclassified)') k,count(*)::int n from site_visits v join site_locations s on s.id=v.site_location_id where s.partner_id=$1 group by 1 order by 1", [partnerId])).rows.map((r: any) => [r.k, r.n])),
    visitsByAdmission: Object.fromEntries((await c.query("select coalesce(admission_status,'-') k,count(*)::int n from site_visits v join site_locations s on s.id=v.site_location_id where s.partner_id=$1 group by 1 order by 1", [partnerId])).rows.map((r: any) => [r.k, r.n])),
    onSiteNow: Number((await c.query("select count(*) n from site_visits v join site_locations s on s.id=v.site_location_id where s.partner_id=$1 and v.check_out_time is null and v.admission_status<>'denied'", [partnerId])).rows[0].n),
    needsReview: Number((await c.query("select count(*) n from site_visits v join site_locations s on s.id=v.site_location_id where s.partner_id=$1 and v.reconciliation_state='needs_review'", [partnerId])).rows[0].n),
    dutySessions: Number((await c.query("select count(*) n from gate_duty_sessions d join user_org_memberships m on m.user_id=d.user_id where m.vendor_id=$1", [gateVendor])).rows[0].n),
    activePosts: Number((await c.query("select count(*) n from gate_duty_sessions d join user_org_memberships m on m.user_id=d.user_id where m.vendor_id=$1 and d.ended_at is null", [gateVendor])).rows[0].n),
    uncoveredPosts: Number((await c.query("select count(*) n from work_hub_shifts where owner_org_type='vendor' and owner_org_id=$1 and gate_station_id is not null and open", [gateVendor])).rows[0].n),
  };
  const trend = (await c.query(`
    with days as (select generate_series((select min(created_at) from tickets where vendor_id=any($2))::date, now()::date, '1 day')::date d)
    select to_char(d,'MM-DD Dy') as day,
      (select count(*) from tickets t where t.vendor_id=$3 and (t.scheduled_start_at at time zone 'America/Chicago')::date=d)::int field,
      (select count(*) from tickets t where t.vendor_id=$4 and (t.created_at at time zone 'America/Chicago')::date=d)::int fleet_tix,
      (select count(*) from site_visits v join site_locations s on s.id=v.site_location_id where s.partner_id=$1 and (v.check_in_time at time zone 'America/Chicago')::date=d)::int gate_entries,
      (select count(*) from work_hub_messages m join work_hub_channels ch on ch.id=m.channel_id where (ch.owner_org_type='partner' and ch.owner_org_id=$1 or ch.owner_org_id=any($2)) and (m.created_at at time zone 'America/Chicago')::date=d)::int messages,
      (select coalesce(sum(li.quantity*li.unit_price),0)::int from ticket_line_items li join tickets t on t.id=li.ticket_id where t.vendor_id=any($2) and (li.created_at at time zone 'America/Chicago')::date=d) billed_usd
    from days order by d`, [partnerId, vendorIds, orgs.find((o: any) => o.name === "FieldGo").id, fleetVendor])).rows;
  const runsPerDay = runs.reduce((m: Record<string, number>, r) => { const first = r.events.find((e) => e.type === "start"); if (first) { const k = new Date(Date.parse(first.recordedAt) - 5 * 3600e3).toISOString().slice(5, 10); m[k] = (m[k] ?? 0) + 1; } return m; }, {});
  for (const row of trend) row.fleet_runs = runsPerDay[row.day.slice(0, 5)] ?? 0;

  // ---------- consistency checks
  await check("status ↔ lifecycle pairing", `select id,status,lifecycle_state from (${goTickets}) t where vendor_id<>$3 and not (
      (status='in_progress' and lifecycle_state='on_site') or
      (status in ('pending_review','completed','submitted','approved','awaiting_payment','funds_dispersed','kicked_back','denied','cancelled') and lifecycle_state='off_site') or
      (status in ('initiated','draft','awaiting_acceptance') and coalesce(lifecycle_state,'pending_arrival') in ('pending_arrival','en_route','on_location')))`, [...p, fleetVendor]);
  await check("fleet ticket status ↔ lifecycle pairing", `select id,status,lifecycle_state from tickets where vendor_id=$1 and not ((status='initiated' and lifecycle_state='pending_arrival') or (status<>'initiated' and lifecycle_state='off_site'))`, [fleetVendor]);
  await check("status history ends at current status", `select t.id,t.status,h.to_status from (${goTickets}) t join lateral (select to_status from ticket_status_history where ticket_id=t.id order by created_at desc,id desc limit 1) h on true where h.to_status<>t.status`, p);
  await check("status history is chronological and starts after creation", `select t.id from (${goTickets}) t join ticket_status_history h on h.ticket_id=t.id group by t.id,t.created_at having min(h.created_at)<t.created_at - interval '1 second'`, p);
  await check("no recorded activity in the future", `select 'history' k,max(h.created_at) as ts from ticket_status_history h join (${goTickets}) t on t.id=h.ticket_id having max(h.created_at)>now()
      union all select 'visits',max(check_in_time) from site_visits v join site_locations s on s.id=v.site_location_id where s.partner_id=$1 having max(check_in_time)>now()
      union all select 'messages',max(m.created_at) from work_hub_messages m join work_hub_channels ch on ch.id=m.channel_id where ((ch.owner_org_type='partner' and ch.owner_org_id=$1) or (ch.owner_org_type='vendor' and ch.owner_org_id=any($2))) having max(m.created_at)>now()
      union all select 'route points',max(created_at) from assistant_action_audit where vendor_id=any($2) and target_type='fleet-location' having max(created_at)>now()`, p);
  await check("check-out after check-in", `select ci.id from ticket_check_ins ci join (${goTickets}) t on t.id=ci.ticket_id where ci.check_out_at < ci.check_in_at`, p);
  await check("no worker double-booked across overlapping check-ins", `select a.employee_id,a.ticket_id,b.ticket_id other from ticket_check_ins a join ticket_check_ins b on a.employee_id=b.employee_id and a.id<b.id
      and tstzrange(a.check_in_at,coalesce(a.check_out_at,now())) && tstzrange(b.check_in_at,coalesce(b.check_out_at,now())) join (${goTickets}) t on t.id=a.ticket_id`, p);
  await check("crew belongs to the ticket's vendor", `select tc.ticket_id from ticket_crew tc join (${goTickets}) t on t.id=tc.ticket_id join vendor_people vp on vp.id=tc.employee_id where vp.vendor_id<>t.vendor_id`, p);
  await check("gate attendant shifts never overlap for the same person", `select a.user_id from gate_duty_sessions a join gate_duty_sessions b on a.user_id=b.user_id and a.id<b.id and tstzrange(a.started_at,coalesce(a.ended_at,now())) && tstzrange(b.started_at,coalesce(b.ended_at,now())) join user_org_memberships m on m.user_id=a.user_id and m.vendor_id=$1`, [gateVendor]);
  const gated = (col: string) => `exists (select 1 from site_work_assignments w where w.site_location_id=${col} and w.vendor_id=${gateVendor} and w.is_gate_contractor)`;
  await check("every FieldGo crew arrival at a gated site has a gate entry", `select t.id from tickets t where t.vendor_id=$1 and ${gated("t.site_location_id")} and t.on_location_at is not null and not exists (select 1 from site_visits v where v.site_location_id=t.site_location_id and v.company='FieldGo' and v.purpose like '%#'||t.id)`, [orgs.find((o: any) => o.name === "FieldGo").id]);
  await check("gate entries recorded by an on-duty attendant or flagged for review", `select v.id from site_visits v join site_locations s on s.id=v.site_location_id where s.partner_id=$1 and ${gated("v.site_location_id")} and not (
      v.reconciliation_state='needs_review' or exists (select 1 from gate_duty_sessions d join gate_stations g on g.id=d.station_id where g.site_id=v.site_location_id and d.user_id=v.recorded_by_user_id and d.started_at<=v.check_in_time and coalesce(d.ended_at,now())>=v.check_in_time))`, [partnerId]);
  await check("one gate station per gated site", `select s.id,count(g.id)::int stations from site_locations s join gate_stations g on g.site_id=s.id where s.partner_id=$1 and ${gated("s.id")} group by s.id having count(g.id)<>1`, [partnerId]);
  const ticketIds = new Set((await c.query("select id from tickets where vendor_id=$1", [fleetVendor])).rows.map((r: any) => r.id));
  const billedLines = new Map((await c.query("select li.id,li.ticket_id from ticket_line_items li join tickets t on t.id=li.ticket_id where t.vendor_id=$1 and li.type='other'", [fleetVendor])).rows.map((r: any) => [r.id, r.ticket_id]));
  const runViolations = runs.filter((r) => {
    if (r.status === "cancelled") return false;
    if (!r.linkedTicketId || !ticketIds.has(r.linkedTicketId)) return true;
    if (r.status === "completed" && (!r.billing?.billedLineId || billedLines.get(r.billing.billedLineId) !== r.linkedTicketId)) return true;
    const times = r.events.map((e) => Date.parse(e.recordedAt));
    return times.some((t, i) => i && t < times[i - 1]);
  });
  checks.push({ name: "fleet runs: linked ticket, billed line, ordered events", violations: runViolations.length, ...(runViolations.length ? { sample: runViolations.slice(0, 2).map((r) => r.id) } : {}) });
  const driverOverlap: string[] = [];
  const windows = runs.filter((r) => r.events.some((e) => e.type === "start")).map((r) => ({ id: r.id, driver: r.driverUserId, from: Date.parse(r.events.find((e) => e.type === "start")!.recordedAt), to: Date.parse((r.events.find((e) => e.type === "submit_closeout") ?? r.events.at(-1))!.recordedAt) }));
  for (const a of windows) for (const b of windows) if (a.id < b.id && a.driver === b.driver && a.from < b.to && b.from < a.to) driverOverlap.push(`${a.id}/${b.id}`);
  checks.push({ name: "no driver on two runs at once", violations: driverOverlap.length, ...(driverOverlap.length ? { sample: driverOverlap.slice(0, 2) } : {}) });
  const plans = (await c.query("select id,site_location_id,fleet_plan from tickets where vendor_id=$1", [fleetVendor])).rows;
  const badPlans = plans.filter((t: any) => { const r = FleetTicketPlanSchema.safeParse(t.fleet_plan); return !r.success || r.data.siteId !== t.site_location_id; });
  checks.push({ name: "fleet ticket plans valid and site-locked", violations: badPlans.length, ...(badPlans.length ? { sample: badPlans.slice(0, 2).map((t: any) => t.id) } : {}) });
  await check("route points stay inside their run window", `with r as (select distinct on (target_id) target_id, tool_output o from assistant_action_audit where vendor_id=$1 and target_type='fleet-run' order by target_id,id desc)
      select a.target_id from assistant_action_audit a join r on r.target_id=a.target_id where a.vendor_id=$1 and a.target_type='fleet-location'
      and (a.tool_output->'observation'->>'recordedAt')::timestamptz < (select min((e->>'recordedAt')::timestamptz) from jsonb_array_elements(r.o->'events') e where e->>'type'='start') - interval '1 minute' limit 5`, [fleetVendor]);
  await check("invoice totals equal their lines plus tax", `select i.id,i.total,sum(l.amount)+i.tax_total lines from invoices i join invoice_lines l on l.invoice_id=i.id where i.partner_id=$1 group by i.id having abs(i.total-(sum(l.amount)+i.tax_total))>0.05`, [partnerId]);
  await check("invoiced tickets were approved first", `select k.ticket_id from invoice_ticket_links k join invoices i on i.id=k.invoice_id join tickets t on t.id=k.ticket_id where i.partner_id=$1 and t.status not in ('approved','awaiting_payment','funds_dispersed')`, [partnerId]);
  await check("message authors are channel members", `select m.id from work_hub_messages m join work_hub_channels ch on ch.id=m.channel_id where ((ch.owner_org_type='partner' and ch.owner_org_id=$1) or (ch.owner_org_type='vendor' and ch.owner_org_id=any($2))) and not exists (select 1 from work_hub_channel_members cm where cm.channel_id=m.channel_id and cm.user_id=m.author_user_id)`, p);
  await check("task assignees belong to the task's channel", `select t.id,t.title from work_hub_tasks t where t.channel_id is not null and ((t.owner_org_type='partner' and t.owner_org_id=$1) or (t.owner_org_type='vendor' and t.owner_org_id=any($2))) and not exists (select 1 from work_hub_channel_members cm where cm.channel_id=t.channel_id and cm.user_id=t.assignee_user_id)`, p);
  await check("every non-admin vendor person can see at least one contracted site", `select vp.id,vp.vendor_id from vendor_people vp join user_org_memberships m on m.user_id=vp.user_id and m.vendor_id=vp.vendor_id where vp.vendor_id=any($1) and m.role<>'admin' and not exists (select 1 from vendor_person_site_access a join site_work_assignments w on w.site_location_id=a.site_location_id and w.vendor_id=vp.vendor_id where a.vendor_people_id=vp.id and a.is_active)`, [vendorIds]);
  await check("company isolation: no Go user is a member of a non-Go company", `select m.user_id from user_org_memberships m join users u on u.id=m.user_id where u.username like 'go-demo-%' and not (m.partner_id=$1 or m.vendor_id=any($2))`, p);
  await c.query("rollback");
  const failed = checks.filter((x) => x.violations);
  console.log(JSON.stringify({ footprint, fleet, gate, checks, trend }, null, 1));
  console.error(`\n${checks.length - failed.length}/${checks.length} consistency checks passed`);
  if (failed.length) process.exitCode = 1;
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => c.end());
