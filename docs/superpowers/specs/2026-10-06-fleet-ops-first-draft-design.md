# VNDRLY Fleet Ops — first design draft

Status: approved for implementation by the user October 7, 2026. Implementation underway; not yet shipped or verified on devices. Prepared October 6, 2026.

## Product brief

Trucking companies should enter a Fleet Ops workspace in the existing VNDRLY web and iOS apps. Fleet Manager, Dispatcher and Driver have their own home screens and permitted actions. Ask V, its Fleet specialist Felix, and the ChatGPT plugin use the same Fleet records and services. A user can complete supported dispatch, inspection, run, evidence and review work conversationally, while device functions supply actual location, camera and navigation.

The initial operating model is oilfield hauling: fluids, bulk material and equipment, with configurable load requirements. Fleet Ops must also accommodate other trucking services without hard-coding one commodity. The draft assumes one company may operate several fleets, yards and sites, and a run may contain multiple stops and repeated load/delivery cycles.

Existing approved scope is retained: the Fleet Manager includes dispatch authority; a Dispatcher is narrower; a Driver operates only their assigned work. Fleet and ticket phases remain separate. Gate, Work Hub, inventory, people and accounting are reused rather than copied into a competing set of records.

## 1. Organization and navigation

**Recommended: a role-aware workspace in the existing apps.** The workspace selector offers Fleet Ops, Field Ops, Gate and Work Hub only when relevant and authorized. Fleet is the default home for a fleet-only worker. A manager who also drives can switch between Fleet Desk and My Day without changing company identity. Active company and workspace remain visible; switching cannot silently combine companies.

Alternatives considered: adding Fleet widgets to the current generic dashboard would be quicker but leave daily dispatch buried among irrelevant pages. A separate Fleet app would focus the experience but duplicate sign-in, Work Hub and cross-module handoffs. A dedicated workspace gives Fleet its own navigation while preserving VNDRLY's shared ecosystem.

Suggested records: Company → Fleet/yard → vehicle/trailer → driver assignment → run → ordered stops → load/delivery records → evidence → linked service ticket. Vehicles and trailers reference inventory asset identities; drivers reference existing people. A dispatcher may manage several explicitly assigned fleets. A load can move to a replacement truck with an audited custody/assignment transfer; its history is not overwritten.

| User | Default home | Primary responsibilities | Limits |
|---|---|---|---|
| Fleet Manager | Fleet Desk | Readiness, dispatch, equipment, maintenance, utilization and exceptions | Assigned fleets/sites; finance and safety release need additional authority |
| Dispatcher | Dispatch Board | Assignments, availability, routes, live runs and delay communication | Cannot clear defects, change asset ownership or access finance by default |
| Driver | My Day / My Run | Acknowledge, inspect, drive assigned runs, capture load/delivery proof and report problems | Own assignments and appropriate equipment information |
| Office / accounting | Fleet Review | Evidence completeness, tickets, manifests and authorized billing | Requires explicit operational/finance grants; office title alone is insufficient |
| Company Admin | Fleet Setup + authorized operational view | Enable Fleet, grant roles, define fleets and policies | Administration does not imply unrestricted location surveillance or financial execution |
| Site Partner | Site Activity | Authorized arrivals, loading queues, departures and relevant ETAs | Only site-relevant vendor activity, not a vendor's unrelated routes or customers |
| VNDRLY Admin | Support / administration | Authorized support and platform management | Privileged actions are explicit and audited; normal user views retain their scope |

Maintenance personnel can initially receive specific work-order and inspection permissions, rather than introducing another mandatory role. Foreman and Gate Supervisor do not automatically become Fleet Manager. Company, fleet, site, assignment, module entitlement and action permission are checked together by the server.

## 2. Web pages

The Fleet navigation replaces irrelevant Gate/Field navigation for fleet-only users. Work Hub, authorized tickets, inventory and account settings remain accessible as shared services.

| Page / proposed route | View and principal actions | Ask V context |
|---|---|---|
| Fleet Desk `/fleet` | Map; active runs; unassigned loads; readiness; delays; stale telemetry; pending reviews; service due | Today's operational brief and prioritized next actions |
| Live Map `/fleet/map` | Trucks, trailers and authorized sites; phase filters; route/ETA; selected-unit drawer; location history | “Where is Bob?”, “Show trucks inbound to this well”, “Which location is stale?” |
| Dispatch `/fleet/dispatch` | Unassigned work, eligible resources, assignment timeline and conflict explanations | Create/reassign dispatch; suggest qualified available replacements |
| Runs `/fleet/runs` | Searchable list by phase, date, driver, truck, customer and site | Locate runs; compare planned/actual progress; bulk preparation with per-record results |
| Run Detail `/fleet/runs/:id` | Driver/truck/trailer/load; stops; event timeline; ETA; evidence; linked ticket; exceptions; messages | Explain, update and perform permitted transitions on this exact run |
| Vehicles & Trailers `/fleet/equipment` | Registry, readiness, custody, documents, telemetry source, maintenance and equipment history | Add/update assets, locate equipment, explain holds and who last had an item |
| Drivers `/fleet/drivers` | Availability, assignments and relevant qualifications/expirations | Find qualified coverage; summarize the selected driver's authorized work |
| Loads & Manifests `/fleet/loads` | Orders, cargo, quantity/units, pickup/delivery requirements, weight/scale records, signatures and exceptions | Prepare load/manifest, identify missing proof, link delivery to ticket |
| Maintenance `/fleet/maintenance` | Due service, defects, inspections, work orders, downtime, parts and repair evidence | Schedule service, report/triage defects, prepare work-order updates |
| Safety & Readiness `/fleet/readiness` | Inspection exceptions, qualifications, site requirements, holds and release history | Explain dispatch blocks and prepare authorized resolution |
| Fuel & Costs `/fleet/costs` | Fuel entries, odometer/engine hours, idle data when sourced, cost per run/unit | Record supplied values and analyze authorized costs; finance-gated |
| Fleet Review `/fleet/review` | Missing evidence, completed runs awaiting review, linked ticket/billing exceptions | Assemble review packet and prepare permitted ticket decisions |
| Reports `/fleet/reports` | Utilization, dwell/detention, empty miles, on-time completion, defects and service costs | Explain measures with actual source records and create filtered reports |
| Settings `/fleet/settings` | Fleets/yards, role grants, operational profiles, thresholds, notification rules and integrations | Guide setup; prepare changes only with the corresponding administrative permission |

Messages, calendar, tasks, meetings and documents use Work Hub with Fleet context. Vehicle custody uses Inventory. Tickets use the existing lifecycle. These are linked views of the same records, not additional Fleet copies.

### Fleet Desk layout

Top: company/fleet/site filters, current duty period, last synchronization and Ask V. Below: active trucks, inbound/outbound/loading/unloading counts, unassigned work and blocked equipment. Main area: a large map on the left, selected run/vehicle drawer on the right. Bottom: attention queue and today's run list. Every count is filter-aware; overlapping conditions such as delayed and inbound do not become misleading mutually exclusive totals.

Dispatcher home emphasizes assignment availability and timing. Fleet Manager home emphasizes readiness and exceptions. Map filters can retain the user's preferred fleet/site without widening their access.

### Dispatch Board

Three working areas: **work to assign**, **eligible drivers/equipment**, **scheduled and live runs**. Dragging an assignment or asking V to move it produces the same server checks. The UI explains conflicts: unavailable driver, incompatible trailer, missing site authorization, safety hold or changed record version. Saving dispatch, notifying a driver, driver acknowledgement and physical departure are four separate events.

### Living views and wall displays

Users can save a filtered map, dispatch queue, site activity or readiness view. “Left screen: Big C inbound trucks and ETA; right screen: Gate cameras” resolves named screens from a registered workstation companion. Each screen uses its own short-lived authorized view session, shows freshness, and locks or clears on sign-out/revocation. No credentials or unrestricted dashboard URL are sent to a television. Changing a saved view is distinct from confirming that a physical screen displayed it. Camera media and desktop screen placement require working device/media integrations.

## 3. iOS pages

The same app and login adapt to role. A driver has task-sized screens with large controls and the next required step. A mobile manager can review and intervene without trying to fit the desktop dispatch board onto a phone.

| Persona | Main navigation | Principal screens |
|---|---|---|
| Driver | My Day · My Run · Messages · More | Assignments, run overview, vehicle/trailer selection, inspection, stops, load/delivery capture, exception, closeout, own history |
| Manager / Dispatcher | Fleet · Map · Dispatch · Inbox · More | Attention brief, fleet map, assignment list, run detail, resource availability, urgent reassignment, defects, maintenance and reviews |

Ask V remains available from the shared assistant launcher and context-aware voice entry. Inspection is a prominent step within My Run/My Day rather than a permanent tab containing mostly empty work. More contains equipment, documents, history, Work Hub, profile and authorized settings. A tablet uses a split map/detail view through the existing adaptive navigation shell.

**Driver My Day:** today's and next assignments, duty state, assigned equipment, unresolved defects, expiring required qualifications and unfinished sync. Starting outside scheduled hours remains permitted under company policy; schedules do not forcibly end active duty.

**My Run:** run number, truck/trailer, load, origin/destination, current phase, next stop, available route, dispatcher contact and one clear next action. Selecting a different vehicle rechecks assignment/compatibility; it does not silently rewrite earlier custody or telemetry.

**Inspection:** configuration-driven checklist for the actual truck/trailer, photos/notes and defects. Required steps and evidence are explicit. Offline inspection is marked unsynced until accepted by the server. A blocked unit cannot be made available by closing a phone dialog.

**Stop / load / delivery:** site details and instructions, arrival/departure, commodity and quantity/units, manifests, scale/receipt evidence, seal information where relevant, signature capture and exceptions. Physical proof is attributed to its source. Geofence arrival can assist timing but does not prove loading, unloading or recipient acceptance.

**Closeout:** review missing proof, actual mileage supplied by a device/user/source, fuel, post-trip defects and linked ticket; submit for review. Completed driving does not automatically approve a commercial ticket or record payment.

**Offline and driving:** cache assigned work and needed site/equipment information; visibly queue supported entries with local capture time and operation IDs. Reconcile on reconnect with permission/version checks and show conflicts rather than silently overwrite. Location collection follows active duty/trip consent; source, permission and transmission states stay visible. While moving, emphasize voice and minimal interaction; photos, detailed forms and complex edits are deferred to a stopped workflow. This is a product design requirement, not a claim that voice use is risk-free.

## 4. Run and ticket workflow

First complete workflow:

`Plan run → validate/assign → dispatch → acknowledge → inspect → start → arrive/pick up → load → travel → deliver/unload → return or next stop → close out → review → linked ticket/billing`

Run states: draft, scheduled, dispatched, acknowledged, in progress, submitted for review, completed, cancelled. An in-progress run has a stop/phase timeline: traveling to pickup, at pickup, loading, traveling to delivery, at delivery, unloading, returning, waiting, paused. Truck availability is separate: available, reserved, on run, maintenance, out of service, unknown. “Inbound/outbound” are relative to a selected site; the same truck can be outbound from one site and inbound to another.

Repeated hauling cycles stay within a run as separate loads/stops, each with identifiers and evidence. Dispatch changes preserve prior driver/vehicle assignments and acceptance. Recover an interrupted action by reading its saved outcome before preparing another submission.

Existing ticket status and GPS lifecycle axes stay authoritative. Run actions request canonical ticket transitions only when appropriate; they never write arbitrary ticket statuses. Gate arrival/departure reconciles to an authorized visit using vehicle/person/run/stop matching and operation IDs. Ambiguous matches are flagged. Gate and Fleet observers do not create duplicate visits.

## 5. Ask V and Felix coverage

V is the common interface; Felix specializes in Fleet tools and context. Calling Felix narrows relevant tools without granting more permission. Other specialists participate through explicit work steps: Inventory for equipment/custody, Safety for defects/qualifications, Work Hub for schedule/messages, Field Ops for service tickets, Finance for permitted review. A personality name is not a security boundary or a claim of an independent background executor.

Every page action has a canonical service and an assistant equivalent. The client cannot invent actor identity, fleet grants, GPS or approval evidence. Clear authorized instructions should execute under company policy without redundant confirmation; missing or ambiguous facts are clarified. Existing authenticated approval requirements and host-required controls remain in effect.

### Proposed Fleet tool contract

Names below are a draft API/tool contract, not existing available tools. Keep typed domain actions and exact arguments; avoid a generic “execute any Fleet request” tool.

| Area | Read tools | Action tools / allowed operations | Gate |
|---|---|---|---|
| Workspace | `query_fleet_capabilities`, `query_fleet_briefing` | Save personal filters/preferences | Relevant module and record scope |
| Map / unit | `query_fleet_map`, `lookup_fleet_unit`, `query_fleet_location_history`, `query_fleet_run_eta` | Configure an authorized source; record a validated source observation | Fleet/site scope; telemetry administration separate |
| Drivers | `query_fleet_drivers`, `query_fleet_driver_availability`, `query_fleet_qualifications` | Update allowed assignment/availability facts | Manager/dispatcher; own acknowledgement for driver |
| Runs | `query_fleet_runs`, `query_fleet_run_detail`, `query_fleet_run_timeline` | `manage_fleet_run`: create, edit, dispatch, reassign, cancel | Manager/dispatcher; server eligibility and revision checks |
| Own run | `query_my_fleet_assignments` | `acknowledge_fleet_assignment`; `transition_fleet_run`: start, pause, resume, permitted stop events, submit closeout | Assigned driver; no fabricated physical/location facts |
| Stops / loads | `query_fleet_loads`, `query_fleet_manifest` | `manage_fleet_stops`, `record_fleet_load`, `record_fleet_delivery`, `transfer_fleet_load` | Assigned duty or explicitly scoped operational authority |
| Equipment | `query_fleet_equipment_readiness` + shared inventory lookups | Register/update vehicle or trailer; link/unlink permitted equipment; custody via canonical Inventory | Manager / specific asset permission |
| Inspections | `query_fleet_inspections`, `query_fleet_defects` | `record_fleet_inspection`, `report_fleet_defect`, `manage_fleet_defect` | Assigned driver or authorized maintenance staff |
| Maintenance | `query_fleet_maintenance_due`, `query_fleet_work_orders` | `manage_fleet_maintenance`: plan, assign, record repair/proof, close | Manager / maintenance permission |
| Safety release | `query_fleet_holds` | `release_fleet_hold` with exact reason/evidence | Separate safety-release authority; never Dispatcher by default |
| Fuel / mileage | `query_fleet_fuel`, `query_fleet_mileage`, `query_fleet_costs` | `record_fleet_fuel`, `record_fleet_meter` with source and units | Assigned driver entry; cost visibility separately gated |
| Evidence | `query_fleet_evidence_requirements`, `query_fleet_review_packet` | Device capture/upload handoff; attach authorized existing evidence; accept/reject closeout | Actual device/source proof; reviewer authority |
| Work Hub | Shared contact, calendar, task, chat, meeting and notification tools | Contextual message/schedule/task; configure authorized escalation | Existing Work Hub authority and audience checks |
| Ticket / billing | Shared ticket, invoice and payment-status tools | Link/create eligible ticket; prepare permitted ticket review and payment-record actions | Existing ticket/finance permissions; no automatic money movement |
| Living views | `query_fleet_saved_views`, `query_authorized_displays` | Save view; send scoped view to a registered display; report observed device result | View permissions plus specific device control |
| Setup | `query_fleet_settings`, `query_fleet_integrations` | Fleet/yard/profile settings and grant administration | Company administrator; trusted persisted grants |
| Reporting | `query_fleet_utilization`, `query_fleet_dwell`, `query_fleet_exceptions` | Generate/export authorized report or schedule an authorized digest | Same record/financial scope as source data |

A tool availability manifest comes from the server for the active user and record. Fleet Manager may prepare dispatch but cannot perform a driver's inspection acknowledgement without that assignment. Safe bulk requests validate and return per-record outcomes; one failure must not be disguised as whole-batch success.

Examples: “Put Bob in Truck 12 for the next Big C load”; “Find a qualified replacement because Truck 12 is out of service”; “How long have we waited to unload?”; “Show trucks inbound to my site”; “Prepare the manifest and tell me what proof is missing”; “Create a maintenance task for this defect and notify dispatch.” V resolves exact records, explains genuine ambiguity and returns verified results.

## 6. ChatGPT Fleet integration

Keep **one VNDRLY.ai plugin**. Add Fleet skills, tool families and embedded views to the existing integration. Proposed explicit scopes: `fleet:read`, `fleet:dispatch`, `fleet:run`, `fleet:maintenance`, `fleet:admin`. Existing asset, safety, Work Hub, ticket and finance scopes still control their own records. An upgrade does not silently expand an existing account grant.

Embedded views: Fleet Desk, Fleet Map, Dispatch Board, Run Card, Vehicle/Trailer Card, Inspection/Defect Card, Manifest/Delivery Card and Review Packet. A compact card expands when the task needs more room. Conversational actions and visible controls call the same services as web/iOS. Filters, selection and refresh persist by active account; relevant live data updates only through a supported authenticated channel while the view is active. Show timestamps when host/background limits interrupt refresh.

ChatGPT can plan, read and perform authorized record actions. Background phone GPS, physical camera/scanner capture, truck diagnostics, live camera playback and operating another monitor need working device/provider components. Open a targeted device screen and return its saved result to the run. Do not make the user restart the workflow or call a prepared device link “completed.” Wake-word behavior, distinct voices and speaker identification are host-dependent enhancements, not Fleet authorization mechanisms.

## 7. Shared architecture and map rules

Use shared canonical Fleet services under a proposed `/api/fleet` family, persisted trusted Fleet grants and existing organizational membership. Web/iOS clients and Ask V/ChatGPT adapters consume those services. Reuse existing Mapbox/UI infrastructure where appropriate; no new provider is selected by this draft. New records and migrations must follow repository database safeguards.

Separate driver-phone location, vehicle telemetry, trailer tracker location and site/Gate observations. Each observation carries source identity, observed time, received time, accuracy where available and assigned entity. The map labels whose position it actually shows; a driver's phone cannot silently become proof of a truck's position. A parked/unknown/off-duty unit remains visible only to permitted users with its actual observation status.

ETAs require suitable fresh data and a valid destination. Preserve the existing stale-data refusal and make the threshold configurable through validated policy; expected update cadence is not a guarantee. Planned route and actual trace are distinct. Apple/Google links are useful navigation handoffs but do not establish truck-safe routing. Commercial restrictions need a verified routing capability.

Views/events recheck organization and grants; credentials never appear in map, camera or wall-display payloads. Revocation affects reads, mutations, streams and device sessions. Offline queues cannot override a newer assignment or safety hold. Events are idempotent and preserve both capture and accepted times.

## 8. Delivery slices and acceptance

1. **Shared Fleet foundation:** persisted grants, fleets/yards, inventory-linked vehicles/trailers, driver assignments, runs/stops and eligibility. Deny cross-company, foreign-site, unavailable equipment and invalid role actions.
2. **First complete hauling day:** web Fleet Desk/Dispatch/Run Detail plus iOS My Day/My Run/Inspection/Load/Closeout, with Work Hub and ticket links. Demonstrate one manager, one dispatcher and two drivers using fictional records.
3. **Assistant parity in the same slice:** every delivered page action has an authorized Ask V and ChatGPT tool; embedded Run Card/Map/Dispatch views. Demonstrate actual saved results and retries in all three interfaces.
4. **Readiness and management:** maintenance/defects, manifests/review, fuel/cost visibility, scoped reports and saved views.
5. **Verified integrations:** vehicle hardware, camera media, commercial routing and any regulated logging/accounting integrations, each with documented setup, costs and failure states.

Release checks include role/site denial, stale telemetry, qualification and safety refusal, double assignment, concurrent reassignment, interrupted submission, Gate/run deduplication, offline reconciliation, notification acknowledgement, revocation, full ticket linkage and actual device capture. Full ship includes web/API, additive database work, iOS OTA, TestFlight and the ChatGPT package/tool refresh with live verification.

Acceptance scenario: a dispatcher assigns a qualified driver and ready truck/trailer; the driver acknowledges, inspects, records two hauling cycles with distinct manifests and completes closeout; Gate events reconcile once; a reviewer sees the proof and linked ticket; Ask V/ChatGPT can complete the same permitted record actions. No role sees another company's fleet. A held truck cannot dispatch. Missing hardware/location/media is visibly unavailable rather than simulated as live.

## 9. Essentials, differentiators and integration boundaries

Essentials include dispatch, tracking, inspections/defects, maintenance, driver communication, documents, fuel/mileage and reports. Current fleet platforms advertise these families; VNDRLY's proposed advantage is their direct connection to site Gate activity, service-ticket evidence, Work Hub and vendor/partner permissions.

Useful differentiated views: dispatch readiness with exact blockers; load-to-Gate-to-ticket audit trail; queue/dwell/detention with sourced timestamps; a replacement suggestion that checks qualifications/equipment/site access; site-specific partner visibility; conversational saved maps and wall views. Suggestions become actions only through the user's authority and configured policy.

Do not claim an ordinary time clock is a validated ELD system. Hidden recovery trackers, consumer tag services, telematics hardware, video, route optimization and financial exports each need a supported provider/API and cost/permission review. The initial UI includes honest connection/status states, not fake operational data.

## 10. Decisions for the next revision

Draft defaults: dedicated workspace in one app; Fleet Manager includes dispatch; Dispatcher is separate; multiple stops/loads are supported; initial hauling profiles are fluids, bulk and equipment; tickets remain the commercial record. Items to settle before detailed implementation are cargo-specific mandatory manifest fields, maintenance responsibilities/release authority, desired telemetry hardware, initial billing/detention policies and which reports belong in the first pilot. These do not block reviewing the layout draft.

## Reference scan

Primary sources reviewed October 6, 2026:

- [Samsara Fleet Telematics](https://www.samsara.com/products/telematics): advertised GPS, routing/dispatch, diagnostics, maintenance, commercial navigation, fuel and compliance families.
- [Geotab Routing and Dispatching](https://www.geotab.com/fleet-management-solutions/routing-dispatching/): routing/dispatch as a shared fleet/driver workflow.
- [Geotab Drive purpose and overview](https://support.geotab.com/help/geotab-drive/about-the-app/purpose-and-overview): distinguishes driver software, telematics, ELD and fleet-management components.

The above informs the feature comparison; VNDRLY layouts, records and tool names in this document are proposed design choices.
