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
