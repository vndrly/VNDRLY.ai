# Fleet implementation acceptance

The user approved the October 6 Fleet design for implementation on October 7, 2026. This checklist tracks the complete approved design; passing the first foundation tests does not establish complete delivery.

## Shared operating workflow

- Persist explicit Fleet Manager, Dispatcher and Driver grants; enforce current company, membership, session, fleet, site and assignment on every read and action.
- Recheck changed or revoked site relationships, driver qualifications, equipment custody, safety holds and stop-work restrictions.
- Create and dispatch an ordered multi-stop run; acknowledge as the assigned driver; record an assignment-bound inspection; start, pause and resume.
- Record two distinct hauling cycles with manifests and delivery references; preserve the event history through reassignment and corrections.
- Capture supplied fuel and meter values with source, units and capture time; distinguish them from measured telemetry.
- Submit closeout, return for correction and accept operational review without implying ticket approval or payment.
- Link the existing authorized commercial ticket; reconcile authorized Gate observations once and preserve ambiguity as an exception.
- Provide maintenance and defect repair history, explicit release authority, scoped reporting and saved views.
- Save optional planned hours without automatically ending actual duty; edit only authorized drafts with exact versions and preserved stop IDs.
- Snapshot company-configured inspection and manifest requirements onto new runs; save actual supplied responses without inventing passed checks.
- Associate actual private device photos/documents with an exact run using immutable copies, durable replay and fresh access checks. Signature images do not verify identity.
- Transfer a full undelivered load between eligible paused runs only after separate acknowledgments by both assigned drivers; preserve source manifests, count cargo once, and leave Inventory custody unchanged.
- Propose replacement equipment for a paused run and require acceptance by its assigned driver. Existing Inventory custody, current readiness, a new equipment-bound inspection and a new meter observation are required before resuming; preserve prior equipment facts and never subtract readings from different vehicles.

## Interfaces

- Web Fleet Desk, Dispatch, Run Detail and setup use the shared services and server-provided allowed actions.
- iOS My Day, My Run, inspection, load/delivery, closeout and manager views use those same services.
- Ask V and the existing single VNDRLY.ai ChatGPT plugin expose equivalents for every delivered page action.
- Embedded views show actual records, source and freshness. A prepared action or device link is never reported as a saved or physically completed action.
- Driver views avoid company-wide coworker information; partners receive only their authorized site activity.

## Recovery and verification

- Exact operation replay is durable, audited and permission-checked; conflicting reuse is refused.
- Offline storage is account/company/membership scoped and encrypted using the existing device storage. Interrupted writes preserve the previous committed generation.
- Offline submissions retain original capture time, recheck current permission/version/holds, and display conflicts rather than overwrite.
- Background driver-phone collection uses its own duty task, current consent and active assignment; stops on pause, duty end, revoked access or loss of authority. Actual iOS behavior requires device verification.
- Demonstrate a manager, a dispatcher and two fictional drivers through the complete hauling scenario, including refusal, correction and replay cases.
- Verify actual saved results separately in web, iOS and ChatGPT. Local tests, deployment and live verification are separate evidence.
- Full ship includes the guarded additive database migration, web/API, OTA, TestFlight submission and ChatGPT package/tool refresh.

## Integration boundaries

Vehicle hardware, camera media, commercial truck routing and regulated logging require supported configured integrations and actual device/provider verification. Until then, show their unavailable/setup states; never substitute synthetic observations for live proof. These boundaries do not remove the shared record workflows above from scope.


## October 18 commercial candidate

Implementation milestones A1-A3, B1-B4, C1-C3, D1-D3 and M1-M3 have software acceptance. M4 release/device/provider acceptance remains open. This is not a claim of a live release or TestFlight submission.

| Workflow | Retained acceptance |
| --- | --- |
| Company driver pool, multi-component Inventory Details, saved Origin/Destination Runs | Historical identity, current grants/holds, double-book refusal, reusable definitions and true Back behavior |
| New/shared parent ticket and office billing | Actual original-driver offline creation through closeout, exact quantity endorsement, mixed primary/supplemental charges, separate explicit finalization; financial golden packet JSON/PDF/CSV/IIF agrees |
| Retained local/canonical performed work | Original private bytes and revisions, independently proved applied prefix, cancelled/released/unbilled canonical original, one historical billing source, no redispatch or replacement reservation; original photo and office charge/finalization proof |
| Initial compliance and future partner policy | Documentary red remains warn-only; operational holds/current commercial authority remain binding; authorized future activation, exact receipt/history and current late-source enforcement verified |
| Durable web/native original storage | Native SQLite-port capacity/atomic rollback and real production-browser cold offline boot, restart/photo/lost-response reconciliation; physical iPhone SQLCipher/OS behavior remains unverified |
| Unified employee workday and calendar | One organization clock, yard/between-run time, explicit End of Day, logout distinction, current-state refresh, original-session recovery, actual assignment/calendar and office correction checks |
| Monitoring | Current source/freshness and compliance separated, one current vehicle marker, real dispatch versus acknowledgement, durable missing-recipient retry inside cooldown and one actual in-app notice |
| Ask V/ChatGPT | Trusted confirmed atomic create/dispatch, own-driver creation/action, safe original-source plan/options, office source/charge review, exact uncertain-result readback and known-refusal disposition; no driver impersonation or finance leakage |

The complete validation chain was run once; demonstrated failures received focused fixes and reruns. The final Fleet delta passed independent review after the two result-recovery corrections. The merged candidate additionally passed the locale linter, web production build and iOS export; current root typecheck results are recorded in the execution ledger. Existing remote-main Work Hub/consent changes were merged without conflicts or removal. Their immutable browser continuation is [run 39095154141](https://github.com/vndrly/VNDRLY.ai/actions/runs/39095154141); its evidence is not a substitute for the separate Fleet production-browser test.

Production commercial activation remains gated. Actual handset airplane-mode/termination/lock, push opening the exact run, consent-bound background location and approved opted-in SMS provider delivery need supported device/provider evidence. Phone observations, Mapbox driving estimates and successful enqueue do not establish truck telemetry, truck-safe routing, ELD compliance or handset receipt.

Full ship still requires the exact candidate's commit/push, web, API/additive migrations/private storage, compatible OTA, successful native TestFlight submission and existing installed plugin update with a real scoped read and harmless action/readback. Package 1.18.0 preserves the existing plugin/app identity and existing grants. Installed, submitted, approved and publicly available remain distinct states.

## October 20 role-workflow acceptance candidate

The Fleet mobile role-workflow implementation now has a focused Task 12 acceptance layer. The existing VNDRLY plugin package advertises company- and role-scoped Fleet Home, Yard Order, custody, and canonical compliance-score reads. Yard and custody writes remain explicit-confirmation actions with server-bound company, actor, membership, session, and recoverable operation identity; the original record is independently readable after completion. Existing plugin grants are unchanged and the package identity is not duplicated.

CompanyGo coverage is additive only. FleetGo capabilities use the stable `vendor_*@fleetgo.com` accounts and the unchanged `companygo` password: Admin is the independent all-capability case, Office is office-only, Dispatch is dispatch-only, and Driver composes Driver + Yard + self-dispatch for the small-shop case. Stable keys add missing Yard, Yard Order, assignment, event, custody, 30 completed history days, seven scheduled days, linked tickets, billing lines, and run snapshots with guarded inserts. Existing capability rows receive only a narrow union of missing capabilities. The fixture never deletes, resets, replaces history, or alters credentials, and replay is idempotent.

Focused automated acceptance uses an isolated test database and canonical CompanyGo logins to render Fleet on phone and iPad, verify role projections, execute persisted Yard/custody workflow transitions, recover unknown outcomes by the original operation ID, and prove module-failure isolation. Production fixture application is intentionally not performed from an environment whose database provenance is unknown. Final full-repository gates, live CompanyGo readback, physical-device verification, deployment, OTA, TestFlight, and installed-plugin verification remain release-lane evidence and must be recorded separately by the full-ship owner.
