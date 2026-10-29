/** Additive CompanyGo 30+7 refresh. Defaults to rollback; --apply commits.
 * No credential, qualification, consent, enrollment or external-delivery writes.
 */
import "../load-env-local.mjs";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { civilTime, dayKey, ZONE } from "./calendar-time.mjs";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { FleetTicketPlanSchema } from "../../lib/api-zod/src/fleet-commercial";
import { FleetRunSchema } from "../../lib/api-zod/src/fleet";
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
  if (
    contractors.length !== 5 ||
    contractors.map((x) => x.worker_user_id).join() !==
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
  for (const p of people) {
    let tag =
      p.vendor_id === 1115 && p.user_id !== 1142 && p.user_id !== 1144
        ? "Gatekeeper"
        : p.vendor_id === 1114 &&
            (p.user_id >= 1134 || [1131, 1132].includes(p.user_id))
          ? "Driver"
          : p.vendor_id === 1113 && p.user_id >= 1114
            ? "Field Worker"
            : "Office Staff";
    let roles = [
      ...new Set([
        ...(p.roles ?? []).filter(
          (x) =>
            ![
              "Office Staff",
              "Field Worker",
              "Driver",
              "Gatekeeper",
              "Dispatcher",
            ].includes(x),
        ),
        tag,
        ...([1131, 1132].includes(p.user_id) ? ["Dispatch"] : []),
        ...(p.user_id === 1143 ? ["Gate Supervisor"] : []),
        ...([1114, 1115].includes(p.user_id) ? ["Foreman"] : []),
        ...(p.user_id === 1144 ? ["Scheduler"] : []),
      ]),
    ];
    roles.sort();
    if (JSON.stringify(p.roles) !== JSON.stringify(roles)) {
      await c.query(
        "update vendor_people set roles=$1::text[] where id=$2 and vendor_id=$3",
        [roles, p.id, p.vendor_id],
      );
      stats.staff_classifications = (stats.staff_classifications ?? 0) + 1;
    }
  }
  // Contacts remain on the same accounts. No login, invitation or qualification changes.
  for (let i = 0; i < contractors.length; i++) {
    const p = contractors[i],
      [first, last] = profileNames[i],
      display = `${first} ${last}`,
      email = `${first.toLowerCase()}.${last.toLowerCase()}@staffgo.example.invalid`;
    const r = await c.query(
      "update users set display_name=$1,email=$2 where id=$3 and (display_name is distinct from $1 or email is distinct from $2)",
      [display, email, p.worker_user_id],
    );
    stats.contractor_profiles = (stats.contractor_profiles ?? 0) + r.rowCount;
  }
  // Repair only identifiable, stale demo sessions; retain rows and scheduled assignments.
  const stale = await q(
    `select t.id,t.status,t.scheduled_start_at,t.scheduled_duration_minutes,max(ci.check_in_at) last_in from tickets t join ticket_check_ins ci on ci.ticket_id=t.id where t.vendor_id=1113 and t.status='in_progress' and t.notes like 'Synthetic VNDRLY test company (go-ecosphere-v1).%' and ci.check_out_at is null and ci.check_in_at<$1::timestamptz-interval '72 hours' group by t.id`,
    [now],
  );
  for (const t of stale) {
    const scheduledEnd = t.scheduled_start_at
      ? new Date(
          +new Date(t.scheduled_start_at) +
            (t.scheduled_duration_minutes ?? 480) * 60000,
        )
      : null;
    const end =
      scheduledEnd &&
      +scheduledEnd > +new Date(t.last_in) &&
      +scheduledEnd < +new Date(t.last_in) + 24 * 3600000
        ? scheduledEnd
        : new Date(+new Date(t.last_in) + 8 * 3600000);
    await c.query(
      "update ticket_check_ins set check_out_at=$2 where ticket_id=$1 and check_out_at is null",
      [t.id, end],
    );
    await c.query(
      "update tickets set status='pending_review',lifecycle_state='off_site',check_out_time=$2,updated_at=$2 where id=$1 and status='in_progress'",
      [t.id, end],
    );
    await insert("ticket_status_history", {
      ticket_id: t.id,
      from_status: t.status,
      to_status: "pending_review",
      actor_user_id: 1112,
      actor_role: "vendor",
      reason: `${mark} Aged fictional shift closed at its sample work window for review; no GPS or payroll approval represented.`,
      created_at: end,
    });
    stats.stale_demo_sessions_closed =
      (stats.stale_demo_sessions_closed ?? 0) + 1;
  }
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
  for (const cfg of configs) {
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
  // Fill missing Field/Fleet calendar coverage, preserving all existing bookings.
  for (const vendor of [1113, 1114]) {
    const cfg = configs.find((x) => x.id === vendor),
      crew = people.filter(
        (p) =>
          p.vendor_id === vendor &&
          (vendor === 1113 ? p.user_id >= 1114 : p.user_id >= 1134),
      );
    for (let d = -29; d <= 7; d++) {
      const date = dayKey(at(d, 12)),
        weekend = [0, 6].includes(new Date(`${date}T12:00Z`).getUTCDay());
      if (weekend && vendor === 1113) continue;
      const scheduled = await q(
        "select id from work_hub_shifts where owner_org_type='vendor' and owner_org_id=$1 and starts_at >= $2 and starts_at < $3",
        [vendor, at(d), at(d + 1)],
      );
      if (scheduled.length) continue;
      const start = at(d, 8),
        end = at(d, vendor === 1113 ? 16 : 15),
        site = sites.filter((s) => s.id >= 402)[(d + 29) % 8],
        shiftId = uid(`shift:${vendor}:${date}`),
        worker = crew[(d + 29) % crew.length];
      const conflicts = await q(
        "select a.user_id from work_hub_shift_assignments a join work_hub_shifts s on s.id=a.shift_id where a.user_id=$1 and s.starts_at<$3 and s.ends_at>$2 and a.status not in ('cancelled','declined')",
        [worker.user_id, start, end],
      );
      if (conflicts.length) continue;
      const title =
        vendor === 1113
          ? `${site.name} — ${["valve and flowline inspection", "tank battery maintenance", "location housekeeping", "instrumentation checks"][(d + 29) % 4]}`
          : `${site.name} — ${weekend ? "weekend produced-water coverage" : "haul and hotshot dispatch window"}`;
      await insert("work_hub_shifts", {
        id: shiftId,
        owner_org_type: "vendor",
        owner_org_id: vendor,
        channel_id: cfg.ch.id,
        title,
        starts_at: start,
        ends_at: end,
        timezone: ZONE,
        created_by_id: cfg.author,
        created_at: clamp(at(d - 2, 12)),
        updated_at: clamp(at(d - 2, 12)),
        site_location_id: site.id,
        owner_user_id: worker.user_id,
        required_staff_count: 1,
        instructions: `${mark} Confirm access and scope before mobilizing. ${vendor === 1113 ? "JSA and isolation review required." : "Dispatch confirms receiving hours and compatible equipment; pre-trip required."}`,
      });
      await insert("work_hub_shift_assignments", {
        id: uid(`assignment:${shiftId}`),
        shift_id: shiftId,
        user_id: worker.user_id,
        status: "assigned",
        assigned_by_id: cfg.author,
        created_at: clamp(at(d - 2, 12)),
      });
    }
  }
  // Gate posts use civil boundaries, including the thirteen-hour fall-back night.
  const stations = await q(
    "select id,site_id from gate_stations where active=true and site_id=any($1::int[]) order by site_id",
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
            "select id from site_visits where site_location_id=$1 and check_in_time >=$2 and check_in_time<$3 limit 1",
            [station.site_id, at(d), at(d + 1)],
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
            "select user_id from gate_duty_sessions where station_id=$1 and started_at<=$2 and coalesce(ended_at,$3)>=$2 order by started_at desc limit 1",
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

  const addedTickets = [];
  // Extend missing service dates with traceable work, never fabricated payment or GPS proof.
  const fleetRow = (
      await q("select fleet_ops_state from vendors where id=1114 for update")
    )[0],
    fleetState = fleetRow.fleet_ops_state;
  const fleetTemplate = fleetState.runs.find(
    (r) =>
      r.loads?.length &&
      r.stops.some((s) => s.destination) &&
      r.events?.length > 5 &&
      !r.resourceAssignment &&
      !r.recoveredWork &&
      !r.localWork,
  );
  if (!fleetTemplate) throw Error("No established produced-water run template");
  // Replace generic labels on the recent stable Fleet workflow fixtures.
  const assetNames = new Map(
    (
      await q(
        "select id,name from assets where responsible_org_type='vendor' and responsible_org_id=1114",
      )
    ).map((a) => [a.id, a.name]),
  );
  const stableTickets = await q(
    "select t.id,t.site_location_id,t.scheduled_start_at,t.scheduled_duration_minutes,t.check_in_time,t.check_out_time,t.closed_at,s.name site_name,w.name work_name from tickets t join site_locations s on s.id=t.site_location_id join work_types w on w.id=t.work_type_id where t.vendor_id=1114 and t.notes like 'Stable additive %Fleet%' and t.id between 1870000000 and 1870000106",
  );
  const resources = (
    await q("select fleet_resources from vendors where id=1114")
  )[0].fleet_resources;
  for (const run of fleetState.runs) {
    const t = stableTickets.find((t) => t.id === run.linkedTicketId);
    if (!t) continue;
    const labels = {
      driverName: name(run.driverUserId),
      vehicleName: assetNames.get(run.vehicleAssetId) ?? "FleetGo tractor",
      trailerName: assetNames.get(run.trailerAssetId) ?? null,
      sites: [{ siteId: t.site_location_id, name: t.site_name }],
    };
    const title = `${t.work_name} — ${t.site_name} — ${run.billing?.workDate ?? dayKey(t.scheduled_start_at)}`;
    const changed =
      !isDeepStrictEqual(run.labels, labels) || run.title !== title;
    run.labels = labels;
    run.title = title;
    // The stable billing fixture's ticket timestamps are authoritative. It has
    // no physical-event chain, so do not invent GPS, inspections or delivery proof.
    if (run.resourceAssignment?.snapshot?.labels) {
      const labels = run.resourceAssignment.snapshot.labels;
      labels.driver = name(run.driverUserId);
      labels.truck = assetNames.get(run.vehicleAssetId) ?? labels.truck;
      for (const component of labels.components)
        component.label = assetNames.get(component.assetId) ?? component.label;
    }
    if (t.scheduled_start_at) {
      const start = new Date(t.scheduled_start_at),
        end = new Date(+start + (t.scheduled_duration_minutes ?? 480) * 60000);
      run.schedule = {
        plannedStartAt: stamp(start),
        plannedEndAt: stamp(end),
        timezone: ZONE,
      };
      const reservation = run.resourceAssignment?.reservation;
      if (reservation) {
        reservation.startAt = stamp(start);
        reservation.plannedEndAt = stamp(end);
        if (reservation.state === "released" && t.closed_at)
          reservation.actualReleasedAt = stamp(t.closed_at);
        const registry = resources.reservations.find(
          (r) => r.id === reservation.id,
        );
        if (registry) Object.assign(registry, reservation);
      }
    }
    FleetRunSchema.parse(run);
    if (changed)
      stats.fleet_profiles_enriched = (stats.fleet_profiles_enriched ?? 0) + 1;
  }

  const runsBefore = fleetState.runs.length;
  for (const vendor of [1113, 1114])
    for (let d = -29; d <= 7; d++) {
      const date = dayKey(at(d, 12)),
        weekend = [0, 6].includes(new Date(`${date}T12:00Z`).getUTCDay());
      if (vendor === 1113 && weekend) continue;
      const key = `${mark} service:${vendor}:${date}`;
      if (
        (
          await q(
            "select id from tickets where vendor_id=$1 and (notes=$2 or (scheduled_start_at >=$3 and scheduled_start_at<$4)) limit 1",
            [vendor, key, at(d), at(d + 1)],
          )
        ).length
      )
        continue;
      const historical = +at(d, 16) < +now,
        planned = +at(d, 8) > +now;
      // Fleet's active work is represented by its existing operational fixture.
      if (vendor === 1114 && !historical && !planned) continue;
      const site =
        vendor === 1114
          ? sites.find((s) => s.id === fleetTemplate.siteIds[0])
          : sites.filter((s) => s.id >= 402)[(d + 29) % 8];
      const candidates = people.filter(
        (p) =>
          p.vendor_id === vendor &&
          (vendor === 1113
            ? p.user_id >= 1114
            : p.user_id === fleetTemplate.driverUserId),
      );
      const worker = candidates[(d + 29) % candidates.length],
        start = at(d, 8),
        end = at(d, vendor === 1113 ? 16 : 11),
        created = clamp(at(d - 2, 14));
      const overlap = await q(
        "select id from ticket_check_ins where employee_id=$1 and check_in_at<$3 and coalesce(check_out_at,$4)>$2 limit 1",
        [worker.id, start, end, now],
      );
      if (overlap.length) continue;
      const wt = vendor === 1113 ? 576361 : 576371;
      const assigned = await q(
        "select id from site_work_assignments where vendor_id=$1 and site_location_id=$2 and work_type_id=$3",
        [vendor, site.id, wt],
      );
      if (!assigned.length)
        throw Error("Service not in assigned vendor catalog");
      if (vendor === 1114) {
        const collision = fleetState.runs.some((r) => {
          const from =
              r.schedule?.plannedStartAt ??
              r.events?.find((e) => e.type === "start")?.recordedAt,
            to =
              r.schedule?.plannedEndAt ??
              r.events?.find((e) => e.type === "submit_closeout")?.recordedAt;
          if (!from || !to) return false;
          return (
            (r.driverUserId === worker.user_id ||
              r.vehicleAssetId === fleetTemplate.vehicleAssetId) &&
            +new Date(from) < +end &&
            +new Date(to) > +start
          );
        });
        if (collision) continue;
      }
      const desc =
        vendor === 1113
          ? `${site.name} — ${["lease-road and pad housekeeping", "flowline supports and valve tagging", "tank battery housekeeping and access inspection", "material staging and equipment support"][(d + 29) % 4]}`
          : `Produced-water haul — ${site.name} to ${fleetTemplate.stops.find((s) => s.destination).destination.name}`;
      const office = vendor === 1113 ? 1112 : 1131,
        foreman =
          vendor === 1113 ? (worker.user_id === 1115 ? 1115 : 1114) : null;
      const ticket = (
        await q(
          `insert into tickets (site_location_id,vendor_id,field_employee_id,work_type_id,status,lifecycle_state,intake_channel,description,notes,scheduled_start_at,scheduled_duration_minutes,scheduled_at,scheduled_by_id,created_by_id,foreman_user_id,created_at,updated_at,check_in_time,check_out_time,arrived_at) values($1,$2,$3,$4,$5,$6,'vendor_direct',$7,$8,$9,$10,$11,$12,$12,$13,$11,$14,$15,$16,$15) returning id`,
          [
            site.id,
            vendor,
            worker.id,
            wt,
            historical ? "submitted" : planned ? "initiated" : "in_progress",
            historical ? "off_site" : planned ? "pending_arrival" : "on_site",
            desc,
            key,
            start,
            (+end - +start) / 60000,
            created,
            office,
            foreman,
            historical ? end : planned ? created : start,
            planned ? null : start,
            historical ? end : null,
          ],
        )
      )[0];
      addedTickets.push(ticket.id);
      stats.tickets = (stats.tickets ?? 0) + 1;
      await insert("ticket_crew", {
        ticket_id: ticket.id,
        employee_id: worker.id,
        added_by_user_id: office,
        added_at: created,
        ack_status: planned ? "pending" : "accepted",
        ack_at: planned ? null : start,
      });
      const stages = historical
        ? [
            ["initiated", created, office],
            ["in_progress", start, worker.user_id],
            ["pending_review", end, worker.user_id],
            ["submitted", new Date(+end + 60000), office],
          ]
        : planned
          ? [["initiated", created, office]]
          : [
              ["initiated", created, office],
              ["in_progress", start, worker.user_id],
            ];
      let from = null;
      for (const [to, when, actor] of stages) {
        await insert("ticket_status_history", {
          ticket_id: ticket.id,
          from_status: from,
          to_status: to,
          actor_user_id: actor,
          actor_role: "vendor",
          reason: `${mark} Fictional service workflow; no attendance or payment verification.`,
          created_at: when,
        });
        from = to;
      }
      if (vendor === 1113 && !planned) {
        await insert("ticket_check_ins", {
          ticket_id: ticket.id,
          employee_id: worker.id,
          check_in_at: start,
          check_out_at: historical ? end : null,
          source: "manual",
          created_at: start,
        });
        if (historical)
          await insert("ticket_line_items", {
            ticket_id: ticket.id,
            type: "labor",
            description: `Roustabout labor — ${name(worker.user_id)}`,
            quantity: "8",
            unit_price: "45",
            created_at: end,
          });
      }
      if (vendor === 1114) {
        const run = structuredClone(fleetTemplate),
          rid = uid(`run:${date}`),
          oldStart = new Date(
            run.events.find((e) => e.type === "start").recordedAt,
          ),
          delta = +start - +oldStart,
          ids = new Map();
        const idmap = (id) => {
          if (!ids.has(id)) ids.set(id, uid(`${rid}:${id}`));
          return ids.get(id);
        };
        function remap(value) {
          if (Array.isArray(value)) return value.map(remap);
          if (value && typeof value === "object")
            return Object.fromEntries(
              Object.entries(value).map(([k, v]) => [k, remap(v)]),
            );
          if (typeof value === "string" && /^\d{4}-\d\d-\d\dT/.test(value))
            return stamp(new Date(+new Date(value) + delta));
          if (
            typeof value === "string" &&
            /^[a-f0-9-]{36}$/.test(value) &&
            value !== run.fleetId &&
            value !== run.vehicleAssetId &&
            value !== run.trailerAssetId &&
            value !== run.stops.find((s) => s.destination)?.destination.id
          )
            return idmap(value);
          return value;
        }
        const shifted = remap(run);
        shifted.id = rid;
        shifted.linkedTicketId = ticket.id;
        shifted.title = desc;
        shifted.schedule = {
          plannedStartAt: stamp(start),
          plannedEndAt: stamp(end),
          timezone: ZONE,
        };
        shifted.labels = {
          driverName: name(worker.user_id),
          vehicleName: "FleetGo produced-water tractor",
          trailerName: "FleetGo vacuum trailer",
          sites: [{ siteId: site.id, name: site.name }],
        };
        shifted.billing = {
          ...shifted.billing,
          workDate: date,
          afeNumber: `LOE-${date.slice(0, 4)}-${site.id}`,
        };
        delete shifted.eventHistory;
        delete shifted.resourceAssignment;
        delete shifted.routePlan;
        delete shifted.runOrder;
        delete shifted.commercial;
        delete shifted.ticketReference;
        delete shifted.billingV2;
        if (planned) {
          shifted.status = "draft";
          shifted.phase = null;
          shifted.loads = [];
          shifted.records = [];
          shifted.inspections = [];
          shifted.visitedStopIds = [];
          shifted.currentStopId = null;
          shifted.events = [
            {
              id: uid(`run-create:${date}`),
              operationId: uid(`run-create-op:${date}`),
              type: "created",
              actorUserId: 1131,
              recordedAt: stamp(now),
              source: "user_report",
              details: { sampleBatch: batch },
            },
          ];
          shifted.version = 1;
          shifted.allowedActions = [];
        } else {
          shifted.status = "submitted_for_review";
          shifted.events = shifted.events.filter((e) => e.type !== "review");
          shifted.version = shifted.events.length;
          shifted.allowedActions = [];
          if (shifted.events.some((e) => +new Date(e.recordedAt) > +now))
            throw Error("Future run actual");
          await insert("ticket_line_items", {
            ticket_id: ticket.id,
            type: "other",
            description: `Produced-water haul — run ${rid}`,
            quantity: "1",
            unit_price: "185",
            created_at: end,
          });
        }
        fleetState.runs.push(FleetRunSchema.parse(shifted));
        const dest = shifted.stops.find((s) => s.destination).destination;
        const plan = {
          billingWorkflow: true,
          billingUnit: "per_job",
          afeNumber: shifted.billing.afeNumber,
          workDate: date,
          version: 1,
          siteId: site.id,
          vendorId: 1114,
          partnerId: 614,
          mode: "singles",
          rateCents: 18500,
          currency: "USD",
          closure: "manual",
          closesAt: null,
          destinations: [dest],
          closedAt: null,
          createdByUserId: 1131,
          createdAt: stamp(created),
          operations: [],
        };
        await c.query("update tickets set fleet_plan=$1::jsonb where id=$2", [
          JSON.stringify(FleetTicketPlanSchema.parse(plan)),
          ticket.id,
        ]);
      }
      const cfg = configs.find((x) => x.id === vendor);
      if (historical)
        await insert("work_hub_messages", {
          id: uid(`ticket-close:${ticket.id}`),
          channel_id: cfg.ch.id,
          author_user_id: cfg.author,
          kind: "text",
          body: `${name(worker.user_id)}: ${desc}. Ticket #${ticket.id} submitted with ${vendor === 1113 ? "labor detail; supervisor review remains separate." : "load and receiving reference; dispatch review remains separate."}`,
          client_operation_id: uid(`ticket-close-op:${key}`),
          created_at: new Date(+end + 120000),
        });
    }
  if (fleetState.runs.length !== runsBefore || stats.fleet_profiles_enriched) {
    await c.query(
      "update vendors set fleet_ops_state=$1::jsonb,fleet_resources=$2::jsonb where id=1114",
      [JSON.stringify(fleetState), JSON.stringify(resources)],
    );
    stats.fleet_runs = fleetState.runs.length - runsBefore;
  }
  // GasGo's calendar includes its own vendor coordination work, not duplicate crew assignments.
  for (let d = -29; d <= 7; d++) {
    const date = dayKey(at(d, 12)),
      weekday = new Date(`${date}T12:00Z`).getUTCDay();
    if ([0, 6].includes(weekday)) continue;
    const id = uid(`gasgo-review:${date}`);
    await insert("work_hub_shifts", {
      id,
      owner_org_type: "partner",
      owner_org_id: 614,
      channel_id: channel(614, "Production Ops").id,
      title: `Vendor work and access coordination — ${date}`,
      starts_at: at(d, 9),
      ends_at: at(d, 9, 30),
      timezone: ZONE,
      created_by_id: 1106,
      created_at: clamp(at(d - 2, 12)),
      owner_user_id: 1106,
      instructions: `${mark} Review FieldGo work scopes, FleetGo delivery windows and GateGo coverage. Priya separately reconciles supporting tickets; no payment approval implied.`,
    });
  }
  checks.newTickets = addedTickets.length;
  checks.fleetRunsValidated = stats.fleet_runs ?? 0;

  const invariants = [
    [
      "ticket history matches current status",
      `select t.id from tickets t join lateral(select to_status from ticket_status_history where ticket_id=t.id order by created_at desc,id desc limit 1) h on true where t.vendor_id in(1113,1114,1115) and t.status<>h.to_status`,
    ],
    [
      "no overlapping check-ins",
      `select a.id from ticket_check_ins a join ticket_check_ins b on a.employee_id=b.employee_id and a.id<b.id and tstzrange(a.check_in_at,coalesce(a.check_out_at,now())) && tstzrange(b.check_in_at,coalesce(b.check_out_at,now())) join tickets t on t.id=a.ticket_id where t.vendor_id in(1113,1114,1115)`,
    ],
    [
      "no overlapping gate duties",
      `select a.id from gate_duty_sessions a join gate_duty_sessions b on a.user_id=b.user_id and a.id<b.id and tstzrange(a.started_at,coalesce(a.ended_at,now())) && tstzrange(b.started_at,coalesce(b.ended_at,now())) join gate_stations s on s.id=a.station_id where s.site_id in(399,400,401)`,
    ],
    [
      "message authors are channel members",
      `select m.id from work_hub_messages m join work_hub_channels ch on ch.id=m.channel_id where ch.owner_org_id in(614,1113,1114,1115) and not exists(select 1 from work_hub_channel_members cm where cm.channel_id=m.channel_id and cm.user_id=m.author_user_id)`,
    ],
    [
      "crew stays with its company",
      `select tc.id from ticket_crew tc join tickets t on t.id=tc.ticket_id join vendor_people p on p.id=tc.employee_id where t.vendor_id in(1113,1114,1115) and p.vendor_id<>t.vendor_id`,
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
  for (const cfg of configs)
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
      `.local/companygo-before-${day}.json`,
      JSON.stringify(before, null, 2),
      { flag: "wx" },
    ).catch((error) => {
      if (error.code !== "EEXIST") throw error;
    });
  }
  await c.query(apply ? "COMMIT" : "ROLLBACK");
  await writeFile(
    `.local/companygo-refresh-${apply ? "applied" : "dry-run"}.json`,
    JSON.stringify(report, null, 2),
  );
  console.log(JSON.stringify(report, null, 2));
} catch (e) {
  await c.query("ROLLBACK");
  throw e;
} finally {
  await c.end();
}
