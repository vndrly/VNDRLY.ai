import bcrypt from "bcryptjs";
import { pool } from "@workspace/db";

const EXPECTED_LOGINS = [
  "partner_admin@gasgo.com", "partner_office@gasgo.com", "partner_foreman@gasgo.com",
  "vendor_admin@fieldgo.com", "vendor_office@fieldgo.com", "vendor_foreman@fieldgo.com", "vendor_field@fieldgo.com",
  "vendor_admin@fleetgo.com", "vendor_office@fleetgo.com", "vendor_fleet_dispatch@fleetgo.com", "vendor_fleet_driver@fleetgo.com",
  "vendor_admin@gatego.com", "vendor_office@gatego.com", "vendor_gate_supervisor@gatego.com", "vendor_gatekeeper@gatego.com",
];

async function rows(text: string, values: unknown[] = []) {
  return (await pool.query(text, values)).rows;
}

async function main() {
  const logins = await rows(`
    SELECT u.username, u.password_hash, u.role, m.org_type, m.role membership_role,
           p.name partner, v.name vendor, vp.vendor_role, vp.roles
    FROM users u
    LEFT JOIN user_org_memberships m ON m.user_id=u.id
    LEFT JOIN partners p ON p.id=m.partner_id
    LEFT JOIN vendors v ON v.id=m.vendor_id
    LEFT JOIN vendor_people vp ON vp.user_id=u.id
    WHERE lower(u.username)=ANY($1::text[]) ORDER BY u.username
  `, [EXPECTED_LOGINS]);
  const loginResults = EXPECTED_LOGINS.map((username) => {
    const login = logins.find((row) => row.username.toLowerCase() === username);
    return { username, exists: Boolean(login), passwordOk: login ? bcrypt.compareSync("companygo", login.password_hash) : false,
      role: login?.role ?? null, membershipRole: login?.membership_role ?? null,
      company: login?.partner ?? login?.vendor ?? null, vendorRole: login?.vendor_role ?? null, roles: login?.roles ?? [] };
  });

  const dayCoverage = await rows(`
    WITH local_clock AS (SELECT (now() AT TIME ZONE 'America/Chicago')::date AS today),
    days AS (SELECT generate_series(today-29,today+7,'1 day')::date AS service_day FROM local_clock),
    ticket_days AS (SELECT scheduled_start_at::date AS service_day,count(*)::int n FROM tickets WHERE (vendor_id IN (1113,1114,1115) OR site_location_id IN (SELECT id FROM site_locations WHERE partner_id=614)) GROUP BY 1),
    visit_days AS (SELECT check_in_time::date AS service_day,count(*)::int n FROM site_visits WHERE site_location_id IN (SELECT id FROM site_locations WHERE partner_id=614) GROUP BY 1),
    shift_days AS (SELECT starts_at::date AS service_day,count(*)::int n FROM work_hub_shifts WHERE (owner_org_type='partner' AND owner_org_id=614) OR (owner_org_type='vendor' AND owner_org_id IN (1113,1114,1115)) GROUP BY 1)
    SELECT d.service_day,coalesce(t.n,0) tickets,coalesce(v.n,0) visits,coalesce(s.n,0) shifts FROM days d LEFT JOIN ticket_days t USING(service_day) LEFT JOIN visit_days v USING(service_day) LEFT JOIN shift_days s USING(service_day) ORDER BY d.service_day
  `);
  const workflow = await rows(`
    SELECT json_build_object(
      'sites',(SELECT count(*)::int FROM site_locations WHERE partner_id=614),
      'relationships',(SELECT count(*)::int FROM partner_vendor_relationships WHERE partner_id=614 AND vendor_id IN (1113,1114,1115)),
      'catalogServices',(SELECT count(*)::int FROM vendor_work_types WHERE vendor_id IN (1113,1114,1115)),
      'siteAssignments',(SELECT count(*)::int FROM site_work_assignments WHERE vendor_id IN (1113,1114,1115) AND site_location_id IN (SELECT id FROM site_locations WHERE partner_id=614)),
      'tickets',(SELECT count(*)::int FROM tickets WHERE vendor_id IN (1113,1114,1115) AND site_location_id IN (SELECT id FROM site_locations WHERE partner_id=614)),
      'ticketCrew',(SELECT count(*)::int FROM ticket_crew WHERE ticket_id IN (SELECT id FROM tickets WHERE vendor_id IN (1113,1114,1115))),
      'checkIns',(SELECT count(*)::int FROM ticket_check_ins WHERE ticket_id IN (SELECT id FROM tickets WHERE vendor_id IN (1113,1114,1115))),
      'lineItems',(SELECT count(*)::int FROM ticket_line_items WHERE ticket_id IN (SELECT id FROM tickets WHERE vendor_id IN (1113,1114,1115))),
      'statusHistory',(SELECT count(*)::int FROM ticket_status_history WHERE ticket_id IN (SELECT id FROM tickets WHERE vendor_id IN (1113,1114,1115))),
      'invoices',(SELECT count(*)::int FROM invoices WHERE partner_id=614 AND vendor_id IN (1113,1114,1115)),
      'invoiceLines',(SELECT count(*)::int FROM invoice_lines WHERE invoice_id IN (SELECT id FROM invoices WHERE partner_id=614 AND vendor_id IN (1113,1114,1115))),
      'invoicePayments',(SELECT count(*)::int FROM invoice_payments WHERE invoice_id IN (SELECT id FROM invoices WHERE partner_id=614 AND vendor_id IN (1113,1114,1115))),
      'gateStations',(SELECT count(*)::int FROM gate_stations WHERE site_id IN (SELECT id FROM site_locations WHERE partner_id=614)),
      'gateVisits',(SELECT count(*)::int FROM site_visits WHERE site_location_id IN (SELECT id FROM site_locations WHERE partner_id=614)),
      'fleetGoVisits',(SELECT count(*)::int FROM site_visits WHERE site_location_id IN (SELECT id FROM site_locations WHERE partner_id=614) AND lower(company)='fleetgo'),
      'gateGoRecordedVisits',(SELECT count(*)::int FROM site_visits sv JOIN user_org_memberships m ON m.user_id=sv.recorded_by_user_id WHERE m.vendor_id=1115),
      'fleetAssets',(SELECT count(*)::int FROM assets WHERE responsible_org_type='vendor' AND responsible_org_id=1114),
      'fleetTrips',(SELECT count(*)::int FROM field_trips WHERE owner_org_type='vendor' AND owner_org_id=1114),
      'tripPoints',(SELECT count(*)::int FROM field_trip_location_points WHERE trip_id IN (SELECT id FROM field_trips WHERE owner_org_type='vendor' AND owner_org_id=1114)),
      'tripCrossings',(SELECT count(*)::int FROM field_trip_crossings WHERE trip_id IN (SELECT id FROM field_trips WHERE owner_org_type='vendor' AND owner_org_id=1114)),
      'workHubChannels',(SELECT count(*)::int FROM work_hub_channels WHERE (owner_org_type='partner' AND owner_org_id=614) OR (owner_org_type='vendor' AND owner_org_id IN (1113,1114,1115))),
      'workHubMessages',(SELECT count(*)::int FROM work_hub_messages WHERE channel_id IN (SELECT id FROM work_hub_channels WHERE (owner_org_type='partner' AND owner_org_id=614) OR (owner_org_type='vendor' AND owner_org_id IN (1113,1114,1115)))),
      'workHubTasks',(SELECT count(*)::int FROM work_hub_tasks WHERE (owner_org_type='partner' AND owner_org_id=614) OR (owner_org_type='vendor' AND owner_org_id IN (1113,1114,1115))),
      'workHubShifts',(SELECT count(*)::int FROM work_hub_shifts WHERE (owner_org_type='partner' AND owner_org_id=614) OR (owner_org_type='vendor' AND owner_org_id IN (1113,1114,1115))),
      'shiftAssignments',(SELECT count(*)::int FROM work_hub_shift_assignments WHERE shift_id IN (SELECT id FROM work_hub_shifts WHERE (owner_org_type='partner' AND owner_org_id=614) OR (owner_org_type='vendor' AND owner_org_id IN (1113,1114,1115))))
    ) result
  `);
  const statuses = await rows(`SELECT v.name vendor,status,lifecycle_state,count(*)::int count FROM tickets t JOIN vendors v ON v.id=t.vendor_id WHERE v.id IN(1113,1114,1115) GROUP BY 1,2,3 ORDER BY 1,2,3`);
  const invoiceStatuses = await rows(`SELECT v.name vendor,i.status,count(*)::int count,sum(i.total)::numeric total FROM invoices i JOIN vendors v ON v.id=i.vendor_id WHERE i.partner_id=614 AND i.vendor_id IN(1113,1114,1115) GROUP BY 1,2 ORDER BY 1,2`);
  const failures = [
    ...loginResults.filter((r) => !r.exists || !r.passwordOk).map((r) => `login:${r.username}`),
    ...dayCoverage.filter((r) => Number(r.tickets)===0 && Number(r.visits)===0 && Number(r.shifts)===0).map((r) => `day:${r.service_day.toISOString().slice(0,10)}`),
  ];
  console.log(JSON.stringify({ ok: failures.length===0, failures, loginResults, workflow: workflow[0].result, dayCoverage, statuses, invoiceStatuses }, null, 2));
  if (failures.length) process.exitCode = 2;
}

main().catch((error) => { console.error(error); process.exitCode=1; }).finally(async()=>pool.end());
