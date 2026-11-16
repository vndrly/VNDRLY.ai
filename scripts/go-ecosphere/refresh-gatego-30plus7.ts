/** GateGo-only additive 30+7 refresh, derived from the established CompanyGo runner. Defaults to rollback; --apply commits.
 * No credential, qualification, consent, enrollment or external-delivery writes.
 */
import "../load-env-local.mjs";
import { assembleShiftSnapshot } from "../../artifacts/api-server/src/services/gate-change-over-snapshot";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { civilTime, dayKey, ZONE } from "./calendar-time.mjs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";


const { Client } = createRequire(
  new URL("../../lib/db/package.json", import.meta.url),
)("pg");
const target = new URL(process.env.DATABASE_URL ?? "");
if (
  !(
    target.hostname.endsWith(".pooler.supabase.com") &&
    target.username === "postgres.bihjmgbdzbhcnsuhzzwo" &&
    target.pathname === "/postgres"
  )
)
  throw Error("Unexpected CompanyGo database");
process.chdir(fileURLToPath(new URL("../../", import.meta.url)));
const c = new Client({
    connectionString: target.toString(),
    application_name: "companygo-refresh-30plus7",
  }),
  now = new Date(process.env.GO_DEMO_NOW ?? Date.now()),
  day = dayKey(now),
  apply = process.argv.includes("--apply");
if (!Number.isFinite(+now) || +now > Date.now() + 60_000) throw Error("Refresh timestamp must be valid and cannot be in the future");
const batch = "companygo-30plus7-v1",
  mark = `[${batch}]`,
  stats = {},
  checks = {};
const at = (d, h = 0, m = 0) => civilTime(day, d, h, m),
  stamp = (d) => new Date(d).toISOString(),
  clamp = (d) => new Date(Math.min(+d, +now));
const uid = (k) => {
  const h = createHash("sha256").update(`${batch}:${k}`).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
const allowed = new Set([
  "gate_preparations",
  "gate_shift_actions",
  "work_hub_shifts",
  "work_hub_shift_assignments",
  "work_hub_messages",
  "work_hub_tasks",
  "work_hub_task_events",
  "work_hub_notes",
  "work_hub_meetings",
  "work_hub_meeting_occurrences",
  "work_hub_meeting_participants",
  "ticket_crew",
  "ticket_status_history",
  "ticket_check_ins",
  "ticket_line_items",
]);
const types = new Map();
async function insert(table, row) {
  if (!allowed.has(table)) throw Error(`Table not allowed: ${table}`);
  if (!types.has(table))
    types.set(
      table,
      new Map(
        (
          await c.query(
            "select column_name,udt_name from information_schema.columns where table_schema='public' and table_name=$1",
            [table],
          )
        ).rows.map((r) => [r.column_name, r.udt_name]),
      ),
    );
  const schema = types.get(table),
    keys = Object.keys(row);
  if (keys.some((k) => !schema.has(k))) throw Error(`Unknown ${table} column`);
  const r = await c.query(
    `insert into ${table} (${keys.map((k) => `"${k}"`).join(",")}) values (${keys.map((_, i) => `$${i + 1}`).join(",")}) on conflict do nothing`,
    keys.map((k) =>
      schema.get(k) === "jsonb" ? JSON.stringify(row[k]) : row[k],
    ),
  );
  stats[table] = (stats[table] ?? 0) + r.rowCount;
}
const q = async (s, p = []) => (await c.query(s, p)).rows;
const profileNames = [
  [
    "Elena",
    "Vasquez",
    "Day relief; visitor processing and contractor check-in",
  ],
  ["Caleb", "Mercer", "Night relief; vehicle logs and shift handoffs"],
  ["Denise", "Holloway", "Yard coverage; deliveries and radio coordination"],
  [
    "Arturo",
    "Salinas",
    "Tank battery relief; visitor briefing and access records",
  ],
  ["Megan", "Bennett", "Weekend relief; gate register and escalation support"],
];
await c.connect();
try {
  await c.query("BEGIN");
  await c.query("set local lock_timeout='5s'");
  await c.query("set local idle_in_transaction_session_timeout='60s'");
  await c.query("set local statement_timeout='90s'");
  await c.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [
    batch,
  ]);
  const orgs = await q(
    "select id,name from vendors where id=any($1::int[]) order by id",
    [[1113, 1114, 1115]],
  );
  if (
    orgs.map((x) => x.name).join() !== "FieldGo,FleetGo,GateGo" ||
    (await q("select name from partners where id=614"))[0]?.name !== "GasGo"
  )
    throw Error("CompanyGo identity changed");
  const people = await q(
    "select * from vendor_people where vendor_id=any($1::int[]) and deleted_at is null and is_active=true order by user_id",
    [[1113, 1114, 1115]],
  );
  const contractors = await q(
    "select s.*,u.display_name,u.email from managed_subcontractor_worker_sponsorships s join users u on u.id=s.worker_user_id join managed_subcontractor_organizations o on o.id=s.managed_organization_id where s.sponsor_vendor_id=1115 and o.name='StaffGO' order by s.worker_user_id",
  );
  const originalContractors = contractors.filter((worker) =>
    [1157, 1158, 1159, 1160, 1161].includes(worker.worker_user_id),
  );
  if (
    originalContractors.length !== 5 ||
    originalContractors.map((x) => x.worker_user_id).join() !==
      "1157,1158,1159,1160,1161"
  )
    throw Error("StaffGO cast changed");
  const userIds = [
    ...people.map((p) => p.user_id),
    ...contractors.map((p) => p.worker_user_id),
    1105,
    1106,
    1107,
    1108,
    1109,
    1110,
  ];
  const fingerprints = await q(
    "select id,md5(coalesce(password_hash,'')) fingerprint from users where id=any($1::int[]) order by id",
    [userIds],
  );
  const before = {
    observedAt: now.toISOString(),
    operational: {
      tickets: await q("select * from tickets where vendor_id=any($1::int[])", [
        [1113, 1114, 1115],
      ]),
      checkins: await q(
        "select ci.* from ticket_check_ins ci join tickets t on t.id=ci.ticket_id where t.vendor_id=any($1::int[])",
        [[1113, 1114, 1115]],
      ),
      duties: await q(
        "select d.* from gate_duty_sessions d join gate_stations s on s.id=d.station_id where s.site_id in(399,400,401)",
      ),
      manualVisits: await q(
        "select * from site_visits where id between 3561 and 3569",
      ),
      futurePosts: await q(
        "select * from work_hub_shifts where owner_org_type='vendor' and owner_org_id=1115 and starts_at>$1",
        [now],
      ),
      fleet: await q(
        "select fleet_ops_state,fleet_resources from vendors where id=1114",
      ),
    },
    people: people.map(
      ({
        id,
        vendor_id,
        user_id,
        first_name,
        last_name,
        job_title,
        roles,
      }) => ({
        id,
        vendor_id,
        user_id,
        first_name,
        last_name,
        job_title,
        roles,
      }),
    ),
    contractors: contractors.map(
      ({ id, worker_user_id, display_name, email, status }) => ({
        id,
        worker_user_id,
        display_name,
        email,
        status,
      }),
    ),
  };
  const channels = await q(
    "select * from work_hub_channels where (owner_org_type='vendor' and owner_org_id=any($1::int[])) or(owner_org_type='partner' and owner_org_id=614)",
    [[1113, 1114, 1115]],
  );
  const memberships = await q(
    "select channel_id,user_id from work_hub_channel_members where channel_id=any($1::uuid[])",
    [channels.map((x) => x.id)],
  );
  const sites = await q(
    "select id,name,latitude,longitude from site_locations where partner_id=614 and is_active=true order by id",
  );
  const channel = (id, part) =>
    channels.find((x) => x.owner_org_id === id && x.name.includes(part));
  const name = (id) => {
    const p = people.find((p) => p.user_id === id);
    return p ? `${p.first_name} ${p.last_name}` : "GasGo operations";
  };
  const gateOverlap = await c.query(
    `update gate_duty_sessions d set started_at=prior.ended_at,post_coverage=d.post_coverage||'{"lateReliefMinutes":4,"extendedDutyReviewRequired":true}'::jsonb from gate_duty_sessions prior where d.id='bb2ff80f-3331-4e74-a05f-919cc7ebf574' and prior.id='802c945b-ad5a-4b49-9a33-b3e5e0758d08' and d.user_id=prior.user_id and d.post_coverage->>'sampleBatch'='gatego-operations-v2' and prior.post_coverage->>'synthetic'='true' and d.started_at<prior.ended_at and prior.ended_at-d.started_at<=interval '5 minutes'`,
  );
  stats.demo_late_relief_corrected = gateOverlap.rowCount;
  const manual = await c.query(
    "update site_visits set reconciliation_state='needs_review' where id between 3561 and 3569 and site_location_id in(399,400,401) and recorded_by_user_id is null and notes='GateGo demonstration arrival; synthetic driver and vehicle. No GPS arrival recorded.' and reconciliation_state='not_required'",
  );
  stats.manual_entries_flagged = manual.rowCount;
  // Existing future posts crossing fall-back keep their local 06:00 relief boundary.
  const futurePosts = await q(
    "select id,starts_at,ends_at,title from work_hub_shifts where owner_org_type='vendor' and owner_org_id=1115 and starts_at>$1 and (instructions like '%gatego-operations-v2%' or instructions='Log every entry and exit. Confirm H2S briefing for first-time visitors. Synthetic.')",
    [now],
  );
  for (const post of futurePosts) {
    if (post.title.includes("Night")) {
      const date = dayKey(post.starts_at),
        end = civilTime(date, 1, 6);
      if (+end !== +new Date(post.ends_at)) {
        await c.query("update work_hub_shifts set ends_at=$2 where id=$1", [
          post.id,
          end,
        ]);
        stats.dst_posts_corrected = (stats.dst_posts_corrected ?? 0) + 1;
      }
    }
  }

  const configs = [
    {
      id: 1113,
      type: "vendor",
      author: 1112,
      lead: 1114,
      ch: channel(1113, "All Hands"),
      office: channel(1113, "Office"),
      title: "Field crew coordination",
      agenda:
        "Hector: Crew A work scope and isolation boundaries; Wade: Crew B equipment and JSA; Brenda: parts, permits and next-day availability.",
    },
    {
      id: 1114,
      type: "vendor",
      author: 1131,
      lead: 1130,
      ch: channel(1114, "Dispatch Board"),
      office: channel(1114, "All Hands"),
      title: "Dispatch and shop planning",
      agenda:
        "Javier: loads, driver availability and destination hours; Dale: defects and unit readiness; Tanya: next-day dispatch and documentation exceptions.",
    },
    {
      id: 1115,
      type: "vendor",
      author: 1144,
      lead: 1143,
      ch: channel(1115, "Supervisors"),
      office: channel(1115, "All Hands"),
      title: "Gate coverage and handoff review",
      agenda:
        "Amber: posted shifts and relief gaps; Luis: visitor exceptions, radio checks and carry-forward actions; Sharon: contractor onboarding.",
    },
    {
      id: 614,
      type: "partner",
      author: 1106,
      lead: 1105,
      ch: channel(614, "Production Ops"),
      office: channel(614, "Accounts Payable"),
      title: "GasGo vendor coordination",
      agenda:
        "Marcus: site priorities and access; Earl: field completion exceptions; Priya: ticket documentation and invoice matching. No payment is represented by this demo.",
    },
  ];
  for (const cfg of configs.filter(cfg => cfg.id === 1115)) {
    console.log("Preparing " + cfg.id + " communications and calendars");
    if (!cfg.ch) throw Error(`Missing channel ${cfg.id}`);
    const members = memberships
      .filter((m) => m.channel_id === cfg.ch.id)
      .map((m) => m.user_id);
    if (!members.includes(cfg.author))
      throw Error("Message author not a channel member");
    const mid = uid(`meeting:${cfg.id}`);
    await insert("work_hub_meetings", {
      id: mid,
      owner_org_type: cfg.type,
      owner_org_id: cfg.id,
      channel_id: cfg.ch.id,
      title: cfg.title,
      agenda: cfg.agenda,
      timezone: ZONE,
      created_by_id: cfg.author,
      created_at: at(-29, 6),
      recording_allowed: false,
    });
    for (let d = -29; d <= 7; d++) {
      const date = dayKey(at(d, 12)),
        weekday = new Date(`${date}T12:00:00Z`).getUTCDay(),
        weekend = [0, 6].includes(weekday),
        start = at(d, 7),
        end = at(d, 7, 20),
        historical = +end < +now;
      const existing = await q(
        "select id,title,site_location_id,starts_at,ends_at from work_hub_shifts where owner_org_type=$1 and owner_org_id=$2 and starts_at >= $3 and starts_at < $4 order by starts_at",
        [cfg.type, cfg.id, at(d), at(d + 1)],
      );
      const refs = existing
        .slice(0, 3)
        .map((s) => s.title)
        .join("; ");
      // Plan/dispatch at the time, not future-dated messages masquerading as sent.
      if (+start < +now) {
        const body =
          cfg.id === 1113
            ? `${weekend ? "Standby coordination" : "Morning crew board"} — ${date}. ${refs || "Hector and Wade: confirm crew availability before accepting additional work."} Keep the JSA and isolation review with the ticket; report scope changes to Brenda before proceeding.`
            : cfg.id === 1114
              ? `${date} dispatch board: ${refs || "Review produced-water, crude and hotshot requests against available drivers and units."} Confirm destination hours, pre-trip defects and receiving contact before release. Dispatch owns load changes; drivers report delays safely when stopped.`
              : cfg.id === 1115
                ? `${date} coverage review: ${refs || "Review Main Gate day and night posts at Antelope Draw, Coyote Ridge and Stanton Yard."} Confirm relief and carry forward unresolved gate actions. StaffGO contractors stay in the pool pending enrollment and qualification review.`
                : `${date} vendor coordination: ${refs || "Review FieldGo, FleetGo and GateGo work for the operating sites."} Match service dates, site/AFE and supporting ticket detail before AP review. Escalate access restrictions through the gate supervisor.`;
        await insert("work_hub_messages", {
          id: uid(`message:${cfg.id}:${date}`),
          channel_id: cfg.ch.id,
          author_user_id: cfg.author,
          kind: "text",
          body,
          client_operation_id: uid(`message-op:${cfg.id}:${date}`),
          created_at: start,
        });
      }
      if (!weekend && weekday === 1) {
        const oid = uid(`occurrence:${cfg.id}:${date}`);
        await insert("work_hub_meeting_occurrences", {
          id: oid,
          meeting_id: mid,
          starts_at: start,
          ends_at: end,
          status: historical ? "ended" : "scheduled",
          created_at: clamp(at(d - 2, 12)),
        });
        for (const id of members.slice(0, 5))
          await insert("work_hub_meeting_participants", {
            id: uid(`participant:${oid}:${id}`),
            occurrence_id: oid,
            user_id: id,
            role: id === cfg.author ? "host" : "participant",
            rsvp: "pending",
          });
      }
      if (!weekend && [1, 3, 5].includes(weekday)) {
        await insert("work_hub_tasks", {
          id: uid(`task:${cfg.id}:${date}`),
          owner_org_type: cfg.type,
          owner_org_id: cfg.id,
          channel_id: cfg.ch.id,
          title:
            cfg.id === 1113
              ? "Confirm next work package, parts and JSA"
              : cfg.id === 1114
                ? "Review unit readiness and dispatch paperwork"
                : cfg.id === 1115
                  ? "Review relief coverage and unresolved gate actions"
                  : "Match vendor tickets to site and AFE",
          description: `${cfg.agenda} ${mark} Demo coordination follow-up.`,
          status: d < -2 ? "completed" : d < 0 ? "in_progress" : "open",
          assignee_user_id: cfg.author,
          created_by_id: cfg.author,
          due_at: at(d, 15),
          created_at: clamp(at(d - 1, 14)),
          updated_at: d < -2 ? at(d, 15) : clamp(at(d - 1, 14)),
        });
        if (d < -2)
          await insert("work_hub_task_events", {
            id: uid("task-resolution:" + cfg.id + ":" + date),
            task_id: uid("task:" + cfg.id + ":" + date),
            actor_user_id: cfg.author,
            event_type: "status.completed",
            detail: {
              completedById: cfg.author,
              resolution:
                cfg.id === 1113
                  ? "Work package and parts reviewed; outstanding field exceptions remain with their tickets."
                  : cfg.id === 1114
                    ? "Dispatch paperwork and unit readiness reviewed; individual defects remain with maintenance."
                    : cfg.id === 1115
                      ? "Relief board and unresolved actions reviewed with the supervisor."
                      : "Service dates and AFE references checked; ticket approval and payment remain separate.",
            },
            created_at: at(d, 15),
          });
      }
    }
  }
  const gateNotes = channel(1115, "Supervisors");
  await insert("work_hub_notes", {
    id: uid("staffgo-roster"),
    channel_id: gateNotes.id,
    title: "StaffGO relief roster — onboarding pending",
    body: profileNames
      .map(
        ([f, l, b], i) =>
          `${f} ${l}\nGatekeeper · StaffGO contracted employee\n${b}. Preferred coverage only; availability must be confirmed.\nSites: Antelope Draw, Coyote Ridge, Stanton Yard. Enrollment, qualifications and login activation remain pending; not approved for assignment.\nContact: ${f.toLowerCase()}.${l.toLowerCase()}@staffgo.example.invalid`,
      )
      .join("\n\n"),
    created_by_id: 1144,
    updated_by_id: 1144,
    created_at: now,
    updated_at: now,
  });
  // Gate posts use civil boundaries, including the thirteen-hour fall-back night.
  const stations = await q(
    "select id,site_id,name from gate_stations where active=true and site_id=any($1::int[]) order by site_id",
    [[399, 400, 401]],
  );
  for (let d = -29; d <= 7; d++)
    for (const station of stations)
      for (const hour of [6, 18]) {
        const start = at(d, hour),
          end = at(d + (hour === 18 ? 1 : 0), hour === 18 ? 6 : 18);
        const existing = await q(
          "select id from work_hub_shifts where gate_station_id=$1 and starts_at<$3 and ends_at>$2",
          [station.id, start, end],
        );
        if (existing.length) continue;
        const id = uid(`gate-post:${station.id}:${stamp(start)}`),
          site = sites.find((s) => s.id === station.site_id);
        await insert("work_hub_shifts", {
          id,
          owner_org_type: "vendor",
          owner_org_id: 1115,
          channel_id: gateNotes.id,
          title: `${site.name} — ${hour === 6 ? "Day" : "Night"} gate post`,
          starts_at: start,
          ends_at: end,
          timezone: ZONE,
          open: true,
          created_by_id: 1144,
          created_at: clamp(at(d - 3, 12)),
          site_location_id: site.id,
          gate_station_id: station.id,
          required_staff_count: 1,
          qualification_codes: ["Texas Level II Security"],
          instructions: `${mark} Coverage gap for supervisor review. Do not assign unqualified or unenrolled workers.`,
        });
      }
  // Recent gate traffic is a fictional manual register, never asserted GPS proof.
  const visitorCast = [
    ["Nolan", "Reed", "Basin Pump Service", "Pump-service work order"],
    ["Sofia", "Cantu", "West Lease Electric", "Instrumentation service"],
    ["Dustin", "Webb", "Red Mesa Water", "Produced-water pickup"],
    [
      "Alyssa",
      "Torres",
      "Permian Safety Supply",
      "Badge and first-aid delivery",
    ],
    ["Marcus", "Hale", "Prairie Well Service", "Equipment inspection"],
    ["Briana", "Soto", "Stanton Industrial", "Replacement parts delivery"],
  ];
  for (let d = -29; d <= 0; d++)
    for (const station of stations) {
      if (
        (
          await q(
            "select id from site_visits where gate_station_id=$1 and check_in_time >=$2 and check_in_time<$3 limit 1",
            [station.id, at(d), at(d + 1)],
          )
        ).length
      )
        continue;
      for (let n = 0; n < 6; n++) {
        const enter = at(d, 7 + n * 1.5, (station.site_id % 3) * 4),
          leave = new Date(+enter + (45 + ((n * 17) % 90)) * 60000);
        if (+leave > +now) continue;
        const [first, last, company, purpose] =
          visitorCast[(n + station.site_id) % visitorCast.length];
        const duty = (
          await q(
            "select user_id from gate_duty_sessions where station_id=$1 and started_at<=$2 and started_at>$2::timestamptz-interval '18 hours' and coalesce(ended_at,$3)>=$2 order by started_at desc limit 1",
            [station.id, enter, now],
          )
        )[0];
        await c.query(
          `insert into site_visits(site_location_id,host_type,host_partner_id,first_name,last_name,company,purpose,vehicle_plate,plate_state,check_in_time,check_out_time,recorded_by_user_id,observation_source,reconciliation_state,admission_status,expected_duration_minutes,notes,created_at,gate_station_id,entry_category) values($1,'partner',614,$2,$3,$4,$5,$6,'TX',$7,$8,$9,'manual',$10,'admitted',120,$11,$7,$12,'visitor')`,
          [
            station.site_id,
            first,
            last,
            company,
            purpose,
            `DEMO-${station.site_id}-${n + 1}`,
            enter,
            leave,
            duty?.user_id ?? null,
            duty ? "not_required" : "needs_review",
            `${mark} Fictional manual visitor register; no GPS or identity verification.`,
            station.id,
          ],
        );
        stats.site_visits = (stats.site_visits ?? 0) + 1;
      }
    }


  for (const station of stations) {
    const staleRows = await q("select id from site_visits where gate_station_id=$1 and check_out_time is null and check_in_time<$2::timestamptz-interval '24 hours'", [station.id,now]);
    if (staleRows.length) await insert("work_hub_tasks", {
      id: uid(`stale-register-review:${station.id}:${day}`), owner_org_type:"vendor",owner_org_id:1115,channel_id:gateNotes.id,
      title:"Review aged open gate register", description: `${mark} Gate ${station.id}: ${staleRows.length} older open records require review. Do not infer departures or alter physical evidence.`,
      status:"open",priority:"high",created_by_id:1144,assignee_user_id:1143,created_at:now,updated_at:now,due_at:at(1,12),
    });
  }
  const catalog = (await q("select work_type_id from vendor_work_types where vendor_id=1115 order by id limit 1"))[0];
  if (!catalog) throw Error("GateGo service catalog missing");
  let ticketCount = 0;
  for (let d=-29; d<=7; d++) for (const site of sites.filter(site=>[399,400,401].includes(site.id))) {
    const start=at(d,6),end=at(d+1,6), dateKey=dayKey(start);
    const key=`[gatego-30plus7-review-v1] Fictional coverage review: ${site.id}:${dateKey}. No verified attendance, GPS, approval or payment.`;
    if ((await q("select id from tickets where vendor_id=1115 and site_location_id=$1 and scheduled_start_at >=$2 and scheduled_start_at<$3 limit 1",[site.id,at(d),at(d+1)])).length) continue;
    const historical=+end<+now,status=historical?(d < -14 ? "submitted" : "pending_review"):"initiated",created=clamp(at(d-1,12)),updated=historical?end:created;
    const ticket=(await q(`insert into tickets(site_location_id,vendor_id,work_type_id,status,lifecycle_state,intake_channel,description,notes,scheduled_start_at,scheduled_duration_minutes,scheduled_at,scheduled_by_id,created_by_id,created_at,updated_at)
      values($1,1115,$2,$3,$4,'web',$5,$6,$7,$8,$9,1144,1144,$9,$10) returning id`,[site.id,catalog.work_type_id,status,historical?"off_site":"pending_arrival",`Gate coverage — ${site.name} — ${dateKey}`,key,start,Math.round((+end-+start)/60000),created,updated]))[0];
    await insert("ticket_status_history",{ticket_id:ticket.id,from_status:null,to_status:status,actor_user_id:1144,actor_role:"vendor",reason:key,created_at:updated});ticketCount++;
  }
  checks.newTickets = ticketCount;


  // Current screenshot-ready activity is still explicitly fictional and manually recorded.
  const showcaseMark="[gatego-showcase-v1]";
  const showcaseNotes=[
    "West approach reduced to one lane while the maintenance crew repairs a bollard. Keep the emergency lane clear; next update due in one hour.",
    "Night camera reported movement at the closed secondary gate. Supervisor review requested; keep the gate secured and retain the camera reference.",
    "Two service crews expected at daybreak. Confirm the host and work order before admission; oversized delivery requires an escort.",
    "Radio check complete. Spare battery charged; visitor badge stock replenished. Carry forward the gate-arm lamp inspection for maintenance.",
    "Water-haul driver reported a loose load strap before departure. Vehicle remains in the staging area pending the driver's inspection."
  ];
  for (let si=0;si<stations.length;si++) {
    const station=stations[si];
    for(let n=0;n<5;n++) {
      const key=`${showcaseMark} ${day}:${station.id}:${n}. Fictional visitor; no verified GPS or identity evidence.`;
      if ((await q("select id from site_visits where gate_station_id=$1 and notes=$2",[station.id,key])).length)continue;
      const visitor=visitorCast[(si+n)%visitorCast.length],enter=new Date(+now-(25+n*19)*60000),left=n>=3?new Date(+now-(n*4)*60000):null;
      await q(`insert into site_visits(site_location_id,host_type,host_partner_id,first_name,last_name,company,purpose,vehicle_plate,plate_state,check_in_time,check_out_time,recorded_by_user_id,observation_source,reconciliation_state,admission_status,expected_duration_minutes,notes,created_at,gate_station_id,entry_category)
        values($1,'partner',614,$2,$3,$4,$5,$6,'TX',$7,$8,1143,'manual','needs_review',$9,180,$10,$7,$11,'visitor')`,[station.site_id,...visitor,`DEMO-${si+1}${n+1}`,enter,left,n===0?'pending':'admitted',key,station.id]);
      stats.showcase_visitors=(stats.showcase_visitors??0)+1;
    }
    const text=showcaseNotes[si%showcaseNotes.length],noteKey=uid(`showcase-note:${day}:${station.id}`);
    await insert("work_hub_notes",{id:noteKey,channel_id:gateNotes.id,title:`${station.name} — shift briefing`,body: text+"\n\n"+showcaseMark+" Fictional screenshot scenario. No alert or message was sent.",created_by_id:1143,updated_by_id:1143,created_at:now,updated_at:now});
    const watch=(await q("select s.*,p.notes previous_notes from gate_shifts s left join gate_preparations p on p.id=s.preparation_id where s.station_id=$1 and s.ended_at is null order by s.started_at desc limit 1",[station.id]))[0];
    if(watch && !(await q("select id from gate_preparations where id=$1",[noteKey])).length) {
      const rows=await q("select id,first_name,last_name,company,vehicle_plate,check_in_time,check_out_time,admission_status,expected_duration_minutes,reconciliation_state,notes from site_visits where gate_station_id=$1 and check_in_time>=$2 order by check_in_time desc limit 100",[station.id,at(-1)]);
      const snapshot=assembleShiftSnapshot(rows.map(r=>({id:`visit:${r.id}`,kind:"visitor",name:`${r.first_name} ${r.last_name}`,company:r.company,plate:r.vehicle_plate,checkIn:stamp(r.check_in_time),checkOut:r.check_out_time?stamp(r.check_out_time):null,admission:r.admission_status,expectedMinutes:r.expected_duration_minutes,reconciliation:r.reconciliation_state,notes:r.notes})),[],stamp(at(-1)),now);
      const notes=[watch.previous_notes,`${stamp(now)} · Luis Ortega\n${text}\n${showcaseMark} Fictional scenario; no external escalation sent.`].filter(Boolean).join("\n\n");
      if(notes.length<=8000){await insert("gate_preparations",{id:noteKey,shift_id:watch.id,prepared_by:1143,snapshot,notes,summary:{source:"structured_facts",facts:snapshot.facts,sampleBatch:showcaseMark},created_at:now});await q("update gate_shifts set preparation_id=$2 where id=$1 and preparation_id is not distinct from $3",[watch.id,noteKey,watch.preparation_id]);await insert("gate_shift_actions",{id:noteKey,station_id:station.id,actor_id:1143,item_id:watch.id,kind:"shift_note",text:text+" "+showcaseMark,created_at:now});}
    }
  }

  const invariants = [
    [
      "ticket history matches current status",
      `select t.id from tickets t join lateral(select to_status from ticket_status_history where ticket_id=t.id order by created_at desc,id desc limit 1) h on true where t.vendor_id=1115 and t.status<>h.to_status`,
    ],
    [
      "no overlapping check-ins",
      `select a.id from ticket_check_ins a join ticket_check_ins b on a.employee_id=b.employee_id and a.id<b.id and tstzrange(a.check_in_at,coalesce(a.check_out_at,now())) && tstzrange(b.check_in_at,coalesce(b.check_out_at,now())) join tickets t on t.id=a.ticket_id where t.vendor_id=1115`,
    ],
    [
      "no overlapping gate duties",
      `select a.id from gate_duty_sessions a join gate_duty_sessions b on a.user_id=b.user_id and a.id<b.id and tstzrange(a.started_at,coalesce(a.ended_at,now())) && tstzrange(b.started_at,coalesce(b.ended_at,now())) join gate_stations s on s.id=a.station_id where s.site_id in(399,400,401)`,
    ],
    [
      "message authors are channel members",
      `select m.id from work_hub_messages m join work_hub_channels ch on ch.id=m.channel_id where ch.owner_org_type='vendor' and ch.owner_org_id=1115 and not exists(select 1 from work_hub_channel_members cm where cm.channel_id=m.channel_id and cm.user_id=m.author_user_id)`,
    ],
    [
      "crew stays with its company",
      `select tc.id from ticket_crew tc join tickets t on t.id=tc.ticket_id join vendor_people p on p.id=tc.employee_id where t.vendor_id=1115 and p.vendor_id<>t.vendor_id`,
    ],
  ];
  for (const [label, sql] of invariants) {
    const bad = await q(sql);
    if (bad.length) throw Error(`${label}: ${bad.length} inconsistencies`);
    checks[label] = true;
  }
  const afterFingerprints = await q(
    "select id,md5(coalesce(password_hash,'')) fingerprint from users where id=any($1::int[]) order by id",
    [userIds],
  );
  if (JSON.stringify(fingerprints) !== JSON.stringify(afterFingerprints))
    throw Error("Credential invariant failed");
  checks.credentialsUnchanged = true;
  const futureMessages = await q(
    "select count(*)::int n from work_hub_messages where client_operation_id=any($1::uuid[]) and created_at>$2",
    [
      configs.flatMap((cfg) =>
        Array.from({ length: 37 }, (_, i) =>
          uid(`message-op:${cfg.id}:${dayKey(at(i - 29, 12))}`),
        ),
      ),
      now,
    ],
  );
  if (futureMessages[0].n) throw Error("Future sent message");
  checks.noFutureMessages = true;
  const coverage = [];
  for (const cfg of configs.filter(cfg => cfg.id === 1115))
    coverage.push({
      company: cfg.id,
      calendar: (
        await q(
          "select count(*)::int n,max(ends_at) through from work_hub_shifts where owner_org_type=$1 and owner_org_id=$2 and starts_at>=$3 and starts_at<$4",
          [cfg.type, cfg.id, at(-29), at(8)],
        )
      )[0],
    });
  await mkdir(".local", { recursive: true });
  const report = {
    batch,
    mode: apply ? "applied" : "dry-run",
    observedAt: now.toISOString(),
    window: { from: dayKey(at(-29)), through: dayKey(at(7)), timezone: ZONE },
    stats,
    checks,
    coverage,
    contractorNames: profileNames.map((x) => `${x[0]} ${x[1]}`),
  };
  if (apply) {
    await writeFile(
      `.local/gatego-before-${day}.json`,
      JSON.stringify(before, null, 2),
      { flag: "wx" },
    ).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  await c.query(apply ? "COMMIT" : "ROLLBACK");
  await writeFile(
    `.local/gatego-refresh-${apply ? "applied" : "dry-run"}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
