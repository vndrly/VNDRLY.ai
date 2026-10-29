# Go ecosphere — four synthetic companies with 30 days of work life

`scripts/go-ecosphere/` builds four fictional companies that operate together in
Martin County, TX, so every Field, Fleet, Gate, billing and Work Hub workflow can
be exercised against data that looks like real use:

| Company | Type | People | What they do |
|---|---|---|---|
| **GasGo** | Partner (operator) | 6 + reviewer | Owns 11 sites (8 pads, 2 central tank batteries, 1 yard), posts Hotlist jobs, approves/kicks back tickets, pays invoices |
| **FieldGo** | Field Ops vendor | 18 | Office (owner, dispatcher, billing), Crew A (Hector) and Crew B (Wade, also HSE), four specialist techs |
| **FleetGo** | Fleet Ops vendor | 13 | Owner, fleet manager, dispatcher, billing, mechanic, 8 CDL drivers; 8 power units + 6 trailers |
| **GateGo** | Gate Ops vendor | 14 | Owner, gate supervisor, scheduler, 11 gate attendants covering 3 gated sites, day and night posts |

Every row is marked synthetic (`go-ecosphere-v1` in org blurbs, descriptions and
notes; `go-demo-*@example.invalid` logins; `(fictional)` outside companies).

## Where the data lives

The provisioner only writes to:

- a **loopback** Postgres database (any name except `postgres`);
- the isolated demo database **`vndrly_prairie_demo`**; or
- the **production** Supabase project `bihjmgbdzbhcnsuhzzwo`, only when `GO_DEMO_ALLOW_PRODUCTION=bihjmgbdzbhcnsuhzzwo` is set and the URL is that project's direct host or pooler user.

It refuses every other hosted target. It is **one-shot and additive**: inside one transaction
under an advisory lock it inserts rows into an allow-listed set of tables, and it
refuses to run if any Go company or `go-demo-*` user already exists. It never
updates or deletes existing rows (apart from setting `active_membership_id` on
the users it just created).

Limitation for `vndrly_prairie_demo`: demo-realm sign-in requires each user to be
listed in `artifacts/api-server/src/lib/demo-identities.ts`, and the demo boundary
is read-mostly (`lib/demo-boundary.ts`), so write workflows (ticket transitions,
dispatch, gate check-in) are blocked there. A local database or a dedicated staging
database is the right home for write-workflow testing.

### Live (production)

`.github/workflows/deploy-api.yml` has a step after the API health check, "Provision Go ecosphere companies (one-shot) and observe". It runs on the production server (VPS) with the production `DATABASE_URL`:

- The first deploy that includes it inserts the companies, with history ending at that moment.
- Every later deploy prints "already provisioned" and changes nothing.
- The read-only observer then runs. Any violation is reported as a workflow warning, so a synthetic-data finding can't fail the API deploy.
- Production's `gate_change_over_default_station` trigger creates a "Main gate" station for every new site. The provisioner reuses that station at gated sites instead of adding a second one.
- Generated logins are written to `/var/www/vndrly/.local/go-demo-accounts.json` on the server (owner `vndrly`, mode 600). They never go to CI logs or git. An admin can also reset any `go-demo-*` password from the app.

Production has no synthetic-organization flag, so the Go companies show up in admin-wide views and reports, including the 2026 1099 aggregation. They have no federal tax ID. Every Go row is identifiable by the `go-ecosphere-v1` marker or by the Go organization and user ids. Removing them would be a delete, which needs explicit approval and a scoped plan first.

## Running it

```bash
# 1. Fresh local database with the current schema (refuses non-loopback or non-empty DBs)
createdb vndrly_go_demo
cd artifacts/api-server
DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/vndrly_go_demo npx tsx scripts/push-schema-local.ts

# 2. Dry run (rolls back), then apply. GO_DEMO_NOW pins "now"; omit for the real clock.
cd ../../scripts
export GO_DEMO_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/vndrly_go_demo
npx tsx go-ecosphere/provision.ts
GO_DEMO_NOW=2026-10-18T19:30:00-05:00 npx tsx go-ecosphere/provision.ts --apply

# 3. Read-only observation report + consistency checks (exits 1 on any violation)
npx tsx go-ecosphere/observe.ts > go-observe.json
```

On apply, the provisioner writes `.local/go-demo-accounts.json` (mode 600,
gitignored): one generated password shared by all 52 Go logins, plus each login's
company, title and membership. Passwords are never committed and never touch
the canonical demo credentials.

Same seed + same `GO_DEMO_NOW` gives identical output.

To browse it, run the API against the database:

```bash
VNDRLY_ISOLATED_TEST_DB=1 WORK_HUB_ENABLED=1 PORT=8099 SESSION_SECRET=<any 32+ chars> \
DATABASE_URL=$GO_DEMO_DATABASE_URL \
AI_INTEGRATIONS_ANTHROPIC_API_KEY=placeholder AI_INTEGRATIONS_ANTHROPIC_BASE_URL=http://127.0.0.1:9 \
node scripts/run-api-local.mjs
```

`WORK_HUB_ENABLED=1` is needed because `platform_settings.work_hub_enabled` is a
global switch that is off in a fresh database. The provisioner does not change
platform settings.

## Simulation rules (30 days of history + 3 upcoming days)

**Calendar.** Local time is America/Chicago. Weekdays are busy and weekends are
skeleton crews. Day 15–21 is a busy week. Day 18 is a rain day: lease roads close,
crews stand by, half the trucks park and County Road 1200 SWD floods. Office work
lags field work, so the last week holds most of the open states.

**Field (FieldGo).**

- Crews run 1–2 jobs a day, and techs 1–3 in their specialty.
- Absences, a stuck `in_progress` ticket (tech never checked out), and two after-hours call-outs that are live at "now".
- Intake mix: partner self-service 45%, office on behalf of partner 35%, field self-service 20%.
- Outcome rates: 14% kicked back (then corrected and resubmitted), 3% denied, 4% cancelled.
- Every ticket carries status history, crew, check-ins, GPS logs, line items with TX tax, notes (some in Spanish), flags, nudges and ratings.
- `status` and `lifecycle_state` always pair per `ticket-lifecycle-coherence`.

**Hotlist.** GasGo posts 14 jobs. FieldGo and FleetGo bid, and awarded jobs become
`partner_hotlist` tickets scheduled after the crew's other work that day.

**Fleet (FleetGo).**

- Javier and Tanya dispatch runs the evening before, and drivers acknowledge, do a pre-trip inspection, log the odometer, haul and close out.
- Haul types:
  - produced water from pads and CTBs to Lone Mesa SWD #2 or County Road 1200 SWD;
  - crude from the CTBs to the Midland Crude Terminal;
  - hotshot loads from the Stanton yard.
- Edge cases:
  - reassignments 2%, cancellations 3%, review returns 4%, SWD line waits;
  - Unit 105 down with a turbo defect, and a tire defect on Unit 103;
  - Omar works nights on alternate days.
- Each run is a full `FleetRunSchema` event chain linked to a fleet billing ticket (`fleet_plan`, AFE and work date) with a `Fleet run <id>` line item.
- Route points are sampled every 30 s along a road grid, are visible only to devices with location consent, and support map replay.
- Open runs live in `vendors.fleet_ops_state`, and every version is in `assistant_action_audit`.

**Gate (GateGo).**

- Three stations, each with 12-hour day and night posts.
- The rotation respects rest (no night-then-day doubles), and has late arrivals and uncovered posts that the supervisor covers or that become open shifts.
- Duty sessions come from web, iOS and Ask V.
- One gate coverage ticket per station per day, with labor lines.
- Every FieldGo and FleetGo arrival at a gated site has a matching gate entry. Outside traffic includes vendors, inspectors, chemical and parts deliveries, denied walk-ups, pending entries at "now", auto-checkouts and never-checked-out cars.
- About 10% of walk-up entries are left unclassified, and entries made during uncovered posts are flagged `needs_review`.

**Billing.** Weekly invoices per vendor, with lines sourced from ticket line items,
ticket links, TX tax and payments. Only approved tickets are invoiced.

**Work Hub.**

- Organization, crew, gate and dispatch channels, with event-driven messages (rain day, defects, kickbacks, Spanish crew chatter).
- Tasks are driven by events:
  - office: kickback corrections, certification renewals, shop work, open posts, weekly AP and safety items;
  - foremen: pre-job safety briefings (JSAs);
  - crew hands: photo evidence on kicked-back or denied tickets;
  - drivers: weekly SWD/BOL uploads;
  - gatekeepers: badge counts.
- Also: field, driver and gate shifts; 4 recurring meetings with occurrences; 10 announcements with recipients; device preferences; notifications.
- Ask V usage across web, iOS and ChatGPT uses real assistant tool names.

**Compliance.** Certifications include one expiring H2S card, one expiring DOT medical
card and one expired security license. FieldGo's GL and FleetGo's auto liability
are close to expiry. There are 10 safety events.

## Footprint (anchor `2026-10-18T19:30-05:00`)

Main rows inserted: 579 tickets, 2,822 status history rows, 520 check-ins, 1,236 line
items, 4,256 GPS logs, 715 gate visits, 178 duty sessions, 472 shifts, 504 fleet runs
with 34,694 route points, 12 invoices with 917 lines, 656 messages, 134 tasks, 842
notifications. The full per-table list is in `.local/go-demo-report.json`.

| | Ticket statuses at "now" |
|---|---|
| FieldGo | awaiting_acceptance 12, initiated 17, in_progress 2, pending_review 12, submitted 17, kicked_back 3, approved 10, awaiting_payment 88, funds_dispersed 51, denied 10, cancelled 8 |
| FleetGo | initiated 11, submitted 10, approved 20, awaiting_payment 154, funds_dispersed 64 (runs: 483 completed, 4 dispatched, 1 in progress, 4 awaiting review, 12 cancelled) |
| GateGo | in_progress 3 (live posts), pending_review 18, awaiting_payment 47, funds_dispersed 22 |

Gate at "now": 8 vehicles on site, 3 pending admissions, 4 entries needing review,
3 active posts, 2 uncovered upcoming posts.

## Consistency checks (`observe.ts`)

The observer runs 22 checks:

- **Tickets:** status ↔ lifecycle pairing (field, gate and fleet); history ends at the current status and starts after creation; nothing recorded in the future; check-out after check-in; no worker double-booked; crew belongs to the ticket's vendor.
- **Gate:** attendant sessions never overlap; every FieldGo gated arrival has a gate entry; every gate entry was recorded by an on-duty attendant or is flagged for review; exactly one gate station per gated site.
- **Fleet:** runs have a linked ticket, a billed line and ordered events; no driver is on two runs at once; fleet plans are valid and locked to their site; route points stay inside the run window.
- **Billing:** invoice totals equal lines plus tax; only approved tickets are invoiced.
- **Work Hub and access:** message authors and task assignees are channel members; every non-admin vendor person can see at least one contracted site.
- **Isolation:** Go users belong only to Go companies.

It also prints a per-company footprint and a daily trend table: field tickets,
fleet tickets, gate entries, messages, billed USD and fleet runs.

## Workflow coverage map

| Workflow area | Data that exercises it |
|---|---|
| Partner ticket review (approve, kick back, deny, cancel) | 30 pending_review + 27 submitted GasGo tickets; kicked-back and resubmitted history |
| Vendor acceptance and intake | 12 awaiting_acceptance (partner self-service and Hotlist) and 28 initiated |
| Field execution (iOS) | Live call-outs at "now", a stuck in-progress ticket, GPS logs, check-ins, notes, Spanish speakers |
| Crew and foreman portal | Crews A and B with absences, JSA tasks, crew channels |
| Hotlist marketplace | 14 jobs (open and awarded), competing bids, converted tickets |
| Fleet dispatch and driver flow | Runs dispatched for tomorrow, an in-progress run, closeouts awaiting review, reassignments, cancellations, defects and out-of-service units |
| Fleet map replay | 34.7k consented route points across 488 started runs, with SWD waits and night runs |
| Fleet billing workflow | Batch and single-run billing tickets, AFE and work date, billed lines, finance review packet (fleet manager) |
| Gate booth and change-over | 3 stations, live posts, roster, late and uncovered posts, open shifts, pending and denied entries |
| Gate report and reconciliation | 715 visits by category, needs_review rows, unclassified entries, auto-checkouts |
| Invoicing and AP | Weekly invoices (9 sent, 3 paid), payments, awaiting_payment to funds_dispersed |
| Compliance | Expiring and expired certifications and insurance, safety events |
| Work Hub | Channels, messages, tasks, shifts, meetings, announcements, device preferences, notifications |
| Ask V / ChatGPT parity | Assistant usage rows per surface with real tool names |

## Findings from the first observation pass

The smoke test signed in as one user per role and read 63 endpoints successfully.
Behaviours worth reviewing as product questions, not data bugs:

- **Fleet billing access:** FleetGo's billing clerk (office membership, no fleet grant) gets `fleet.finance_required` on the fleet ticket plan. Only fleet managers with `financeRead`, or vendor admins, can read it.
- **Gate supervisor screens:** a gate supervisor who is a field employee gets `visit.no_access` on `/visits/gate/enabled` and `/visits/gate/ops` (office-only). Booth, roster and change-over screens work.
- **Work Hub switch:** the platform-wide `work_hub_enabled` setting has to be on for any Work Hub screen to load.

## Refresh an existing CompanyGo demo (30 + 7)

Use `scripts/go-ecosphere/refresh-30plus7.ts` for the existing GasGo/FieldGo/FleetGo/GateGo ecosystem. Do not rerun the one-shot provisioner over an occupied database.

```powershell
$env:VNDRLY_LOAD_ENV_LOCAL='1'
pnpm --filter @workspace/scripts exec tsx go-ecosphere/refresh-30plus7.ts
# After inspecting the rollback-only report:
pnpm --filter @workspace/scripts exec tsx go-ecosphere/refresh-30plus7.ts --apply
```

The window is the current Central calendar day plus its preceding 29 days, followed by seven planned days. `GO_DEMO_NOW` can freeze the window for reproducibility. Civil time handles the November DST boundary. The runner verifies the approved database and exact demo identities, serializes its transaction, snapshots affected records under `.local`, checks credentials and relationship invariants, and rolls back unless `--apply` is supplied. Reports are `.local/companygo-refresh-dry-run.json` and `.local/companygo-refresh-applied.json`.

The refresh preserves accounts, grants, existing scheduled assignments and saved records. It fills missing calendar/service dates, enriches the stable Fleet fixture labels, updates StaffGO's five fictional contacts, adds company coordination messages/meetings/tasks and a relief roster, and flags unverified manual gate entries for review. Identifiable stale fictional work sessions receive a review closeout rather than remaining on the clock indefinitely. The known four-minute synthetic late-relief overlap is corrected and marked for extended-duty review; its scheduled assignment stays intact.

Future work remains planned. The runner does not send invitations, email, SMS or calls; issue credentials; enroll or certify contractors; grant location consent; fabricate GPS/inspection/delivery proof; or represent actual payment. Older Fleet billing fixtures without physical events stay without physical-event claims. Real-world delivery and background location behavior still require device/provider testing.

Run calendar boundary tests with `node --test scripts/go-ecosphere/calendar-time.test.mjs`.
