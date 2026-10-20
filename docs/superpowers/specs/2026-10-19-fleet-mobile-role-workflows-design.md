# Fleet Mobile Role Workflows Redesign

**Date:** 2026-10-19

**Status:** Proposed for written-spec review

**Scope:** VNDRLY iOS/mobile-web Fleet portals and the minimum shared API/data changes needed to complete their workflows

## 1. Purpose

Redesign VNDRLY Fleet so every appropriate employee can complete their work from their own portal with the fewest practical actions. The redesign closes workflow gaps for Fleet Admin, Office, Fleet Dispatch, Yard Employee, and Fleet Driver without turning a one-person company into an enterprise workflow.

The governing product rules are:

1. **Tickets must flow.** Configuration, compatibility, readiness, safety, and compliance deficiencies remain visible but do not trap dispatch, runs, or ticket completion.
2. **Complexity appears only when coordination requires it.** One authorized person performing several roles sees one next action rather than artificial departmental handoffs.
3. **Roles control authority and presentation.** Employees see only the records and actions needed for their responsibilities.
4. **Fleet must feel native to VNDRLY.** It reuses the responsive Work Hub/Gate visual language, shared card components, company branding, and established pill semantics.
5. **Failures stay local.** One unavailable Fleet module cannot blank or disable unrelated Fleet work.

## 2. Confirmed Scope

### Included

- Replace the five fragmented Fleet peer tabs with one role-aware Fleet workspace.
- Complete Fleet Admin, Office, Dispatch, Yard, and Driver workflows.
- Add Yard Orders, yard assignment and activity, asset custody/readiness, and clean cross-role handoffs.
- Make a Detail a reusable truck-plus-rigging configuration; assign drivers to runs.
- Add role-composable capabilities, including Driver + Yard and Driver Self-Dispatch.
- Support independent operators and larger multi-employee, multi-yard companies through progressive disclosure.
- Reorganize existing Fleet capabilities for runs, run orders, assets, destinations, map, maintenance, compliance, evidence, tickets, billing, and reports.
- Preserve phone and iPad responsive behavior.
- Replace compliance mechanics-first presentation with a score and guided improvement helper.
- Preserve and extend safe offline and conflict recovery.

### Explicitly unchanged

- AskV tab and AskV behavior.
- Work Hub tab and its established workflows.
- Existing ticket status and lifecycle axes remain authoritative.
- Partner hiring discretion remains authoritative; VNDRLY does not become a safety or compliance enforcement agency.

### Out of scope

- Third-party vehicle telematics, ELDs, GPS hardware, or external fleet-location providers.
- A separate small-business product or duplicate Fleet data model.
- Blocking tickets because of company, driver, vehicle, or license compliance scores.
- Rebuilding proven APIs solely to change the presentation.

## 3. Selected Architecture

Use a **role-aware Fleet workspace over the existing Fleet APIs**.

The current Fleet tab wrappers route multiple entry points into a single large `FleetWorkspace`. The redesign replaces that coupling with a Fleet shell and focused modules. Existing server capabilities are reused where their contracts already support the approved workflow. New server/data work is limited to missing orchestration: Yard Orders, custody/readiness, composable capabilities, and handoff state.

### Fleet modules

1. **Fleet Home** — role-aware priorities and next actions.
2. **Dispatch** — Details, run planning, schedules, assignments, release, and operational closeout.
3. **Yard** — Yard Orders, assigned activity, assembly, condition, and readiness reporting.
4. **Assets** — trucks, rigging, drivers, identity, current custody, condition, and history.
5. **Map** — VNDRLY-derived locations for drivers, trucks, attached rigging, Details, and runs.
6. **History** — runs, actions, evidence, custody, exceptions, and audit lineage.
7. **Compliance** — company/asset/employee scores, deductions, and guided improvement.
8. **Maintenance and Setup** — defects, service, capabilities, yards, and advisory templates.

Profile returns to identity, account, membership, and company settings. It must not duplicate primary Fleet operations.

## 4. Navigation and Responsive Design

Shared navigation remains **AskV | Fleet | Work Hub | More | Profile** on compact layouts, with the existing adaptive sidebar on iPad/tablet.

Fleet uses the actual Work Hub/Gate component family and theme tokens:

- Dotted VNDRLY background.
- Branded two-pixel card outlines.
- Shared icon, heading, helper-text, row, and spacing hierarchy.
- Company primary color applied through the existing live brand resolver.
- Established semantic colors: green active/healthy, amber pending/warning, red deficiency/destructive, grey idle, blue non-destructive action.
- Existing TogglePill/ImagePill behavior rather than hand-built substitutes.

Phone layouts stack cards in one column. iPad layouts use the clean sidebar/header and two-column card composition already established by Work Hub. The same information hierarchy is preserved across breakpoints.

## 5. Progressive Complexity

VNDRLY infers the appropriate Fleet presentation from enabled capabilities and actual company data. It does not ask the company to choose a permanent “small” or “enterprise” mode.

### Independent operator

A one-person or two-truck shop may combine Admin, Office, Dispatch, Yard, and Driver capabilities in one account. The home screen becomes **My Fleet Day** and presents:

- Next authorized job.
- Usual/suggested Detail.
- Route and return.
- Ticket state.
- Warnings.
- One primary next action.

Yard setup is optional. A business/home base may serve as the default location. A saved usual Detail can be selected automatically. Handoffs performed by the same authorized person collapse into confirmations.

### Coordinated operation

When a company adds employees, yards, assets, and separated responsibilities, VNDRLY reveals Dispatch Board, Yard Board, Active Runs, role-routed exceptions, staffing schedules, and handoff controls. Admin may also manually expose or hide eligible modules.

### Minimum Fleet onboarding

Only the following are needed to begin flowing tickets:

1. Services offered.
2. Truck or vehicle.
3. Optional rigging.
4. Home base or yard.
5. Driver/operator.

All other configuration can be completed later.

## 6. Roles and Complete Workflows

### Fleet Admin

- Configure services, home base/yards, employees, and composable capabilities.
- Manage trucks, rigging, advisory templates, maintenance, and company Fleet settings.
- View the complete operational picture, scores, exceptions, workload, and history.
- Reassign work and resolve custody discrepancies without destroying run/ticket lineage.
- Audit manual custody changes, substitutions, continuation decisions, and policy changes.

### Office

- Receive Partner-authorized work or a draft request.
- Validate site, service, rate, customer authorization, and billing references.
- Link existing authorized tickets and approve new ticket drafts.
- Receive operationally closed runs with evidence and exceptions.
- Finalize ticket review, invoicing, and payment workflow.

Dispatch may link an existing authorized ticket or create a new ticket draft. Office/Admin retains approval of rates, commercial details, and work without prior Partner authorization.

### Fleet Dispatch

- View available drivers, trucks, rigging, Details, yards, schedules, and conflicts together.
- Choose authorized work or create an Office-review ticket draft.
- Build a run from route, schedule, Detail request/reservation, stops, return, and ticket.
- Plan a run while a Detail is still being assembled; it remains **Waiting on Yard**.
- Assign/reassign the driver and Detail while preserving the run and ticket.
- Release ready work to the driver.
- Perform operational closeout: stops completed, Detail returned/transferred, and exceptions recorded.
- Send a clean closeout to Office for commercial finalization.

### Yard Employee

- See assigned Yard Orders, priorities, schedule, and personal activity history.
- Intake newly received trucks or rigging with identity, location, and condition; Admin reviews company-level records afterward.
- Locate and assemble the requested truck and rigging.
- Record missing, damaged, substituted, or unavailable components.
- Complete advisory inspections and report **Ready**, **Needs Attention**, or **Unable to Complete**.
- Detach, transfer, and return components with custody history.
- Notify Dispatch when the Detail is ready or requires a decision.

### Fleet Driver

- See shift state, current/next run, Detail readiness/location, ticket state, and the next operational action.
- Accept an assignment and perform ordered stops.
- Record arrival, departure, evidence, delay, exception, custody, detach/transfer, and defects.
- Continue safely during poor connectivity with visible retained work.
- Self-check a returned Detail into the yard and complete the run; Yard verification becomes a follow-up and cannot hold the run or ticket open.
- See only the driver’s own Detail and assigned route.

A Driver may also receive Yard capability. With **Driver Self-Dispatch**, that employee may complete the Yard Order, mark the Detail ready, select an authorized existing ticket or request a new Office-review draft, and start the run.

## 7. Authorization and Visibility

Capabilities are additive rather than mutually exclusive.

- **Fleet Admin:** full company Fleet visibility and configuration.
- **Office:** commercial/ticket state and operational locations, but not continuous employee tracking.
- **Dispatch:** live Fleet Map and resource/assignment controls.
- **Yard:** assigned Yard work and assets expected at authorized yards.
- **Driver:** own Detail, assigned route, and permitted Yard/Self-Dispatch actions.

Alerts route by responsibility:

- Yard issues to assigned Yard employees.
- Resource/schedule conflicts to Dispatch.
- Authorization/billing issues to Office.
- Operational exceptions to the Driver and Dispatch.
- Unresolved or severe items to Admin.

Fleet staffing uses the existing Work Hub calendar and shift system. Admin/Dispatch manage schedules; employees report availability, request time off, start/end shifts, and see their own assignments.

## 8. Asset, Yard Order, Detail, and Run Models

### Asset custody lifecycle

`intake → at_yard → reserved → attached → in_transit → returned | transferred`

Maintenance, inspection, compliance, condition, compatibility, and stale-location findings are advisory overlays. They do not replace custody state.

Companies may have multiple yards. “At yard” may be verified through a VNDRLY gate scan, VNDRLY GPS/geofence check-in, or an authorized manual check-in. VNDRLY records the method, employee, timestamp, and location.

Truck location comes from the VNDRLY driver app. Attached rigging inherits the truck/Detail location until VNDRLY records detachment, transfer, or return. No third-party telematics is included.

### Yard Order lifecycle

`requested → assigned → in_progress → reported`

Reported result is one of:

- `ready`
- `needs_attention`
- `unable_to_complete`

The result informs Dispatch but does not itself block continuation. Dispatch may choose substitution, delay, or authorized continuation. The order retains assignments, timestamps, substitutions, condition findings, notes, and completion history.

Requesting a Detail may generate an editable Yard Order from an advisory rig template, suggest available Yard employees, schedule the activity in Work Hub, and notify Dispatch on report.

### Detail lifecycle

`building → ready → reserved → dispatched → returned | transferred → dissolved`

A Detail is a reusable **truck + rigging** configuration. A driver is assigned to the Run, not permanently to the Detail.

Rig templates may describe required, optional, and compatible substitute components, capacity guidance, and inspection recommendations. These rules begin as advisory. Missing configuration, incomplete adoption, or shop-specific practices never prevent ticket flow.

### Run lifecycle

Planning:

`draft → waiting_on_yard → ready_to_dispatch`

Operation:

`released → driver_acknowledged → started → stops_in_progress → returning → driver_submitted → dispatch_reviewed → office_finalized`

These Fleet orchestration states map to, rather than replace, the existing canonical ticket `status` and GPS `lifecycleState` axes.

The default route is `yard/home base → job site → return yard/home base`. Multiple ordered pickup, delivery, service, fuel, inspection, and return stops are supported. Frequently repeated routes can be saved as templates.

## 9. Ticket Continuity

An existing authorized ticket stays linked through Yard preparation, Detail substitution, driver reassignment, route execution, return, operational closeout, and Office finalization.

New work without prior Partner authorization is a non-billable Office-review draft. A Driver or Dispatcher cannot independently create unauthorized billable work.

Reassignment, substitution, readiness warnings, and return verification must never discard or recreate the ticket. The audit chain remains:

`Partner authorization → ticket → run → Detail → driver actions/evidence → Dispatch closeout → Office billing`

## 10. Compliance and Safety Helper

Fleet Compliance is presented as a transparent score and guided improvement workflow, not a configuration-first register or routine retry screen.

The card provides:

- Company score and red/amber/green status.
- Vehicle, driver license, insurance, and company-record categories.
- The reason for every deduction.
- Issues ranked by urgency and estimated score improvement.
- Exact remediation steps, evidence/upload destination, responsible role, and due date.
- Score history and improvement progress.
- A preview of what Partners see.

Partners use the score, dots, records, deficiencies, ratings, rates, and other evidence when deciding whom to hire and what policy they enforce. VNDRLY informs that decision but does not enforce it by blocking company operations.

A genuine service outage has a separate unavailable/retry state. A low score or expired record is never described as a technical failure.

## 11. Failure Isolation and Recovery

Each Fleet card/module owns its loading, populated, empty, warning, error, and retry state. Compliance failure cannot disable Dispatch; Map failure cannot stop a driver; billing unavailability cannot stop run submission.

For conflicts such as HTTP 409, the affected record presents a scoped recovery card:

- Explain what changed.
- Load the current canonical record.
- Show whether the user’s work was retained.
- Offer safe review/reapply/continue actions.

Every mutation uses a unique operation identity and canonical readback. Unknown outcomes are read before retrying to prevent duplicates. Retained actions are scoped to the same user, membership, company, and operation; account/context changes invalidate unsafe retained work.

Errors must name the affected record and safe next action. The interface must not claim success when canonical completion is unverified.

## 12. Offline Behavior

Driver and Yard actions that are safe to retain locally show an explicit **Pending Sync** state. The app records the exact operation, evidence references, actor scope, and capture time. Synchronization reconciles against the canonical server record and preserves idempotency.

Operational work may continue when the relevant offline contract permits it. Commercial authorization, permission expansion, and unverified cross-company changes remain server-authoritative.

## 13. Data and API Direction

Implementation should reuse existing Fleet routes and schemas for assets, rig packages, Details, run orders, runs/actions, destinations, maps, driver availability/workdays, maintenance, compliance, reports, evidence, tickets/finalization, replacements, transfers, and gate links.

New persistence must be additive and narrowly scoped. Expected additions include:

- Yard definitions/home-base designation where existing locations cannot represent the requirement.
- Yard Orders, assignments, reported outcomes, and audit events.
- Explicit asset custody/location observations and Detail attachment history where existing records are insufficient.
- Composable Fleet capability assignments.
- Readiness/handoff projections derived from canonical records.

No destructive migration, table replacement, or duplicated ticket state machine is permitted. Exact schemas and endpoints belong in the implementation plan after the written design is approved.

## 14. Testing and Acceptance

Acceptance requires complete workflows, not merely rendered screens.

### Required workflow scenarios

1. Independent operator: accept authorized work → confirm/supply Detail → start run → complete stops → return/self-check-in → operational closeout → billing.
2. Team handoff: Office → Dispatch → Yard → Driver → Dispatch → Office.
3. Multi-yard asset intake, reservation, assembly, dispatch, return, and custody transfer.
4. Driver with and without Yard and Self-Dispatch capabilities.
5. Existing authorized ticket and new Office-review draft.
6. Clean run and run with substitutions, warnings, defects, delays, and return discrepancy.
7. Online, offline, unknown outcome, retry, HTTP conflict, reassignment, stale location, and partial module outage.
8. Advisory compliance score changes without ticket blockage.
9. Role isolation and company/membership switching.

### Required surfaces and gates

- Phone and iPad responsive layouts.
- English/Spanish parity.
- Accessibility labels, ordering, contrast, and touch targets.
- Mobile component/flow tests.
- API authorization, idempotency, and database-backed workflow tests.
- Additive migration first-apply and replay verification.
- Browser end-to-end workflows using FleetGo and the established synthetic Partner/Vendor companies.
- Existing repository validation gates.
- Final verified web, API, production data migration, iOS OTA, TestFlight, and ChatGPT VNDRLY plugin release tracks when implementation is shipped.

## 15. Success Criteria

The redesign is successful when:

- Every defined employee role completes its appropriate workflow from its own portal.
- A one-person operation completes the full Fleet lifecycle without configuring artificial departments.
- Larger companies receive explicit ownership and handoffs without duplicated data entry.
- The usual prepared independent run requires only the smallest practical confirmation sequence.
- No isolated module error disables unrelated Fleet work.
- Assets, rigging, Details, drivers, runs, tickets, evidence, custody, and billing remain traceable end to end.
- Compliance and safety information improves marketplace transparency without VNDRLY blocking tickets.
- Fleet, Gate, and Work Hub visibly operate as one branded VNDRLY product.
