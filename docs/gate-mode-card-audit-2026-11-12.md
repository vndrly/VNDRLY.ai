# Web Gate mode card audit — 2026-11-12

## Follow-up correction and implementation

After John authorized fixes, direct database inspection established that ticket 1870000248 was already `initiated` / `pending_arrival`, with no payment metadata or payment-audit records. G01's inference that the displayed ticket was actually paid was incorrect. The immediate root cause was an unconditional PAID label in the web card. The label now derives from saved status; terminal statuses also disable billing actions. No payment reversal or ticket database edit was necessary or performed.

The three exact synthetic tasks in G06 were cancelled in production with version checks, three task events and three maintenance audit records. Records were retained, not deleted. Live Dashboard verification showed Unassigned: 0.

Local implementation addresses G02–G10: shared scoped gate selection; explicit unavailable/stale presence errors; permission/offline movement controls; a separately labeled current-movements section outside historical report filters; company-wide billing labels; arrival review and explicit form fill followed by confirmed check-in; persisted run association; arrival paging; accurate empty-report text.

For G11, the additive `site_visits.gate_capture` column was applied. Web capture preserves raw uploaded originals and normalized/cropped derivatives. Mobile preserves full-frame captures instead of destructive pre-upload cropping. Captures and run references are validated by the server and stored with the confirmed visit, receipt time and actor. Existing private storage access and unattached-media cleanup now recognize those references. Crossing details display the photos and original links; Gate Log details can open that view. This is the evidence foundation, not a claim that future ticket proof-sheet exports, camera feeds, rig comparison or tamper-evident certification are complete.

These application changes are local and have not been deployed. The existing local API start command built successfully, but runtime database DNS failed with ENOTFOUND for the configured Supabase pooler; browser access to the local preview timed out. Both task-started preview processes were stopped. Connected database access and the live task-cleanup check succeeded. MidCon's notification hold remains unchanged.

Follow-up validation: 128 tests in eight web suites passed; 19 tests in four API suites passed; 28 focused mobile tests passed. Web and API typechecking passed after the final changes. Locale parity and whitespace checks passed. Movement capability now uses the same per-gate authorization as the write endpoint, independently of topology-administration permission. A conflicting linked-site visit rejects new evidence/run linkage instead of silently dropping it. These checks do not substitute for a successful live upload/check-in, physical iPhone camera test, or deployment verification.

The original audit below is preserved as the record of what was observed before correction.

Scope: inspect the web Gate portal before further updates. No application fixes, deployment, live check-ins/check-outs, watch changes, task changes, billing actions, or notification changes were performed. Existing local recognition and unrelated changes were preserved.

Evidence combines read-only interaction with the live MidCon Gate portal, local source review, and focused component tests. The live deployment and dirty local working tree are different versions; passing local tests do not certify the deployment. Empty live queues limit end-to-end verification.

## Findings

| ID | Priority | Card / area | Evidence and impact | Recommended disposition |
|---|---|---|---|---|
| G01 | High | Recent Tickets | Live: V-1870000248 is PAID but appears under one ticket waiting to start, with Start Ticket enabled. Source `api-server/src/services/gate-daily-billing.ts` groups solely by period/config presence, ignoring terminal ticket status. No start was submitted; server rejection or acceptance was not tested. | Fix classification and action eligibility together; cover paid, cancelled, denied and legacy tickets. |
| G02 | High | Site / Gate context | Live: Dashboard selected Cactus 152, navigation to Gate selected Precision 550, and generic Gate Log navigation selected Cactus 152. Source: Dashboard persists its own selection while Gate uses assigned default-site initialization. | Establish explicit shared selection rules, including assigned-gate restrictions. Never silently change operational context; show any required change. |
| G03 | High | On Site / secure-area traffic | Source: Gate On Site has loading and empty handling but no visits error branch. A failed initial request can appear as no active entries. GateAreaTraffic can disappear when its initial request fails; retained data can remain without a visible read-error indicator. | Distinguish loading, confirmed empty, stale and failed data. Disable unsafe actions on unavailable context and provide retry. Not reproduced by disrupting the live API. |
| G04 | High | Gate Log internal movements | Source: GateAreaTraffic receives site/gate/view/history but none of the log date range, search, record-type or pagination filters. It separately loads `/movements?siteId=...`; `history` only expands movement details. Consequently the internal-movement section does not follow the log's selected reporting filters. | Apply one reporting scope to movements and crossing rows, or label current operations separately. Verify exported and displayed records agree. |
| G05 | Medium | Secure-area action buttons | Source: normal Confirm arrival, Check out and Set destination controls only disable while busy. They do not use `canManage` or query-error state; helper controls do. The action handler silently returns offline. This is a UI capability/error-state gap, not demonstrated server authorization bypass. | Apply permission, connectivity and freshness checks consistently; show why unavailable. |
| G06 | Medium | Tasks | Live: all three unassigned tasks are named SYNTHETIC verification tasks, roughly 22–25 days old. They inflate the operational queue. | Establish explicit test-record identification and exclude/archive through an authorized cleanup. Do not delete or filter real records by guessed company/date. |
| G07 | Medium | Billing scope | Live: Cactus 152 selected while Recent Tickets displays San Roman Completions 2. Source loads company ticket inventory without selected-site filter. | Label company-wide billing clearly or follow the selected scope. This is ambiguous scope, not a proven data-access violation. |
| G08 | Medium | Fleet Arrivals | Source: production arrival cards open run details but provide no direct verified prefill/check-in handoff. Approve/Drive through UI exists only in explicitly gated development preview. Live queue was empty. | Complete the run-to-gate-entry workflow with human confirmation and run linkage. Treat camera-generated arrivals as later work. |
| G09 | Medium | Arrival capacity | Source: panel slices arrivals using `100 - pendingVisits.length`, but only warns for server truncation. Client-hidden results lack a count/page control; negative limits also have unintended slice semantics. | Clamp limits and add explicit overflow/pagination. Verify mixed pending-visitor and run queues above 100 records. |
| G10 | Low | Gate Log empty message | Live: both Current shift and 1 year show “No visits in the last 30 days.” Source uses a fixed locale string. | Describe the selected range and filters accurately. |
| G11 | Planned foundation | Vehicle photo / evidence | Local recognition work replaces/deletes unattached prior evidence when re-reading/replacing a capture. This is not immutable preservation of original photo plus derived crops. | Preserve the original and link derived images, recognition attempts and confirmed crossings before claiming audit-grade proof. Full ticket proof sheets and rig comparison remain future scope. |

Priority reflects recommended order, not a claim that every item blocks the current deployment.

## Card coverage

| Surface / cards | Observed or inspected | Remaining verification |
|---|---|---|
| Workday / Site-Gate / Shift / On Call | Live state renders; scope inconsistency G02. | Actual shift/on-call writes, assigned gatekeeper role and offline recovery. |
| Watch Radar / My Watch / On Watch / Previous Watch / Next Watch | Expansions and empty states work; schedule displayed. Radar explicitly reports notifications paused. | Assume/release watch with isolated data. |
| Tasks / task hopper | Groups render and unassigned rows expand; G06. | Assignment, assume, completion and hour totals against controlled fixtures. |
| Gate activity / On Site summary | Counts and expansions render; scoped log links include site/station/record type. | Nonempty live count reconciliation; failure-state cases. |
| Shift handoff / notes preparation | Card renders and guidance/actions are present; component tests exercised. | Save, acknowledgment, switch-user and concurrent handoff in isolated environment. |
| Administrative billing / profitability / Recent Tickets | Cards expand; profitability shows zero; G01/G07. | Invoice calculations and lifecycle transitions without financial side effects. |
| New gate entry / plate reader / vehicle photo / autocomplete | Live form renders; local review and recognition work inspected/tested previously. | Real photo benchmark, uploads, confirmed save, retries and offline behavior. No claim of OCR field accuracy. |
| Arrivals / On Site / Departures | Tabs work; appropriate empty states eventually load. Departures briefly blank during loading was not a persistent failure. G03/G08/G09. | Nonempty runs and visits, admission, checkout and reconciliation. |
| Secure-area traffic / unexpected arrival | Section renders on linked gate; source reviewed; G03/G04/G05. | Real internal movements and permission-denied/offline scenarios. |
| Gate Map / coverage / staff / equipment / activity | Four gate markers represented in accessibility state, including inactive linked gate. Staff and equipment overlays open; missing shared locations explicitly labeled. Date popover opens/closes; live clock and snapshot refresh observed. | Historical date selection results, fresh device locations, equipment coordinates and map gestures. No current live staff coordinates/equipment to validate. |
| Administrative gate creation / location editing | Form renders; incomplete Add gate disabled. | Create/move/link persistence intentionally not exercised on production. |
| Gate Log / filters / pagination / exports | Site and year filter update URL and selection; empty pagination correctly disabled. G04/G10. Export choices present. | Nonempty pagination, generated files and exact evidence/report parity. No email sent. |
| Shift Notes | All-site groups and individual expansion work; no saved notes in last 30 days. | Nonempty history, exports and cross-role access. |
| Voice / AskV / helperflows | Controls present; focused Gate voice tests included. | Physical microphone/device use and actual confirmed commands. No live voice action performed. |

## Validation

First focused batch: 26 files, 182 tests passed in 52.72 seconds. Covered billing panel, handoff, history detail, linked selector, map activity/status/staff/time controls, memory input, watch schedule, portal layout/access, notes, reporting, site selector, staffing alerts, task hopper, traffic record, watch summary, change-over, legacy gate log, gate entry and Gate voice.

Second focused batch: 8 files, 98 tests passed in 19.10 seconds. Covered secure-area traffic, arrivals, assume-watch flyout, coverage map, gate creation, current history plate display, gate locations and dashboard task calculations. Total: **34 files, 280 tests passed**.

No database tests, production writes or broad release validation were run. MidCon notification hold remains unchanged. This is an audit, not a release-readiness certification or a full role/device matrix.

## Recommended sequence

1. Fix state integrity: ticket eligibility, site/gate context, failed/stale reads and movement/report scope.
2. Fix operational clarity: permission-aware controls, synthetic queue separation, billing scope, arrival capacity and range labels.
3. Finish production capture/arrival workflows and evidence preservation; prove them with representative isolated end-to-end fixtures on web and iOS.
4. Keep camera ingestion, vehicle matching across cameras and automated arrival preloading in the future column, using the same evidence and human-confirmation contracts.
