# Fleet Commercial Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver robust ticketed Fleet work across web, iOS and the existing plugin, with reusable Details, physical locations, full offline capture/reconciliation, warn-only compliance and exact commercial billing.

**Architecture:** Extend canonical Inventory/people/tickets and the existing Fleet transaction, audit, evidence, notification and private-storage services. Introduce explicit resource/location, offline-work, compliance and pricing contracts with independent ownership; canonical server records and durable device records remain distinguishable. Preserve legacy APIs and historical records, exposing new behavior only after the complete vertical workflow passes acceptance.

**Tech Stack:** Existing pnpm/TypeScript/Zod/Express/PostgreSQL/React/Expo stack; existing expo-sqlite SQLCipher, SecureStore and FileSystem for native durability; browser IndexedDB/Web Crypto for provisioned browser operation. No new dependency or provider purchase is part of this plan.

**Spec:** [Approved operating scope and research](../../fleet-operations-scope-ok-tx-2026-10-16.md), especially the user-confirmed policy, sections 6–10 and 14–16. This is the master plan; the four linked subplans are one coordinated delivery.

## Global Constraints

- Initial jurisdictions: **Oklahoma and Texas**, plus applicable federal rules. Regulations are effective-dated; no claim of all-state compliance.
- **“commercial tickets must keep flowing, including offline and through intermittent connections.”** Missing connectivity, missing rate or document-compliance red status cannot erase or prevent truthful local work capture.
- Initial compliance policy is **`warn_only`**. Truck, every rig component and driver have green/red assessments; partner run/ticket history preserves the applicable exceptions. Future **`enforced`** policy requires explicit scoped activation/effective dates; never activate it as a migration default.
- Actual do-not-operate/stop-work holds remain separate and authoritative. Company/site/service authority, current authentication, custody, resource conflicts, billing integrity and privacy are not weakened by warning mode.
- Every run chooses a **new ticket** or **eligible existing ticket**. Offline local references are not server ticket numbers. Drivers close runs; office reviews and explicitly finalizes/submits the ticket.
- Preserve canonical Inventory IDs, custody and ownership, legacy `fleetIds` authorization groups, existing routes/pages and historical run/ticket/rate semantics. A true Detail is a separate identity; reservation release does not dismantle it.
- Drivers may record own unplanned work in authorized company/customer scope, flagged for office review. This does not grant broad dispatch, coworker data, finance access or authority to a new customer.
- Physical origin/destination/return and authorized billing site/partner/AFE are separate. Selecting a location never grants commercial access.
- Rates come from current authorized service agreements/catalog approvals. No invented production price, silent conversion, implicit financial approval or retired catalog-publish workflow.
- All money/quantity calculations in the new path use decimal strings/exact arithmetic. New and legacy totals must reconcile across tickets, invoices, reports, exports and partner views.
- Native and web capture use a durable journal first when enabled, whether connected or disconnected. One conflicted run cannot stop unrelated work or further local observations.
- Private medical/testing/license documents never enter operational run evidence, general audit/notification bodies, partner snapshots or assistant output. Partner disclosures use an allowlisted summary.
- Use existing branded gray/light-lettered cards, 2px company-color borders, branded controls and true-history Back behavior; read `docs/agent-doctrines.md` before adding pills. Update EN/ES together.
- Server migrations are guarded **`ALTER TABLE ... ADD COLUMN IF NOT EXISTS` only**; preserve old columns/rows and audit history. No new table/index DDL, destructive reset, schema push, restore-over-live or credential rotation.
- Database tests use only a newly provisioned, retained loopback test DB via `fresh-local`; inherited dev/production URLs are never test targets.
- External ELD/truck routing/hardware capabilities remain explicitly unavailable until a supported configured integration and actual acceptance evidence exist. The core flow must not depend on selecting a new provider.
- Planning changes documentation only. Implementation/release claims require their own verification. Full ship follows all eight standing release tracks, including successful TestFlight submission and the existing plugin update/live verification.

## Review Focus

**Binding October 16 clarification:** company drivers belong to an available pool, drivers join reusable Details, and dispatch matches a Detail to a saved Run (an Origin/Destination transport order). Each performance is a separately recorded, ticket-bound activity; repeat activities can share an eligible open ticket. Preserve canonical execution IDs/history. A owns saved Run definition revisions and company driver-pool access without driver-to-site assignment; B imports those exact references for offline capture; D prices/reviews each activity; M supplies the same vocabulary and workflow across web/native/Ask V/ChatGPT. Customer/billing authority remains with the company and authorized dispatcher, not a prerequisite site assignment on each driver.

1. **RF1: server commits while the phone loses the response** — exact replay returns the same ticket/run/charge, and another run keeps synchronizing (B2/B3).
2. **RF2: insurance expiry changes an approved relationship to `auto_unapproved`** — a proven compliance-only lapse warns without losing Fleet access; explicit commercial revocation still denies (C2).
3. **RF3: one dolly/pump appears in two packages and a prior job overruns** — all canonical components stay reserved; apparent package availability cannot double-book them (A2).
4. **RF4: sub-cent rate and high-precision quantity reach different financial readers** — one reviewed total across ticket, invoice, tax, dashboard and export; no four-decimal truncation (D1/D3).
5. **RF5: sign-out/company change with unsynced photos** — original-scope work survives locked, a new account cannot see/post it, and authorized recovery is audited (B3/B4).

## Read this before execution

Workspace for this plan: `C:/Users/JohnElerick/.codex/worktrees/vndrly-ios-web-preview`. The primary checkout has unrelated work; do not reset, stage or clean it. Confirm the current branch/tree and any newly attached worktrees at execution start. All paths below are repository-relative; proposed files do not exist yet unless stated otherwise. Do not edit generated API files directly.

Existing foundations: Fleet services and schema are handwritten; generic catalog/ticket clients are generated from `lib/api-spec/openapi.yaml`. Current native offline queue supports only existing assigned runs, 64 actions/64KB; photo staging uses evictable cache and one pending item. Existing SQLCipher is available. Current prices/quantities use limited precision and several readers multiply legacy numeric columns. Existing UI “Details” is still legacy group setup. These are implementation gaps, not new subsystems to invent blindly.

## Subplans and contract ownership

| Plan | Tasks | Owns shared contracts and behavior |
| --- | --- | --- |
| [A — Resources and locations](2026-10-16-fleet-resources-locations.md) | A1–A3 | `fleet-details.ts`: Detail/package/snapshot/reservation; existing `fleet-commercial.ts` plus `fleet-route.ts`: physical locations/routes |
| [C — Compliance and authority](2026-10-16-fleet-compliance-authority.md) | C1–C3 | `fleet-compliance.ts`: requirements/evidence/assessment/sanitized snapshots/policy; narrow Fleet commercial authority |
| [D — Commercial pricing](2026-10-16-fleet-commercial-pricing.md) | D1–D3 | `fleet-pricing.ts`: exact pricing intent, rate authority, charge/quantity/ticket-v2 contracts; one effective financial-line adapter |
| [B — Offline work](2026-10-16-fleet-offline-work.md) | B1–B4 | `fleet-work.ts`: strict command/receipt/reference graph; shared journal ports/scheduler, server intake, native/browser persistence and recovery |
| This master | M1–M4 | Driver/office experience, notices/map triggers, full assistant/plugin parity, whole-release acceptance |

All shared contracts export from `lib/api-zod/src/index.ts`. A/C/D own their snapshots; B imports them instead of declaring duplicate partial interfaces or `unknown` payloads. Web/native/plugin import the same schemas. Share exact function/type changes between task owners before dependent work starts.

### Scope coverage

| User requirement | Owning delivery and proof |
| --- | --- |
| State/DOT, insurance, drivers and licensing; initial warning mode | C1–C3; sourced rule fixtures, private registers, green/red member assessments and scoped partner history |
| Truck + multi-component rig + driver Detail; Inventory remains canonical | A1–A3; concurrent component reservations, Inventory/custody unchanged, reusable revision history |
| Origins/Destinations, optional base return and dispatch dropdowns | A3/M1; physical/billing separation, repeat cycles and selected return policy |
| Every run new/shared ticket; office reviews and explicitly submits | D2/B2/M1; ticket compatibility, driver closeout, reviewed charges and explicit finalization |
| Offline new work, photos, restart and automatic reconciliation | B1–B4; multi-day persistence, lost-response replay, independent conflicts and original-scope recovery |
| Assignment app/push/SMS, condition pictures, start/close and notes | B2/B3/M1/M2; equipment-bound evidence, delivery receipts and real device/provider acceptance |
| In-progress map, source-qualified speed/ETA and editable triggers | M2; freshness/source states, one current marker and unavailable specialist capabilities stated honestly |
| Expanded commercial work, rate cards, quantities and batch billing | D1–D3; exact golden financial packet, approved-rate history, explicit surcharge/minimum/detention treatment |
| Branded UI, all working pages retained, web/iOS/plugin parity | A3/M1/M3; screenshot/navigation checks, permission/action matrix and installed-plugin live verification |
| Safe main-site release, production data preserved, TestFlight | M4; additive migrations, all mandatory gates, all eight release tracks and dated evidence |

No new business decision is needed to start after plan review. Provider purchases/credentials, actual carrier-specific enforcement activation and unavailable physical-device access are explicit later boundaries; they must not stop implementation of the approved core or be misreported as complete.

### Storage decisions

Use additive versioned JSONB columns on existing `vendors` for the current resource registry and compliance configuration; existing `assets` and `vendor_people` for private structured metadata; `partner_vendor_relationships` for provable Fleet authority/policy metadata; and current ticket/line/approval records for precision and billing metadata. Immutable revisions, mappings, resolution commands and operation receipts use existing scoped `assistant_action_audit` records with explicit target types. Do not copy private raw documents/results into audit JSON. Private files use existing storage primitives and separate authorization.

Resource changes and reservations serialize through the current vendor transaction and stable canonical asset row locks. Audit/history reads must be paginated and query by company/target; do not load an unbounded audit log or grow the current-state JSON forever. New bounded pages return `nextCursor`/truncation explicitly; reaching a presentation bound must not discard persisted work.

### Dependency order and activation

1. A1, C1 and D1 establish compatible strict contracts and migrations; do not enable new UI work yet.
2. A2/A3, C2/C3 and D2/D3 implement the authoritative resource, warning and financial paths. Preserve v1 behavior through explicit version adapters.
3. B1 consumes those contracts; B2–B4 deliver server reconciliation and native/browser journals. Connected v2 mutations use the same command path as offline replay.
4. M1–M3 complete stage-based screens, notifications/map/trigger behavior and assistant/plugin parity.
5. M4 verifies the entire synthetic workflow and releases it. Core offline ticket creation, warn-only behavior and partner disclosure are one activation gate; do not ship a screen claiming these before the server/device path works.

No automatic production enforcement activation or automatic enablement of vendor work-type templates. New providers, regulator API credentials or commercial routing subscriptions require a separate concrete decision; implement an honest unavailable adapter until then.

### Safe verification commands

Before any API/root/E2E test, set `$env:VNDRLY_TEST_DB_MODE='fresh-local'` and `$env:VNDRLY_LOAD_ENV_LOCAL='0'`; obtain the existing local maintenance URL without printing its credentials. Fail preflight unless `[uri]$env:VNDRLY_TEST_DB_MAINTENANCE_URL` has host `127.0.0.1`, a nonempty user and path `/postgres`. The wrapper provisions a unique retained test DB. Never use `test:no-isolated-db` or the legacy default schema-reset path. Start only an existing approved local cluster; do not introduce a shared DB fallback.

Pure contracts/calculators/UI tests use the exact package commands in each task. Database task command shape from `artifacts/api-server` is `pnpm exec tsx scripts/run-with-test-db.ts -- corepack pnpm exec vitest run <named tests> --no-file-parallelism`; run with the safe environment above. All examples below assume that preflight, including tests that happen not to query today.

## Master implementation tasks

### M1: Stage-driven web/iOS work and office reconciliation

**Files:** modify `artifacts/vndrly/src/pages/fleet.tsx`, `components/fleet-billing.tsx`, `components/fleet-review-packet.tsx`, `lib/fleet-client.ts`, `components/layout.tsx`, `App.tsx`; native `components/FleetWorkspace.tsx`, `FleetRunAction.tsx`, `FleetRunBilling.tsx`, `FleetReviewPacket.tsx`, `FleetTicketFinalization.tsx`, `lib/fleet-mobile.ts`, `lib/app-navigation.ts`, `app/(tabs)/_layout.tsx`; create matching `fleet-work-status.tsx`, `FleetWorkStatus.tsx`, `fleet-reconciliation.tsx`, `FleetReconciliation.tsx` plus tests. Update both locale pairs.

**Interfaces:** consumes A Detail/route snapshots, B `FleetWorkJournal`/receipts/reconciliation commands, C partner/public assessments and D pricing views. Produces `FleetWorkStatus({localRunId, journal})`, `FleetReconciliation({cases, onResolve})` and web/native-equivalent status models from B; no client decides canonical authority.

- [ ] **Step 1 — tests:** add screen tests `offline_driver_create_to_close_keeps_ticket_reference`, `one_conflict_does_not_disable_new_capture`, `red_members_remain_selectable_in_warn_only`, `office_review_then_explicit_ticket_submit`, `return_policy_controls_release` and `back_uses_actual_origin`. Assert local save is never labeled partner-submitted and driver UI never reveals rates without finance authority.
- [ ] **Step 2 — red verification:** run web `pnpm --filter @workspace/vndrly exec vitest run src/pages/fleet.test.tsx src/components/fleet-reconciliation.test.tsx` and native `pnpm --filter @workspace/vndrly-mobile exec vitest run components/FleetWorkspace.test.tsx components/FleetReconciliation.test.tsx`; new behaviors fail before wiring.
- [ ] **Step 3 — implementation:** wire one primary driver action per stage, allow own unplanned work, show prior damage per component and capture inspection/closeout photo evidence through B. Add office reason-specific reconciliation with immutable originals; keep pricing unresolved visible without blocking field capture. Retain existing pages; place true Details beside canonical Inventory, separate legacy permissions/settings, add Origins and Destinations and true Back controls.
- [ ] **Step 4 — green verification:** rerun named tests, existing Inventory/directory/run-action/billing/finalization tests and `pnpm lint:i18n`. Inspect narrow mobile and desktop layouts; save actual browser screenshots. Physical iPhone acceptance is M4, not inferred from jsdom.
- [ ] **Step 5 — commit:** stage only this task's client/locale/test files and commit `feat(fleet): connect offline Detail runs and office reconciliation`.

### M2: Dependable notices, sourced monitoring and useful triggers

**Files:** modify `services/fleet-notifications.ts`, `services/notification-delivery.ts`, `routes/notifications.ts`, `lib/communications-health.ts`, `services/fleet-location.ts`, `fleet-eta.ts`, `lib/api-zod/src/fleet-location.ts`, `fleet-eta.ts`, web `components/fleet-operations-map.tsx`, native `components/FleetMapOverview.tsx`, `lib/fleet-background-location.ts`, `fleet-background-location-native.ts`, `fleet-push-notification.ts`; create shared `fleet-monitoring.ts`, server `services/fleet-monitoring.ts`, web/native monitoring controls and matching tests. Paths beginning `services/`, `routes/` or `lib/communications-health.ts` here are under `artifacts/api-server/src`.

**Interfaces:** shared `FleetLocationObservation` gains optional nullable `speedMetersPerSecond`, `speedAccuracyMetersPerSecond`, `headingDegrees` and source-qualified telemetry; legacy parsing remains valid. `FleetTriggerRule` defines scope, kind (`no_ack`, `stale_position`, `dwell`, `late_eta`, `credential_due`), threshold, recipients, cooldown and version. `evaluateFleetTriggers(context, rules, now): FleetTriggerEvent[]` is pure. `readFleetAssignmentDelivery(actor, runId): Promise<FleetAssignmentDelivery>` distinguishes committed/enqueued/provider-accepted/delivered/opened/acknowledged/failed, without equating APNs acceptance with handset delivery.

- [ ] **Step 1 — tests:** assert `expect(evaluateFleetTriggers(staleContext,rules,now)).toHaveLength(1)` across repeated evaluation within cooldown; stale speed renders unavailable, offline backlog stays historical, no notification appears before server commit, and expired relationship compliance does not suppress a permitted notice. Unknown provider readiness must not claim delivery.
- [ ] **Step 2 — red verification:** run API `src/services/fleet-notifications.test.ts src/services/notification-delivery.test.ts src/services/fleet-location.test.ts src/services/fleet-monitoring.test.ts` through the wrapper; native `lib/fleet-background-location.test.ts lib/fleet-push-notification.test.ts`; web `src/components/fleet-operations-map.test.tsx`.
- [ ] **Step 3 — implementation:** use existing deduplication/retry/consent/quiet-hours paths, record recoverable notice outcomes, add unacknowledged assignment attention queue, and keep SMS opted-in/production-readiness-gated. Map one current marker per power unit/Detail with selected history, source/time/accuracy/speed and origin/drop/base. Use C red/green compliance separately from location freshness. Persist triggers in vendor configuration and events/receipts in existing audit; no fake missing data, auto-delivery or auto-finalization.
- [ ] **Step 4 — green verification:** rerun above and native wrapper tests; simulate provider rejection, token expiry, delayed receipt, no consent, dwell and cooldown. Truck-routing/ELD/hardware ports report unavailable until configured; do not label current Mapbox driving ETA truck-safe. Speed/route safety alarms remain disabled without qualified source/limits. Verify real push/SMS and background collection only under M4's authorized device/provider acceptance.
- [ ] **Step 5 — commit:** commit only named monitoring/notification/client/schema/locale/test files as `feat(fleet): add delivery visibility and sourced run monitoring`.

### M3: Typed/realtime Ask V and installed plugin parity

**Files:** modify API `assistant/fleet-tools.ts`, `tool-registry.ts`, `tool-names.ts`, `work-hub-tool-runtime.ts`, `chatgpt-write-capabilities.ts`, `chatgpt-action-panel.ts`, `chatgpt-fleet-consent.ts` and existing Fleet recovery helpers; add focused `fleet-details-tools.ts`, `fleet-compliance-tools.ts`, `fleet-work-tools.ts`, `fleet-pricing-tools.ts` and tests; update `integrations/chatgpt-plugin/{plugin.json,RELEASE.md}`, its hidden manifests/MCP config, fleet/inventory skills/references and relevant embedded views. Use the actual current package/version/IDs when executing, not this plan's historical release values.

**Interfaces:** map the exact A–D service commands/reads to permission-scoped tools. Prepared writes reuse trusted server confirmation bindings, stable `operationId`, current actor and independent canonical readback. Never accept actor identity, authority, compliance verification or a completed physical inspection merely because the model supplies it.

**Approved conversational assignment requirement:** support typed/voice requests such as “Hey V, have Bob Villa start a run as a new ticket, dump crude, in truck/rig X.” Resolve the authorized person and saved Detail by name/unit aliases, material/service and explicit new-ticket intent from current scoped records. Reuse clearly applicable saved route/billing defaults; ask only for genuinely missing or ambiguous origin, destination, billing site/AFE, work date or resource identity. Present the resolved assignment through the existing trusted confirmation flow, atomically create the linked ticket/run, dispatch, then read back real ticket/run IDs and notification outcome. Do not treat the dispatcher's words as Bob's acknowledgement, inspection or physical start. Test spoken variants, corrected names, multiple Bobs, invalid/replaced Details, unknown results and red warn-only resources. Carry assignment context safely between turns without guessing a commercial relationship, inspection evidence or rate. Ask V and ChatGPT must cover every permissible workflow action through the same server services, not merely explain which page the user must open.

If Bob differs from a saved Detail's usual driver, prepare an explicitly described run-specific Detail/assignment from the canonical rig components; do not silently change unrelated future assignments or overwrite a reusable Detail permanently. Do not invent load quantities or a legal cargo classification from “crude.” A saved default must match the actual authorized customer/service context; another recent customer's site or AFE is not a default. Missing actual pickup measurements can wait for driver execution without blocking dispatch preparation. Include these cases in the conversational assignment tests.

- [ ] **Step 1 — tests:** tool coverage matrix includes Detail/package CRUD/history/reservations, location CRUD/routes, own-work create/reconciliation status, red reason/history/private reviewer evidence, policy preview/activation, rate-card/charge review and explicit finalization. Assert `new Set(deliveredActions).difference(new Set(toolActions)).size === 0` using supported test-runtime set logic, with separate denied-role/private-data/uncertain-result cases.
- [ ] **Step 2 — red verification:** run assistant Fleet wiring/recovery/consent/toolbox tests through safe wrapper; add strict decimal-string and finalization tests. Confirm missing tools/schema paths fail before implementation.
- [ ] **Step 3 — implementation:** use the same server authority/policy/pricing services; add focused tools rather than a permissive generic JSON executor. Scope new consents explicitly and preserve existing linked grants. Show a clear device link for photos/offline work. Plugin cannot execute offline, read unsynced device work, manufacture acknowledgement or disclose medical/testing data. On unknown outcomes look up receipts and canonical results before a retry.
- [ ] **Step 4 — green verification:** rerun the coverage matrix and package checker `node scripts/src/check-chatgpt-plugin-package.mjs` from the repository root (this checker has no CLI arguments; expect JSON with result `passed`). Verify EN/ES/device navigation and typed/realtime/embedded action summaries agree. Run package self-check before upload; do not create a second plugin catalog entry.
- [ ] **Step 5 — commit:** commit scoped assistant/package/embedded-view/test changes `feat(fleet): expose commercial operations through Ask V and plugin`.

### M4: Whole-workflow acceptance, reviewed activation and full ship

**Files:** add `lib/e2e/tests/fleet-commercial-offline.spec.ts`, API `services/fleet-commercial-acceptance.database.test.ts`, `scripts/tests/fleet-commercial-migrations.test.mjs`; update `.github/workflows/deploy-api.yml` to run A/C/D's guarded migration commands, and storage provisioning scripts only if the new private evidence path needs a configuration change. Update `docs/fleet-implementation-acceptance.md`, `docs/native-ios-release-readiness.md`, `docs/chatgpt-plugin-release.md`, `docs/release-fast-path.md`; add a dated release ledger under ignored `.local/` for live evidence. No manufactured device/provider pass.

**Interfaces:** consumes all A–D/M1–M3 results; produces a requirement-to-test-to-release evidence matrix and exact release commit/tree. Activation of the new commercial path is a reviewed feature configuration; compliance enforcement remains `warn_only` unless separately explicitly activated.

- [ ] **Step 1 — end-to-end cases:** synthetic dispatcher, office/admin and two drivers create multi-component Details; verify double-book rejection; run delivery-only and return-required work; create offline new ticket plus shared cached-ticket run; lose responses after commit; reboot; capture photos; allow red compliance; retain explicit safety hold; reconcile closed-ticket conflict while another run syncs; review mixed charges; show partner exception history and explicitly submit. Include all RF1–RF5 and legacy regression cases.
- [ ] **Step 2 — required verification:** safe DB preflight, `pnpm run typecheck`, `pnpm run test:web`, independent `pnpm run test:api`, full `pnpm test`, `pnpm lint:i18n`, `pnpm --filter @workspace/vndrly run build` and `pnpm --filter @workspace/vndrly-mobile exec expo export --platform ios --output-dir .local/fleet-ios-export`. Run each required gate once against the exact final tree; reuse fresh evidence where unchanged. Rehearse each new guarded migration twice on a unique local DB and prove old rows/credentials unchanged. Test that the API workflow includes `migrate:fleet-resources`, `migrate:fleet-compliance` and `migrate:fleet-pricing` before service restart. Never seed/reset shared data.
- [ ] **Step 3 — physical acceptance:** use the current implementation in an authorized development/internal candidate on a synthetic account/device to prove airplane-mode creation, OS termination/restart, durable photos, intermittent sync, app push open-to-exact-run, and consent-bound background location. Repeat the critical launch/create/sync/push smoke on the actual new TestFlight build after submission and Apple availability. Verify opted-in SMS only after actual readiness and approved sender are confirmed. Check partner role and private-data redaction on actual surfaces. If device/provider access is unavailable, record that precise acceptance gap; do not claim it passed or erase queued work to make a demo succeed.
- [ ] **Step 4 — review and release:** review exact staged diff, run relevant security/concurrency/precision checks, commit scoped acceptance/docs changes and publish the branch plus `main` non-force via configured GitHub integration. Full ship: Publish web, Deploy API plus guarded additive migrations/storage provision only if included, production OTA, native TestFlight build and successful submission, matching existing plugin package install/tool refresh and real scoped read plus harmless synthetic action/readback. Monitor tracks concurrently; inspect the failing boundary at 15 minutes, target web public verification within 10 minutes. Safe retries remain covered by the release authorization at execution time; never publish App Store Ready for Sale without explicit instruction.
- [ ] **Step 5 — finish:** final handoff lists commit/tree, all workflows, public web/Gate/API health, OTA group, TestFlight build/submission versus Apple processing, installed plugin version and actual live read/action proof, public plugin review status, elapsed commit-to-live time, and any precise device/provider limitation. Work is not “full ship complete” before TestFlight submission and installed plugin verification.

## Planning self-review and execution handoff

- [x] Map each scope section to A–D/M tasks, including offline first release, driver own-work, multi-part rigs, optional return, warn-only exceptions/partner disclosure, future enforcement, itemized precision and service templates.
- [x] Separate current capabilities from proposed contracts; no implementation/test/release claimed by this document.
- [x] Assign every cross-plan shared type/function to one file/task; dependent plans import it. No permissive `unknown` payload or undefined policy default.
- [x] Put RF1–RF5 in the owning tests; add provider/unplanned-work/legacy/security coverage explicitly.
- [x] Avoid new dependencies and destructive/schema-reset paths; keep the existing unconnected integration boundaries honest.

The user approved the written plan and selected **Native** execution on October 16, 2026, adding the conversational assignment requirement above. Implement tasks in sequence in this isolated workspace, with one independent whole-branch review; preserve progress and rulings in the plan's execution ledger. No repeated between-task approval is needed. This choice does not alter scope or the acceptance/release gates.

Execution progress: A1, C1 and D1 foundations are committed and tested. A2 resource management, paginated history/readback and reservation primitives are implemented/tested; full run creation/start/closeout/replacement integration remains open, so A2 is not complete. All other tasks and the full release remain pending. The execution ledger contains exact evidence and next actions. Unattended continuation is attached to this same chat, automation ID `finish-approved-fleet-commercial-operations`; deactivate only after actual full completion or an explicit user instruction.
