# Gate and VehicleOCR integration plan

Date: November 12, 2026. Planning baseline: current local Gate work and John's agreed direction. This document consolidates the card audit, iOS readiness review and subsequent operating-gate versus viewing-gate clarification. It is an integration plan, not a deployment instruction or a claim of completed production readiness.

## Goal and delivery boundary

Deliver dependable Gate tools on web, iPhone and iPad first. Share business rules, APIs, validation and saved records; use appropriate native presentation and device adapters. John will choose which web panels compose each iOS page. Preserve the approved branding and useful native functionality.

Prepare the data and permission boundaries for a later operator supervising several gates, camera-generated arrivals, vehicle fingerprints and sitewide vehicle awareness. Cameras and automated barriers are not prerequisites for the first Gate release. Facial recognition and people tracking are outside this plan.

## Current baseline

| State | Work |
| --- | --- |
| Completed in production | Three identified synthetic tasks cancelled with audit history retained. Additive gate_capture field provisioned. Ticket 1870000248 verified already unpaid; no reversal performed. |
| Implemented locally; not deployed | Billing label correction, gate selection sharing, arrival review/prefill and run linkage, paging fixes, movement capability controls, photo-original preservation and visit evidence access. Shared gate traffic helpers and native API adapters added. |
| Must change next | The current persistent browsing selection does not implement the newly agreed refresh behavior. Separate operating context from browsing context before release. |
| Not yet verified end to end | Real device capture/upload/check-in, offline reconciliation, full native card integration and production behavior of these local changes. Prior local API startup hit a database DNS failure. |
| Deferred capability | Camera ingestion, remote multi-gate control, automated entry, production vehicle fingerprint matching and sitewide movement correlation. |

Existing tests are useful regression evidence, not proof of deployment, OCR accuracy or a completed physical-device workflow. Preserve unrelated working-tree changes and MidCon's notification hold.

## One location model for every card

Maintain four separate facts:

1. **Device location:** observed GPS, accuracy and observation time. It does not grant permissions.
2. **Operating context:** the site/gate the operator is authorized and assigned to operate. Watch/assignment and explicit operating choices remain server-controlled.
3. **Viewing context:** the site/gate currently being inspected, or an explicitly labeled All linked gates view.
4. **Event location:** the actual gate and site associated with a candidate, admission or crossing. Never infer it from the currently displayed tab.

| Trigger | Required behavior |
| --- | --- |
| First use, no operating context | GPS suggests an authorized nearby gate using configured boundaries and accuracy. With overlapping gates, stale/denied GPS or no unambiguous result, require selection; never silently choose the first gate. |
| Existing operating context | Load that context. A new GPS observation may explain a discrepancy but must not silently reassign a watch or change operating authority. |
| Browse another linked gate | Change viewing context only. Dashboard, Map, Log and relevant cards follow it. Show both Viewing Gate X and Operating Gate Y when different. |
| Navigate between pages or use Back | Retain the viewing context and applicable report filters. No automatic return to the first gate. |
| Change report page | Retain the exact site/gate and filter scope. Pagination cannot change operational context. |
| Choose My gate | Restore the operating context as the viewing context and reset pagination for the changed scope. |
| Browser reload / explicit workspace reset | Reset browsing to the operating context. Do not restore a previously browsed gate over it. If operating context is unavailable, use the first-use selection rules. |
| Native screen focus / app resume / background refresh | Preserve browsing; these are navigation/data-refresh events, not a workspace reset. Provide an explicit My gate/reset action. |
| Open an explicit gate/record link | Honor its authorized viewing target without changing operating context or granting write access. |
| Change account, membership or organization | Clear transient selection, drafts and incompatible caches. Revalidate access before showing or submitting scoped actions. |

Implementation: replace the single persisted selection with separate operating and transient viewing state. Use scoped memory/navigation state for browsing and server-backed operating context where available. Migrate/ignore the old browser/native browsing keys rather than treating them as operating assignments. Do not let polling or slow storage hydration overwrite a newer selection.

## Actions and evidence

**Current Gate release:** browsing another gate is read-only by default. Check-in/out and internal movement require authorization for the action's gate, valid operating context, connectivity and fresh state. Show why an action is disabled. The API must enforce the rule; hiding a button is insufficient. Voice, AskV and helperflows use the same checks and confirmation requirements.

**Later remote operation:** grant explicit remote-operate permission for a defined set of gates. Local GPS and remote authority remain separate. One operator may review five gates without acquiring authority to manage gate topology or operate unrelated sites.

Keep these records distinct: observation, arrival candidate, admission decision, confirmed crossing and visit. Approval does not itself establish that a vehicle physically crossed. Retries use stable operation IDs, concurrency checks and deterministic duplicate handling. Two operators must not create two visits from one accepted candidate.

## Delivery sequence and acceptance criteria

| Phase / work package | Deliverables | Acceptance criteria |
| --- | --- | --- |
| 1. Context and access | Separate operating/viewing state; GPS first-use resolver; My gate control; common context contract for all cards; server action checks. | Five linked gates: start at Gate 1, browse Gate 4, page its log, open Map, return Dashboard and remain on Gate 4. My gate/reload returns to Gate 1. Unauthorized Gate 4 actions fail through UI and direct API. GPS ambiguity asks for selection. |
| 2. Consistent cards and pagination | Wire every card to its declared scope; finish stale/error/offline states; normalize report queries, paging and exports. | Every card declares selected-gate, selected-site, all-linked-gates, company-wide or personal scope. Company billing remains labeled. Filters reset page; shrinking data clamps page; no silent record loss or cross-gate mixing. Exports match the selected report scope, not only the visible page. |
| 3. VehicleOCR and verified arrival | Preserve PlateOCR as a plate-reading capability within VehicleOCR; capture multiple originals/derived crops; candidate review; company/driver recall; explicit save; visit/run association. | No OCR result auto-admits a vehicle or silently replaces a confirmed driver. Uncertain plate/state and conflicting matches are shown for review. Retake/crop preserves originals. Manual entry works when recognition fails. Wrong-site associations are rejected. |
| 4. Crossing evidence and ticket linkage | Entry and exit evidence, server receipt time, device capture time, actor, gate/source and ticket/visit links; minimum ticket proof view; correction history and access rules. | Authorized vendor/partner can inspect the actual linked entry/exit proof; missing evidence reads Unknown/Not recorded, never proof of non-entry. Corrections retain the original record. Unrelated organizations cannot retrieve media. Capture retries neither duplicate nor orphan confirmed evidence. |
| 5. Web/iOS composition | Complete native adapters and missing card interactions, then map panels onto John's chosen iPhone/iPad pages; preserve native strengths. | Same account and record produce equivalent decisions/results through web and iOS. Physical iPhone/iPad camera, permissions, GPS, background/resume, voice and file sharing pass. No DOM APIs inside native business logic. |
| 6. Release qualification | Resolve local runtime issue; run representative end-to-end workflows; inspect exact release tree; publish only under the requested release scope. | Verify success, errors, duplicate submissions, concurrent operators, unavailable GPS, denied media permission and reconnect. Match live artifacts to the release commit. No claim of full ship until all required tracks, including TestFlight when applicable, pass the existing release gate. |
| 7. Camera and remote-operation pilot — later | Authenticated camera/source adapters; sitewide All arrivals queue; remote gate grants; operator confirmation and crossing correlation. | Replayed/retried observations do not duplicate arrivals. Each card shows actual source gate, time and evidence. Offline/stale feeds are visible. Remote approval remains distinct from confirmed crossing. No physical barrier control until separately integrated and tested. |
| 8. Vehicle awareness package — later | Composite vehicle profiles, entry/exit rig comparison, cross-camera vehicle correlation, partner interfaces and commercial packaging. | Measure false matches/misses on representative rigs. Changed trailers/rigging create reviewable discrepancies, not unsupported accusations. Historical vehicle profiles retain revisions and human corrections. Tenant isolation and measured cost/latency support the package. |

Phases 1–5 form the Gate product implementation backlog. Camera work does not delay shipping a reliable manually operated Gate app. A complete exportable proof-sheet package can follow the minimum ticket proof view, but basic evidence links must exist before advertising audit-ready crossings.

## Card integration coverage

| Group | Integration rule |
| --- | --- |
| Workday, watch, on-call, handoff, notes | Preserve personal/operating scope even while browsing another gate; label cross-gate records. Native acknowledgment must use actual visibility/interaction rather than copying browser observers. |
| Tasks, hopper, staffing and watch radar | Show scope and permission explicitly; preserve version checks and stable action IDs; no fabricated assignments or activity. |
| Activity, On Site, departures and internal areas | Use confirmed saved events; distinguish destination from current location and delayed observations from current presence. |
| Arrivals and VehicleOCR | Viewing a candidate is read-only. Review fills a draft; confirmed save creates/links the visit. All arrivals is an explicit authorized site/linked-site aggregate. |
| Map, staff and equipment | Share selected gate and record IDs; native map/tap/navigation adapters replace browser popups and hover. Missing GPS is not a synthetic location. |
| Billing and ticket cards | Keep company-wide versus selected-site scope visible. Status derives from the database; ticket office status and field lifecycle stay coherent. |
| Gate Log, history and exports | Stable ordering with a unique tie-breaker; identical filters for records/counts/exports; server-side cursor paging for growing datasets. Indicate a bounded/truncated result until full paging exists. |
| Camera, photos, voice, downloads and AskV | Shared commands and validation; platform adapters handle permissions, media, microphone, navigation and sharing. Native screens do not import web JSX. |

The detailed component mapping remains in gate-card-ios-readiness-2026-11-12.md; this plan supersedes its persisted-browsing description where it conflicts with the refresh rule above.

## Evidence and recognition contracts

Use private media storage for image/video bytes and database records for references and provenance. The existing gate_capture JSON field is the starting point; extend additively as needed, without discarding current evidence.

- Evidence: original and derivative relationship, media type, capture time, server receipt time, source/device/camera ID, site/gate, actor where applicable, checksum, upload status and access policy. Preserve original evidence; corrections append history.
- Recognition attempt: evidence IDs, provider/model/version, extracted attributes, confidence where supported, uncertainty, latency, outcome and human corrections. Keep predictions distinct from confirmed identity.
- Vehicle identity: plate plus jurisdiction, fleet/unit identifiers, observable vehicle/trailer attributes and versioned associations. A plate alone is not a permanent vehicle identity; a trailer can change.
- Arrival/crossing: source observation IDs, candidate ID, gate/direction, admission decision, confirmed crossing event, visit/run/ticket links, reconciliation status and stable operation ID.
- Ticket proof: linked entry/exit events and media, gaps explicitly disclosed, correction history, export generation time and access-controlled evidence delivery. No claim of legal certification from timestamps or hashes alone.

Set retention, permitted sharing and evidence export behavior before broad partner rollout. Entry/exit comparison initially supports human review; later automated comparison must include confidence and insufficient-evidence outcomes.

## Production quality gates

Benchmark recognition on a labeled, representative set covering daylight/night, glare, mud, motion, angles, jurisdictions, trailers and repeated vehicles. Compare the existing implementation with maintained candidate engines/services using measured accuracy, failure behavior, latency, cost, licensing and deployment constraints. Record a keep/fix/replace decision; do not select a replacement on a demo or add an external dependency without the project's required approval.

Acceptance targets must be set from the benchmark and operational needs before claiming production OCR quality. Track exact plate/jurisdiction accuracy, false vehicle matches, review rate, failed uploads, end-to-end latency and cost per reviewed arrival. Include timeouts, provider outages, queue backlog, deduplication, authorization, evidence integrity and recovery in operational monitoring.

Offline behavior must be explicit: retain recoverable drafts/media where supported, show pending/unsynced state, and never claim a completed crossing until the server acknowledges it. Any later offline admission policy is a separate operational decision, not an accidental consequence of a disabled network check.

## Definition of done for the first Gate benchmark

A gatekeeper can choose or confirm the operating gate, browse other authorized gates without losing context, review an arrival, correct recognition, capture evidence, explicitly check in/out, find the same evidence through Gate Log and the ticket, and hand over the watch on both web and iOS. Failures are visible and recoverable; unauthorized actions and duplicate writes are rejected. John’s iOS panel mapping is implemented, physical-device workflows pass, and the requested release tracks are verified. Future cameras can enter through the observation/candidate contracts without redefining visits, gate authority or evidence ownership.
