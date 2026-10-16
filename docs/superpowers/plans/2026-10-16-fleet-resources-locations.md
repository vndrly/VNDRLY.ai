# A — Fleet Resources and Locations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Assemble reusable truck/rig/driver Details from canonical Inventory, reserve every member safely, and select physical routes independently of commercial billing authority.

**Architecture:** Add versioned current-state JSONB to existing vendor configuration, immutable revisions/operation receipts to the existing scoped audit repository, and strict shared Detail/route contracts. Extend the current destination registry and Inventory/replacement services; do not create competing asset, people, location or permission systems.

**Tech Stack:** Existing TypeScript/Zod/PostgreSQL/Express/React/Expo; no new dependency.

**Spec:** [Operating scope](../../fleet-operations-scope-ok-tx-2026-10-16.md), sections 1, 7–9, 12 and 16. [Master plan and dependencies](2026-10-16-fleet-commercial-operations.md).

## Global Constraints

All master constraints apply. `fleetIds` remain authorization/configuration groups, never assembled Details. Canonical Inventory custody is unchanged by adding an asset, assembling a package or dispatching a run. Red document compliance stays selectable under C's warning policy; actual holds, custody conflicts and overlapping reservations are separate controls. Only guarded additive columns are allowed. UI retains the other working pages and branded controls.

## Review Focus

- The same dolly belongs to two packages: reserve canonical components, not just package IDs.
- A run overruns its planned end: resources remain busy until actual operational release.
- Detail changes after dispatch: prior run snapshots cannot change.
- Physical destination is accessible but billing partner/site is unauthorized: location knowledge grants no commercial access.
- Delivery-only versus return-required run: release readiness follows the chosen operational policy, not office review.

## A1: Define resource and physical-route contracts

**Files:** create `lib/api-zod/src/fleet-details.ts`, `fleet-details.test.ts`, `fleet-route.ts`, `fleet-route.test.ts`; modify `lib/api-zod/src/{index.ts,fleet.ts,fleet-commercial.ts,fleet-inventory.ts}`, `lib/db/src/schema/vendors.ts`; create `lib/db/src/scripts/apply-fleet-resources.ts` and its `migrate:fleet-resources` entry in `lib/db/package.json`.

**Interfaces:** own and export the following strict schemas/types; C imports identities without importing A services, B imports immutable snapshots, D consumes the route's explicit billing context. Keep existing ID representations: company/user/site/ticket/service IDs are positive integers; canonical Inventory/Detail/package/run/destination and operation IDs are UUIDs. Do not convert existing numeric people or ticket IDs to UUIDs.

- `FleetRigPackage`: `{id,companyId,version,name,components:[{assetId,role,sequence}],effectiveFrom,effectiveUntil,archivedAt}`; roles `trailer | dolly | tank | pump | accessory`. Nonempty unique canonical components; a truck is not its own trailer.
- `FleetDetail`: `{id,companyId,version,name,vehicleAssetId,rigPackageId:null|UUID,rigPackageVersion:null|number,driverUserId,effectiveFrom,effectiveUntil,archivedAt}`. Legacy access group references live in a separate `accessGroupIds` property, not in the Detail ID.
- `FleetDetailSnapshot`: exact Detail/package revisions, canonical member IDs, permitted display labels and carrier-of-record reference, plus `snapshottedAt`. No mutable pointer-only history.
- `FleetReservation`: `{id,runId,detailId,detailVersion,driverUserId,assetIds,startAt,plannedEndAt,timeZone,state,actualReleasedAt,releaseReason,version}`. States `reserved | active | released | cancelled`; interval semantics `[startAt,endAt)`. An active overrun has no inferred release.
- Extend existing `FleetDestinationSchema`, preserving existing IDs/versions, with roles, time zone, optional geofence/entry point, contacts, permitted scope, material constraints, appointment/access notes and active interval. Existing owner and active fields remain authoritative.
- `FleetRoutePlan`: `{origin,stops,returnPolicy,base,plannedWindow}` with versioned location snapshots; `returnPolicy: delivery_only | return_required`, base required for return-required work. Multi-cycle pickup/drop stops reference a `cycleId`; source and provisional-reference state stay explicit. The existing billing site/partner/AFE fields remain outside physical stop authority.

- [ ] **Step 1 — contract tests:** write `package_rejects_duplicate_asset_ids`, `truck_only_detail_accepts_null_package`, `snapshot_keeps_exact_component_revision`, `return_required_needs_base`, `physical_stop_does_not_fill_billing_site`. For example, assert parsing components `[{assetId:dolly,role:'dolly',sequence:0},{assetId:dolly,role:'dolly',sequence:1}]` fails and an existing legacy destination still parses unchanged.
- [ ] **Step 2 — verify red:** from `lib/api-zod`, run `pnpm exec vitest run src/fleet-details.test.ts src/fleet-route.test.ts`; expect the new contracts/tests to fail before implementation.
- [ ] **Step 3 — implement:** add strict schemas and explicit legacy adapters; add nullable `vendors.fleet_resources` JSONB only, read absent state as an empty versioned registry. Keep access groups and existing commercial settings intact. Write a guarded migration that only adds this column, does not seed/alter existing rows and can run twice. Update the schema export and migration entry.
- [ ] **Step 4 — verify green:** rerun the tests and API-Zod typecheck; test the migration twice on the master plan's retained fresh-local DB, asserting existing vendor JSON/access groups and row counts are unchanged.
- [ ] **Step 5 — commit:** stage only the listed contracts/schema/migration/tests and commit `feat(fleet): define Detail and physical-route contracts`.

## A2: Transactional Details, component reservations and replacement

**Files:** create API `src/services/fleet-details.ts`, `fleet-details.test.ts`, `fleet-details.database.test.ts`, `fleet-reservations.ts`, `fleet-reservations.test.ts`; modify `src/{routes/fleet.ts,services/fleet-ops.ts,services/fleet-itemized-repository.ts,services/fleet-replacement.ts,services/fleet-maintenance.ts,services/fleet-inventory.ts,services/fleet-availability.ts}`; extend corresponding existing tests. All API paths in this task are under `artifacts/api-server`.

**Interfaces:** `readFleetDetails(actor,query): Promise<FleetDetailPage>`; `saveFleetRigPackage(actor,input:{operationId,expectedVersion,package}): Promise<FleetRigPackage>`; `saveFleetDetail(actor,input:{operationId,expectedVersion,detail}): Promise<FleetDetail>`; `reserveFleetDetail(tx,actor,input:{runId,detailSnapshot,startAt,plannedEndAt,timeZone}): Promise<FleetReservation>`; `releaseFleetReservation(tx,actor,input:{runId,reason,occurredAt}): Promise<FleetReservation>`. Pass the current database transaction into reservation writes; do not commit an unreserved canonical run. C's assessments are advisory or enforced according to explicit policy; B owns offline conflict resolution.

- [ ] **Step 1 — transactional tests:** create `shared_dolly_cannot_double_book`, `adjacent_windows_allowed`, `active_overrun_blocks_reuse`, `office_review_does_not_hold_released_detail`, `return_required_waits_for_return`, `revision_does_not_rewrite_run`, `non_dispatcher_cannot_edit_others_detail`, `replacement_rechecks_every_component`. Assert concurrent reservations using the same canonical dolly produce exactly one success; an end at `11:00Z` permits the next non-active reservation at `11:00Z`; an active prior run remains unavailable at `11:01Z` until released.
- [ ] **Step 2 — verify red:** use the safe wrapper to run `src/services/fleet-details.test.ts src/services/fleet-details.database.test.ts src/services/fleet-reservations.test.ts src/services/fleet-replacement.test.ts`; expect failure on the unimplemented reservation/service contracts.
- [ ] **Step 3 — implement:** serialize writes with the current vendor lock, lock canonical asset/user rows in a stable global order, and evaluate overlaps inside the same transaction. Include authorized subcontracted resources in the conflict check without disclosing another company's assignment details. Validate company access, actual asset category/capacity/compatibility and current holds/custody without changing custody. Include all package members in inspection/maintenance/replacement checks. Store immutable revisions and operation fingerprints/readback receipts in the existing itemized audit. Current-state registry retains bounded active data; history reads are cursor-paginated. Archive prevents new use while preserving history. Expose `GET/POST /api/fleet/details`, `GET/PATCH /api/fleet/details/:id`, analogous `/rig-packages`, history and operation-readback routes; register static operation paths before `/:id`. Add run Detail snapshot and reservation fields behind a versioned adapter; keep v1 vehicle/single-trailer behavior intact.
- [ ] **Step 4 — verify green:** rerun named tests plus existing Inventory, maintenance, availability and Fleet permission tests. Assert recorded inventory checkout/return/history counts do not change merely because a Detail is created/reserved; inspection replacement binds to the new exact component snapshot. Inspect each transactional failure for complete rollback and stable retry receipts.
- [ ] **Step 5 — commit:** commit scoped services/routes/tests as `feat(fleet): reserve reusable Details across all rig components`.

## A3: Inventory and Details builder, location directory and route selection

**Files:** create web `src/components/{fleet-details.tsx,fleet-details.test.tsx,fleet-destinations.tsx,fleet-destinations.test.tsx,fleet-route-fields.tsx,fleet-route-fields.test.tsx}` under `artifacts/vndrly`; native `components/{FleetDetails.tsx,FleetDetails.test.tsx,FleetRouteFields.tsx,FleetRouteFields.test.tsx}` under `artifacts/vndrly-mobile`; modify existing web `components/fleet-inventory.tsx`, `fleet-draft-editor.tsx`, `pages/fleet.tsx`, `lib/fleet-client.ts`, `components/layout.tsx`, `App.tsx`; native `components/{FleetWorkspace.tsx,FleetDestinationDirectory.tsx}`, `lib/{fleet-mobile.ts,app-navigation.ts}`. Extend API `services/fleet-commercial.ts`, `routes/fleet.ts`; update EN/ES and relevant tests.

**Interfaces:** `FleetDetailBuilder({resources,assessments,onSave})` consumes A1 snapshots and C projections; `FleetRouteFields({value,destinations,onChange})` edits only physical route fields; `saveFleetDestination(actor,{operationId,expectedVersion,destination})` extends existing registry operations, not a second repository. B later supplies provisional local references; these components must accept B's resolved/unresolved form adapter instead of inventing canonical UUIDs.

- [ ] **Step 1 — screen/route tests:** test `three_lists_build_detail_without_custody_change`, `add_asset_here_auto_enrolls_fleet_inventory`, `red_member_selectable_warn_only`, `location_editor_reuses_existing_id`, `origin_destination_and_billing_are_separate`, `multiple_cycles_and_return_choice`, and `directory_back_uses_history`. Assert a truck-only Detail saves with a null package, an existing Inventory asset opens its real edit/history page, and selecting a physical terminal never substitutes its ID for an authorized billing site.
- [ ] **Step 2 — verify red:** web `pnpm --filter @workspace/vndrly exec vitest run src/components/fleet-details.test.tsx src/components/fleet-destinations.test.tsx src/components/fleet-route-fields.test.tsx`; native equivalent named component tests; safe API `src/services/fleet-commercial.test.ts` with new directory/route cases. Confirm proposed interactions fail before wiring.
- [ ] **Step 3 — implement:** rename this surface **Inventory and Details**; retain general Inventory links and its existing one-step Fleet asset creation/enrollment. Use three searchable lists, a compact selection summary, optional no-package selection, per-member compliance text/dots and separate availability labels. Keep legacy grant setup in settings. Add **Origins and Destinations** navigation and editable branded directory cards with existing IDs/ownership, optional map selection and manual addresses. Add origin/drop/base dropdowns and repeat cycles to the run editor; preserve an explicit billing context and explain mismatches. Extend the v2 commercial route adapter so it no longer forces both physical stops to the billing site. Preserve old historical two-stop snapshots unchanged.
- [ ] **Step 4 — verify green:** rerun named tests plus existing draft-editor, Inventory, setup and native directory tests; run `pnpm lint:i18n`. Review desktop/narrow layouts with actual screenshots and keyboard navigation. Verify no hidden compliance-only filter or duplicate destination/asset records and all prior functional pages remain reachable.
- [ ] **Step 5 — commit:** commit scoped UI/routes/locale/tests as `feat(fleet): add Inventory and Details and physical location directory`.

## Acceptance handoff

A is ready for B/M integration when canonical component identities, transactional reservation/readback, immutable assignment snapshots, reusable Details, explicit operational release and independently authorized physical/billing locations pass the named tests. It is not full offline delivery or full ship by itself. Continue with C/D/B and the master acceptance gate.
