# Fleet Mobile Role Workflows Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the fragmented Fleet mobile portals with one role-aware, progressively disclosed Fleet workspace in which Admin, Office, Dispatch, Yard, Driver, and independent operators can complete their authorized workflows end to end.

**Architecture:** Keep the existing Fleet run, inventory, map, compliance, ticket, billing, and offline foundations. Add normalized Yard/custody/capability orchestration, expose independent role-scoped projections, and split the mobile `FleetWorkspace` into focused Work Hub-styled modules so one module failure cannot blank the portal.

**Tech Stack:** TypeScript 5.9, React Native/Expo Router, React 19, Express 5, PostgreSQL/Drizzle, Zod 4, Vitest, Playwright, GitHub Actions, EAS OTA/TestFlight, ChatGPT Apps SDK plugin.

**Spec:** `docs/superpowers/specs/2026-10-19-fleet-mobile-role-workflows-design.md`

## Global Constraints

- AskV and Work Hub behavior remain unchanged.
- Use existing Work Hub/Gate responsive cards, theme tokens, `TogglePillButton`, `ImagePill`, and live company branding; do not create a second visual system.
- Tickets must flow: readiness, compatibility, safety, and compliance deficiencies affect warnings/scores but never block VNDRLY dispatch, run completion, or ticket completion.
- Existing ticket `status` and GPS `lifecycleState` remain authoritative; Fleet orchestration maps to them and never duplicates them.
- A Detail is truck plus rigging; the driver belongs to the Run. Historical Details with embedded drivers must remain readable.
- Use VNDRLY location observations only; add no telematics dependency.
- All persistence changes are additive and replay-safe. Never DROP, TRUNCATE, restore over data, force-push schema, or reseed a non-empty database.
- Offline mutations remain account/company/operation scoped, idempotent, visibly pending, and canonically read back before success.
- Phone and iPad, EN/ES, accessibility, API authorization, migration replay, and complete role workflows are release acceptance requirements.
- Preserve unrelated working-tree changes and untracked artifacts.

## Review Focus

1. **Legacy Detail with embedded driver:** historical data must parse and display while every new Detail stores no permanent driver; Task 1 pins both cases.
2. **One employee with all capabilities:** independent flow must collapse handoffs and avoid duplicate Yard/Dispatch/Office confirmations; Tasks 3 and 7 pin the projection and UI.
3. **One module returning HTTP 409 or 5xx:** unrelated Fleet cards and routes must remain usable; Tasks 5 and 6 pin partial projections and scoped recovery.
4. **Offline unknown outcome followed by membership switch:** retained work must not replay into another company and must recover by canonical receipt before any retry; Task 10 pins it.
5. **Red compliance score and expired records:** score and Partner-visible warnings update, while Yard, Dispatch, Run, and ticket transitions remain allowed; Tasks 5 and 9 pin the non-blocking boundary.

---

## File Structure

### Shared contracts

- `lib/api-zod/src/fleet-mobile-workflows.ts` — capabilities, yards, Yard Orders, custody, role-aware home cards, compliance score, and module-result schemas.
- `lib/api-zod/src/fleet-details.ts` — backward-compatible driver-free Detail contract.
- `lib/api-zod/src/index.ts` — public exports.

### Persistence and API

- `lib/db/src/schema/fleetYards.ts` — yards/home bases.
- `lib/db/src/schema/fleetPersonCapabilities.ts` — composable company-scoped Fleet capabilities.
- `lib/db/src/schema/fleetYardOrders.ts` — Yard Orders, assignments, actions, and outcomes.
- `lib/db/src/schema/fleetAssetCustody.ts` — current custody projection and append-only custody events.
- `artifacts/api-server/scripts/migrate-fleet-mobile-workflows.ts` — guarded additive migration.
- `artifacts/api-server/src/services/fleet-mobile-permissions.ts` — capability evaluation and legacy-role compatibility.
- `artifacts/api-server/src/services/fleet-yard.ts` — yard, Yard Order, and custody operations.
- `artifacts/api-server/src/services/fleet-mobile-home.ts` — independent per-module projections.
- `artifacts/api-server/src/services/fleet-compliance-score.ts` — transparent deductions and improvement steps.
- `artifacts/api-server/src/routes/fleet.ts` — new authenticated endpoints.

### Mobile

- `artifacts/vndrly-mobile/components/fleet/FleetShell.tsx` — shared responsive Fleet surface and module router.
- `artifacts/vndrly-mobile/components/fleet/FleetHome.tsx` — role-adaptive cards and progressive disclosure.
- `artifacts/vndrly-mobile/components/fleet/FleetModuleBoundary.tsx` — per-card/module loading, empty, error, conflict, and retry states.
- `artifacts/vndrly-mobile/components/fleet/YardBoard.tsx` — Yard employee workflow.
- `artifacts/vndrly-mobile/components/fleet/AssetWorkspace.tsx` — intake, custody, readiness, and asset history.
- `artifacts/vndrly-mobile/components/fleet/DispatchBoard.tsx` — Details, Yard readiness, run planning/release, and closeout.
- `artifacts/vndrly-mobile/components/fleet/DriverFleetDay.tsx` — assigned run, Yard capability, self-dispatch, route, return, and submission.
- `artifacts/vndrly-mobile/components/fleet/FleetComplianceHelper.tsx` — score, deductions, actions, and Partner preview.
- `artifacts/vndrly-mobile/components/FleetWorkspace.tsx` — reduced to a compatibility adapter for existing imports during this release.
- `artifacts/vndrly-mobile/lib/app-navigation.ts` and `(tabs)` routes — one Fleet navigation entry.

### Plugin and verification

- `artifacts/api-server/src/assistant/fleet-tools.ts` and `work-hub-tool-runtime.ts` — permission-scoped Fleet read/action tools.
- `integrations/chatgpt-plugin/skills/vndrly-fleet/` — matching instructions/reference updates.
- `artifacts/api-server/scripts/seed-companygo-fleet-workflows.ts` — additive FleetGo/GasGo role-workflow fixtures only.
- `lib/e2e/tests/fleet-mobile-role-workflows.spec.ts` — full role workflow acceptance.

---

### Task 1: Shared Fleet Workflow Contracts and Driver-Free Detail Compatibility

**Files:**
- Create: `lib/api-zod/src/fleet-mobile-workflows.ts`
- Create: `lib/api-zod/src/fleet-mobile-workflows.test.ts`
- Modify: `lib/api-zod/src/fleet-details.ts`
- Modify: `lib/api-zod/src/fleet-details.test.ts`
- Modify: `lib/api-zod/src/index.ts`

**Interfaces:**
- Produces: `FleetCapabilitySchema = z.enum(["admin","office","dispatch","yard","driver","self_dispatch"])`.
- Produces: `FleetYardSchema`, `FleetYardOrderSchema`, `FleetCustodyObservationSchema`, `FleetHomeProjectionSchema`, `FleetComplianceScoreSchema`, and their input/action schemas.
- Produces: `normalizeFleetDetail(value): FleetDetail`, accepting legacy `driverUserId: number` but returning `driverUserId: null` for reusable operational selection while historical snapshots retain the legacy label.
- Consumes: existing canonical UUID, timestamp, run, Detail, and ticket schemas.

- [ ] **Step 1: Write failing contract tests**

Add tests named:

- `parses each approved capability and rejects unknown authority`.
- `requires Yard Order actions to carry operationId expectedVersion actor scope and outcome`.
- `keeps compliance deductions advisory and exposes estimated improvement`.
- `parses legacy Detail driver history but new Detail saves require null driver`.
- `keeps run assignment driver separate from reusable Detail identity`.

- [ ] **Step 2: Run the focused contract tests and verify failure**

Run: `pnpm --filter @workspace/api-zod test -- src/fleet-mobile-workflows.test.ts src/fleet-details.test.ts`

Expected: FAIL because the workflow schemas and compatibility normalizer do not exist.

- [ ] **Step 3: Implement the shared contracts**

Implement the named schemas and exports. Preserve existing historical snapshots; make `driverUserId` nullable for compatibility and reject a non-null driver on new `FleetDetailSaveSchema` writes.

- [ ] **Step 4: Run contract tests and package typecheck**

Run: `pnpm --filter @workspace/api-zod test -- src/fleet-mobile-workflows.test.ts src/fleet-details.test.ts && pnpm run typecheck`

Expected: all focused tests and root typecheck PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/api-zod/src/fleet-mobile-workflows.ts lib/api-zod/src/fleet-mobile-workflows.test.ts lib/api-zod/src/fleet-details.ts lib/api-zod/src/fleet-details.test.ts lib/api-zod/src/index.ts
git commit -m "feat: define Fleet mobile workflow contracts"
```

### Task 2: Additive Yard, Capability, and Custody Persistence

**Files:**
- Create: `lib/db/src/schema/fleetYards.ts`
- Create: `lib/db/src/schema/fleetPersonCapabilities.ts`
- Create: `lib/db/src/schema/fleetYardOrders.ts`
- Create: `lib/db/src/schema/fleetAssetCustody.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `artifacts/api-server/scripts/migrate-fleet-mobile-workflows.ts`
- Create: `artifacts/api-server/src/services/fleet-mobile-workflows-migration.database.test.ts`
- Modify: `artifacts/api-server/package.json`
- Modify: `.github/workflows/deploy-api.yml`

**Interfaces:**
- Produces: additive tables `fleet_yards`, `fleet_person_capabilities`, `fleet_yard_orders`, `fleet_yard_order_assignments`, `fleet_yard_order_events`, `fleet_asset_custody`, and `fleet_asset_custody_events`.
- Produces: `pnpm --filter @workspace/api-server run migrate:fleet-mobile-workflows`.
- Guarantees: unique current capability/custody rows, append-only events, company-scoped foreign keys, optimistic `version`, and replay-safe `IF NOT EXISTS` migration behavior.

- [ ] **Step 1: Write the migration database test**

Assert first application and replay create every table/index exactly once, preserve an inserted Yard Order/custody event, and contain no `DROP`, `TRUNCATE`, broad `DELETE`, or restore statement.

- [ ] **Step 2: Run the migration test and verify failure**

Run: `pnpm --filter @workspace/api-server test -- src/services/fleet-mobile-workflows-migration.database.test.ts`

Expected: FAIL because the migration and schema modules are absent.

- [ ] **Step 3: Implement additive schema and migration**

Use UUID record identifiers, integer company/user identifiers matching existing membership ownership, JSONB only for bounded advisory snapshots, timestamps with timezone, and optimistic versions. Register the guarded migration in API deploy after existing Fleet migrations.

- [ ] **Step 4: Verify first apply, replay, schema drift, and test safety**

Run: `pnpm --filter @workspace/api-server test -- src/services/fleet-mobile-workflows-migration.database.test.ts`

Expected: PASS on the isolated test database with inserted rows unchanged after replay.

- [ ] **Step 5: Commit**

```bash
git add lib/db/src/schema artifacts/api-server/scripts/migrate-fleet-mobile-workflows.ts artifacts/api-server/src/services/fleet-mobile-workflows-migration.database.test.ts artifacts/api-server/package.json .github/workflows/deploy-api.yml
git commit -m "feat: persist Fleet yards custody and capabilities"
```

### Task 3: Composable Fleet Authorization

**Files:**
- Create: `artifacts/api-server/src/services/fleet-mobile-permissions.ts`
- Create: `artifacts/api-server/src/services/fleet-mobile-permissions.test.ts`
- Modify: `artifacts/api-server/src/services/fleet-permissions.ts`
- Modify: `artifacts/api-server/src/routes/fleet.ts`
- Test: `artifacts/api-server/src/routes/fleet.database.test.ts`

**Interfaces:**
- Consumes: `FleetCapability`, active membership, existing `fleet_manager | dispatcher | driver` grants.
- Produces: `resolveFleetCapabilities(actor, companyId): Promise<ReadonlySet<FleetCapability>>`.
- Produces: `mayPerformFleetMobileAction(actor, target, action)` for `configure`, `office_review`, `dispatch`, `yard_work`, `perform_run`, `self_dispatch`, `view_live_map`, and `view_compliance`.
- Produces: `GET /api/fleet/capabilities` and versioned Admin updates to employee capabilities.

- [ ] **Step 1: Write authorization tests**

Pin Admin, Office, Dispatch, Yard, Driver, Driver+Yard, Driver+Self-Dispatch, independent all-capability, cross-company denial, and revoked-membership denial. Assert the all-capability projection does not produce duplicate handoff authority.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @workspace/api-server test -- src/services/fleet-mobile-permissions.test.ts src/routes/fleet.database.test.ts`

Expected: FAIL on missing capability resolver/endpoints.

- [ ] **Step 3: Implement capability resolution and legacy-role mapping**

Legacy managers map to Admin+Dispatch; legacy dispatchers map to Dispatch; legacy drivers map to Driver. New stored capability rows override only their own company scope and never expand cross-company access.

- [ ] **Step 4: Run focused tests and API typecheck**

Run: `pnpm --filter @workspace/api-server test -- src/services/fleet-mobile-permissions.test.ts src/routes/fleet.database.test.ts && pnpm --filter @workspace/api-server typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/services/fleet-mobile-permissions.ts artifacts/api-server/src/services/fleet-mobile-permissions.test.ts artifacts/api-server/src/services/fleet-permissions.ts artifacts/api-server/src/routes/fleet.ts artifacts/api-server/src/routes/fleet.database.test.ts
git commit -m "feat: add composable Fleet employee capabilities"
```

### Task 4: Yard Orders and Asset Custody API

**Files:**
- Create: `artifacts/api-server/src/services/fleet-yard.ts`
- Create: `artifacts/api-server/src/services/fleet-yard.test.ts`
- Create: `artifacts/api-server/src/services/fleet-yard.database.test.ts`
- Modify: `artifacts/api-server/src/routes/fleet.ts`
- Modify: `artifacts/api-server/src/services/fleet-details.ts`
- Modify: `artifacts/api-server/src/services/fleet-reservations.ts`

**Interfaces:**
- Produces: `GET/POST/PATCH /api/fleet/yards`.
- Produces: `GET/POST /api/fleet/yard-orders`, `GET /api/fleet/yard-orders/:id`, and `POST /api/fleet/yard-orders/:id/actions`.
- Produces: `GET /api/fleet/custody` and `POST /api/fleet/custody/operations`.
- Produces: `suggestYardResources({yardId, vehicleAssetId?, rigPackageId?, window})` returning co-located candidates plus advisory reasons.
- Guarantees: `ready`, `needs_attention`, and `unable_to_complete` outcomes never mutate ticket authority or become server transition blockers.

- [ ] **Step 1: Write service and database tests**

Cover multi-yard intake, GPS/gate/manual verification source, assignment, substitution, ready/attention/unable outcomes, driver self-check-in, rigging inheriting attached truck location, detach/transfer, optimistic conflict, idempotent operation replay, and cross-company denial.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @workspace/api-server test -- src/services/fleet-yard.test.ts src/services/fleet-yard.database.test.ts`

Expected: FAIL because the Yard/custody service is missing.

- [ ] **Step 3: Implement Yard/custody services and routes**

Reuse existing canonical asset IDs, Details, reservations, Work Hub schedule references, notification service, and location observations. Keep event history append-only and return canonical operation receipts.

- [ ] **Step 4: Verify focused tests and existing Fleet Detail/reservation suites**

Run: `pnpm --filter @workspace/api-server test -- src/services/fleet-yard.test.ts src/services/fleet-yard.database.test.ts src/services/fleet-details.test.ts src/services/fleet-reservations.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/services/fleet-yard.ts artifacts/api-server/src/services/fleet-yard.test.ts artifacts/api-server/src/services/fleet-yard.database.test.ts artifacts/api-server/src/routes/fleet.ts artifacts/api-server/src/services/fleet-details.ts artifacts/api-server/src/services/fleet-reservations.ts
git commit -m "feat: add Fleet Yard and custody workflows"
```

### Task 5: Role-Aware Home and Compliance Improvement Projections

**Files:**
- Create: `artifacts/api-server/src/services/fleet-mobile-home.ts`
- Create: `artifacts/api-server/src/services/fleet-mobile-home.test.ts`
- Create: `artifacts/api-server/src/services/fleet-compliance-score.ts`
- Create: `artifacts/api-server/src/services/fleet-compliance-score.test.ts`
- Modify: `artifacts/api-server/src/routes/fleet.ts`
- Modify: `artifacts/api-server/src/services/fleet-compliance.ts`

**Interfaces:**
- Produces: `GET /api/fleet/home?module=summary|dispatch|yard|driver|office|assets|map|history|compliance`.
- Produces: `readFleetHomeModule(actor, module): Promise<FleetModuleResult>`; one module failure never converts the whole response into failure.
- Produces: `GET /api/fleet/compliance-score` with deductions, category totals, urgency, estimated resolved score, owner role, steps, and Partner-visible projection.
- Guarantees: score calculation is explanatory and advisory; it is never consumed as a dispatch/run/ticket permission.

- [ ] **Step 1: Write projection tests**

Assert role-specific cards, independent all-capability collapse, independent module errors, scoped HTTP 409 recovery metadata, red compliance score with actionable deductions, Partner preview, and successful run/ticket transitions despite expired records.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @workspace/api-server test -- src/services/fleet-mobile-home.test.ts src/services/fleet-compliance-score.test.ts`

Expected: FAIL on missing projections.

- [ ] **Step 3: Implement home and score services**

Compute cards from canonical records and capabilities. Rank improvement items by urgency then score impact. Use existing compliance facts and records; never invent verification or make a deduction a permission check.

- [ ] **Step 4: Run focused tests and API typecheck**

Run: `pnpm --filter @workspace/api-server test -- src/services/fleet-mobile-home.test.ts src/services/fleet-compliance-score.test.ts && pnpm --filter @workspace/api-server typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/api-server/src/services/fleet-mobile-home.ts artifacts/api-server/src/services/fleet-mobile-home.test.ts artifacts/api-server/src/services/fleet-compliance-score.ts artifacts/api-server/src/services/fleet-compliance-score.test.ts artifacts/api-server/src/services/fleet-compliance.ts artifacts/api-server/src/routes/fleet.ts
git commit -m "feat: project Fleet home and compliance guidance"
```

### Task 6: One Fleet Navigation Entry and Failure-Isolated Shell

**Files:**
- Create: `artifacts/vndrly-mobile/components/fleet/FleetShell.tsx`
- Create: `artifacts/vndrly-mobile/components/fleet/FleetShell.test.tsx`
- Create: `artifacts/vndrly-mobile/components/fleet/FleetModuleBoundary.tsx`
- Create: `artifacts/vndrly-mobile/components/fleet/FleetModuleBoundary.test.tsx`
- Modify: `artifacts/vndrly-mobile/app/(tabs)/fleet.tsx`
- Modify: `artifacts/vndrly-mobile/app/(tabs)/_layout.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetWorkspace.tsx`
- Modify: `artifacts/vndrly-mobile/lib/app-navigation.ts`
- Modify: `artifacts/vndrly-mobile/lib/app-navigation.test.ts`
- Modify as redirects: `artifacts/vndrly-mobile/app/(tabs)/fleet-log.tsx`, `fleet-map.tsx`, `fleet-locations.tsx`, `fleet-compliance.tsx`

**Interfaces:**
- Produces: one `fleet` navigation key and `/fleet?module=<module>` deep links.
- Produces: `FleetModuleBoundary({module, children, onRetry})` with loading, empty, warning, conflict, unavailable, and retry/review states.
- Preserves: legacy route redirects to the equivalent Fleet module.

- [ ] **Step 1: Write navigation and boundary tests**

Assert exactly one Fleet nav entry on phone/iPad, AskV and Work Hub unchanged, legacy links redirect, a Compliance 409 renders only the Compliance recovery card, and Dispatch/Map children remain mounted.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @workspace/vndrly-mobile test -- lib/app-navigation.test.ts components/fleet/FleetShell.test.tsx components/fleet/FleetModuleBoundary.test.tsx`

Expected: FAIL because the shell/boundary and one-entry navigation are absent.

- [ ] **Step 3: Implement Fleet shell, module boundary, and redirects**

Reuse `ScreenSafeArea`, Work Hub card styles, `useColors`, branding, adaptive navigation, and approved phone/iPad breakpoints. Keep legacy Fleet routes as redirects for saved links. Reduce `FleetWorkspace` to the compatibility adapter; do not delete it in this release. Do not change AskV or Work Hub routes.

- [ ] **Step 4: Run focused mobile tests and typecheck**

Run: `pnpm --filter @workspace/vndrly-mobile test -- lib/app-navigation.test.ts components/fleet/FleetShell.test.tsx components/fleet/FleetModuleBoundary.test.tsx && pnpm --filter @workspace/vndrly-mobile typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/vndrly-mobile/app/'(tabs)' artifacts/vndrly-mobile/lib/app-navigation.ts artifacts/vndrly-mobile/lib/app-navigation.test.ts artifacts/vndrly-mobile/components/FleetWorkspace.tsx artifacts/vndrly-mobile/components/fleet/FleetShell.tsx artifacts/vndrly-mobile/components/fleet/FleetShell.test.tsx artifacts/vndrly-mobile/components/fleet/FleetModuleBoundary.tsx artifacts/vndrly-mobile/components/fleet/FleetModuleBoundary.test.tsx
git commit -m "refactor: unify Fleet mobile navigation"
```

### Task 7: Role-Adaptive Fleet Home and Progressive Complexity

**Files:**
- Create: `artifacts/vndrly-mobile/components/fleet/FleetHome.tsx`
- Create: `artifacts/vndrly-mobile/components/fleet/FleetHome.test.tsx`
- Create: `artifacts/vndrly-mobile/hooks/use-fleet-home.ts`
- Create: `artifacts/vndrly-mobile/app/__tests__/profile-role-visibility.test.tsx`
- Modify: `artifacts/vndrly-mobile/components/fleet/FleetShell.tsx`
- Modify: `artifacts/vndrly-mobile/app/(tabs)/profile.tsx`

**Interfaces:**
- Consumes: per-module `GET /api/fleet/home` projections.
- Produces: independent operator **My Fleet Day** and coordinated Operations cards.
- Produces: module links for Needs Attention, Dispatch Board, Yard Board, Active Runs, and role-specific next actions.

- [ ] **Step 1: Write Fleet Home tests**

Cover Admin, Office, Dispatch, Yard, Driver, Driver+Yard, all-capability independent, no-yard independent, phone stack, iPad two-column layout, module partial failure, and no duplicated handoff action for one employee.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @workspace/vndrly-mobile test -- components/fleet/FleetHome.test.tsx`

Expected: FAIL because Fleet Home is absent.

- [ ] **Step 3: Implement Fleet Home and remove operational duplication from Profile**

Use the exact Work Hub card hierarchy and brand tokens. Show advanced cards only when capabilities/data require them; keep Admin manual module visibility controls in Setup, not Profile.

- [ ] **Step 4: Run focused tests, accessibility checks, and typecheck**

Run: `pnpm --filter @workspace/vndrly-mobile test -- components/fleet/FleetHome.test.tsx app/__tests__/profile-role-visibility.test.tsx && pnpm --filter @workspace/vndrly-mobile typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/vndrly-mobile/components/fleet/FleetHome.tsx artifacts/vndrly-mobile/components/fleet/FleetHome.test.tsx artifacts/vndrly-mobile/hooks/use-fleet-home.ts artifacts/vndrly-mobile/components/fleet/FleetShell.tsx artifacts/vndrly-mobile/app/'(tabs)'/profile.tsx artifacts/vndrly-mobile/app/__tests__/profile-role-visibility.test.tsx
git commit -m "feat: add role-adaptive Fleet home"
```

### Task 8: Yard Board and Asset Workspace

**Files:**
- Create: `artifacts/vndrly-mobile/components/fleet/YardBoard.tsx`
- Create: `artifacts/vndrly-mobile/components/fleet/YardBoard.test.tsx`
- Create: `artifacts/vndrly-mobile/components/fleet/AssetWorkspace.tsx`
- Create: `artifacts/vndrly-mobile/components/fleet/AssetWorkspace.test.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetInventory.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetDetails.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetDetailsLibrary.tsx`

**Interfaces:**
- Consumes: Yard, Yard Order, custody, Inventory, rig package, and Detail APIs.
- Produces: intake, assignment, assembly, advisory substitutions, condition reporting, readiness outcome, self-check-in, detach, transfer, and history UI.
- Guarantees: no warning disables the outcome action; exact reasons remain visible and audited.

- [ ] **Step 1: Write Yard and asset workflow tests**

Cover new asset intake, multi-yard assignment, requested-to-reported Yard Order, Driver+Yard completion, missing component warning with continuation, self-check-in without Yard staff, inherited rigging location, transfer, and cross-yard/cross-company denial.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @workspace/vndrly-mobile test -- components/fleet/YardBoard.test.tsx components/fleet/AssetWorkspace.test.tsx`

Expected: FAIL because the focused modules are absent.

- [ ] **Step 3: Implement Yard and asset modules**

Reuse existing Inventory/Details components internally where useful, but expose Work Hub cards and one primary action per workflow state. New Details never permanently select a driver.

- [ ] **Step 4: Run focused tests and affected existing suites**

Run: `pnpm --filter @workspace/vndrly-mobile test -- components/fleet/YardBoard.test.tsx components/fleet/AssetWorkspace.test.tsx components/FleetInventory.test.tsx components/FleetDetails.test.tsx components/FleetDetailsLibrary.test.tsx`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/vndrly-mobile/components/fleet/YardBoard.tsx artifacts/vndrly-mobile/components/fleet/YardBoard.test.tsx artifacts/vndrly-mobile/components/fleet/AssetWorkspace.tsx artifacts/vndrly-mobile/components/fleet/AssetWorkspace.test.tsx artifacts/vndrly-mobile/components/FleetInventory.tsx artifacts/vndrly-mobile/components/FleetDetails.tsx artifacts/vndrly-mobile/components/FleetDetailsLibrary.tsx
git commit -m "feat: complete Fleet Yard and asset workflows"
```

### Task 9: Dispatch Board, Run Builder, and Ticket Continuity

**Files:**
- Create: `artifacts/vndrly-mobile/components/fleet/DispatchBoard.tsx`
- Create: `artifacts/vndrly-mobile/components/fleet/DispatchBoard.test.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetRunPlan.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetRunBilling.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetRunOrders.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetTicketFinalization.tsx`
- Modify: `artifacts/api-server/src/services/fleet-ops.ts`
- Test: `artifacts/api-server/src/services/fleet-work-create.database.test.ts`

**Interfaces:**
- Consumes: authorized ticket/new-draft billing choices, Yard readiness, driver availability, Details, run orders, destinations, and schedules.
- Produces: one guided builder `authorized work → route/return → Detail request/reservation → driver → review/release`.
- Guarantees: run planning may remain `waiting_on_yard`; reassignment/substitution preserves linked ticket and operation history.

- [ ] **Step 1: Write Dispatch and ticket-continuity tests**

Cover existing authorized ticket, Office-review draft, default yard-job-return route, multiple ordered stops, planning before Yard readiness, advisory red compliance score, reassignment, substitution, one-tap clean closeout, and unchanged ticket identity/version lineage.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @workspace/vndrly-mobile test -- components/fleet/DispatchBoard.test.tsx components/FleetRunPlan.test.tsx components/FleetRunBilling.test.tsx && pnpm --filter @workspace/api-server test -- src/services/fleet-work-create.database.test.ts`

Expected: FAIL on the missing orchestration and driver-free Detail assumptions.

- [ ] **Step 3: Implement Dispatch workflow and server continuity changes**

Keep ticket creation/finalization server-owned and confirmation-bound. Map new orchestration states to existing run/ticket states without adding a competing ticket state machine.

- [ ] **Step 4: Run Dispatch, billing, run, and API suites**

Run: `pnpm --filter @workspace/vndrly-mobile test -- components/fleet/DispatchBoard.test.tsx components/FleetRunPlan.test.tsx components/FleetRunBilling.test.tsx components/FleetRunOrders.test.tsx components/FleetTicketFinalization.test.tsx && pnpm --filter @workspace/api-server test -- src/services/fleet-work-create.database.test.ts src/services/fleet-billing.database.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/vndrly-mobile/components/fleet/DispatchBoard.tsx artifacts/vndrly-mobile/components/fleet/DispatchBoard.test.tsx artifacts/vndrly-mobile/components/FleetRunPlan.tsx artifacts/vndrly-mobile/components/FleetRunBilling.tsx artifacts/vndrly-mobile/components/FleetRunOrders.tsx artifacts/vndrly-mobile/components/FleetTicketFinalization.tsx artifacts/api-server/src/services/fleet-ops.ts artifacts/api-server/src/services/fleet-work-create.database.test.ts
git commit -m "feat: complete Fleet dispatch and ticket flow"
```

### Task 10: Driver Fleet Day, Self-Dispatch, Return, and Offline Recovery

**Files:**
- Create: `artifacts/vndrly-mobile/components/fleet/DriverFleetDay.tsx`
- Create: `artifacts/vndrly-mobile/components/fleet/DriverFleetDay.test.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetDriverRun.tsx`
- Modify: `artifacts/vndrly-mobile/lib/fleet-offline.ts`
- Modify: `artifacts/vndrly-mobile/lib/fleet-offline-native.ts`
- Modify: `artifacts/vndrly-mobile/lib/fleet-work-journal-native.ts`
- Modify: `artifacts/vndrly-mobile/lib/fleet-phone-location.ts`

**Interfaces:**
- Consumes: Driver/Yard/Self-Dispatch capabilities and assigned run/Detail/ticket projection.
- Produces: accept, optional Yard completion, authorized self-dispatch, ordered stop work, evidence/exceptions, return/self-check-in, and submit-closeout actions.
- Guarantees: attached rigging follows VNDRLY truck location; context switch blocks replay; unknown outcome reads the original receipt before retry.

- [ ] **Step 1: Write driver and offline tests**

Cover Driver-only, Driver+Yard, Driver+Self-Dispatch, no Yard staff, poor connectivity, pending sync, duplicate retry prevention, unknown result recovery, logout/membership switch, detach/transfer, return defect, and completed run reaching Dispatch without Yard verification.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @workspace/vndrly-mobile test -- components/fleet/DriverFleetDay.test.tsx components/FleetDriverRun.test.tsx lib/fleet-offline.test.ts lib/fleet-offline-native.test.ts`

Expected: FAIL on missing Driver Fleet Day and new retained-action kinds.

- [ ] **Step 3: Implement Driver Fleet Day and retained operations**

Keep one primary next action visible. Reuse existing evidence, location, workday, and offline journal primitives; extend their discriminated unions rather than creating a parallel queue.

- [ ] **Step 4: Run focused driver/offline/location suites and typecheck**

Run: `pnpm --filter @workspace/vndrly-mobile test -- components/fleet/DriverFleetDay.test.tsx components/FleetDriverRun.test.tsx lib/fleet-offline.test.ts lib/fleet-offline-native.test.ts lib/fleet-work-journal-native.test.ts lib/fleet-phone-location.test.ts && pnpm --filter @workspace/vndrly-mobile typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/vndrly-mobile/components/fleet/DriverFleetDay.tsx artifacts/vndrly-mobile/components/fleet/DriverFleetDay.test.tsx artifacts/vndrly-mobile/components/FleetDriverRun.tsx artifacts/vndrly-mobile/lib/fleet-offline.ts artifacts/vndrly-mobile/lib/fleet-offline-native.ts artifacts/vndrly-mobile/lib/fleet-work-journal-native.ts artifacts/vndrly-mobile/lib/fleet-phone-location.ts
git commit -m "feat: complete Fleet driver day and offline flow"
```

### Task 11: Map, History, Compliance Helper, Localization, and Accessibility

**Files:**
- Create: `artifacts/vndrly-mobile/components/fleet/FleetComplianceHelper.tsx`
- Create: `artifacts/vndrly-mobile/components/fleet/FleetComplianceHelper.test.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetMapOverview.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetComplianceRegister.tsx`
- Modify: `artifacts/vndrly-mobile/components/FleetReports.tsx`
- Modify: `artifacts/vndrly-mobile/components/service-marketplace/PartnerVendorResults.tsx`
- Modify: `artifacts/vndrly-mobile/app/__tests__/service-marketplace.test.tsx`
- Modify: `artifacts/vndrly/src/components/service-marketplace/PartnerVendorResults.tsx`
- Modify: `artifacts/vndrly/src/pages/partner-catalog.marketplace.test.tsx`
- Modify: `artifacts/vndrly-mobile/lib/locales/en.json`
- Modify: `artifacts/vndrly-mobile/lib/locales/es.json`
- Modify: `artifacts/vndrly/src/lib/locales/en.json`
- Modify: `artifacts/vndrly/src/lib/locales/es.json`

**Interfaces:**
- Consumes: canonical map context, custody observations, history, reports, and compliance score.
- Produces: role-filtered Map, searchable History, score categories, improvement queue, resolution steps, score history, and matching mobile/web Partner vendor-card score summaries.
- Guarantees: Office never receives continuous driver tracking; Yard sees expected yard assets; Driver sees own route/Detail; score deficiencies remain non-blocking.

- [ ] **Step 1: Write module, visibility, locale, and accessibility tests**

Cover role-filtered map payload rendering, stale/derived location labels, compliance deductions and estimated improvements, technical outage versus low-score copy, matching Partner vendor-card score/reasons, iPad two-column and phone stack, labels/touch order, EN/ES parity, and no orphaned keys.

- [ ] **Step 2: Run tests and verify failure**

Run: `pnpm --filter @workspace/vndrly-mobile test -- components/fleet/FleetComplianceHelper.test.tsx components/FleetMapOverview.test.tsx components/FleetLanguage.test.tsx app/__tests__/service-marketplace.test.tsx && pnpm --filter @workspace/vndrly test -- src/pages/partner-catalog.marketplace.test.tsx && pnpm lint:i18n`

Expected: FAIL on the new helper/copy and any missing locale keys.

- [ ] **Step 3: Implement supporting modules and localized accessible copy**

Use shared Work Hub cards and semantic pills. Display source/timestamp/confidence for VNDRLY locations. Keep detailed configuration tools behind authorized drill-downs instead of leading the Compliance home.

- [ ] **Step 4: Run affected mobile suites, locale lint, and typecheck**

Run: `pnpm --filter @workspace/vndrly-mobile test -- components/fleet/FleetComplianceHelper.test.tsx components/FleetMapOverview.test.tsx components/FleetComplianceRegister.test.tsx components/FleetReports.test.tsx components/FleetLanguage.test.tsx app/__tests__/service-marketplace.test.tsx && pnpm --filter @workspace/vndrly test -- src/pages/partner-catalog.marketplace.test.tsx && pnpm lint:i18n && pnpm --filter @workspace/vndrly-mobile typecheck`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add artifacts/vndrly-mobile/components/fleet/FleetComplianceHelper.tsx artifacts/vndrly-mobile/components/fleet/FleetComplianceHelper.test.tsx artifacts/vndrly-mobile/components/FleetMapOverview.tsx artifacts/vndrly-mobile/components/FleetComplianceRegister.tsx artifacts/vndrly-mobile/components/FleetReports.tsx artifacts/vndrly-mobile/components/service-marketplace/PartnerVendorResults.tsx artifacts/vndrly-mobile/app/__tests__/service-marketplace.test.tsx artifacts/vndrly-mobile/lib/locales artifacts/vndrly/src/components/service-marketplace/PartnerVendorResults.tsx artifacts/vndrly/src/pages/partner-catalog.marketplace.test.tsx artifacts/vndrly/src/lib/locales
git commit -m "feat: finish Fleet supporting mobile modules"
```

### Task 12: ChatGPT Plugin Parity, Synthetic Acceptance, and Full Verification

**Files:**
- Modify: `artifacts/api-server/src/assistant/fleet-tools.ts`
- Modify: `artifacts/api-server/src/assistant/fleet-tools.test.ts`
- Modify: `artifacts/api-server/src/assistant/work-hub-tool-runtime.ts`
- Modify: `integrations/chatgpt-plugin/skills/vndrly-fleet/SKILL.md`
- Modify: `integrations/chatgpt-plugin/skills/vndrly-fleet/references/operations.md`
- Modify: `integrations/chatgpt-plugin/RELEASE.md`
- Create: `artifacts/api-server/scripts/seed-companygo-fleet-workflows.ts`
- Create: `artifacts/api-server/src/services/companygo-fleet-workflows.database.test.ts`
- Create: `lib/e2e/tests/fleet-mobile-role-workflows.spec.ts`
- Modify: `docs/fleet-implementation-acceptance.md`

**Interfaces:**
- Produces: permission-scoped read tools for Fleet Home/Yard Orders/custody/compliance score and confirmed actions for permitted Yard/self-dispatch operations.
- Produces: additive, idempotent FleetGo/GasGo fixtures covering every role and approved path without deleting or replacing existing history.
- Produces: browser acceptance evidence for independent and team workflows.

- [ ] **Step 1: Write plugin, fixture, and end-to-end tests**

Assert plugin scopes do not silently expand, reads are company/role scoped, confirmed actions retain operation identity, all role accounts complete their portal workflows, FleetGo has realistic Yard/Detail/run/ticket/billing/custody/compliance histories, and unrelated module failure does not stop active work.

- [ ] **Step 2: Run new acceptance tests and verify failure**

Run: `pnpm --filter @workspace/api-server test -- src/assistant/fleet-tools.test.ts src/services/companygo-fleet-workflows.database.test.ts && pnpm run test:e2e -- fleet-mobile-role-workflows.spec.ts`

Expected: FAIL until tools, fixtures, and workflows are complete.

- [ ] **Step 3: Implement plugin parity and additive synthetic fixtures**

Update the existing VNDRLY plugin package only; do not create a duplicate catalogue entry or widen existing grants. Seed by stable natural keys, insert only missing workflow records, preserve canonical passwords, and never delete existing rows.

- [ ] **Step 4: Run focused acceptance and mandatory repository gates**

Run:

```bash
pnpm lint:i18n
pnpm run typecheck
pnpm run test:web
pnpm run test:api
pnpm test
```

Expected: all mandatory gates PASS on the exact unchanged release tree.

- [ ] **Step 5: Perform final role/device acceptance**

Verify Fleet Admin, Office, Dispatch, Yard, Driver, Driver+Yard, Driver+Self-Dispatch, and independent all-capability flows on phone and iPad widths. Verify real module isolation, offline recovery, canonical readback, and Partner-visible score behavior.

- [ ] **Step 6: Commit final acceptance batch**

```bash
git add artifacts/api-server/src/assistant integrations/chatgpt-plugin artifacts/api-server/scripts/seed-companygo-fleet-workflows.ts artifacts/api-server/src/services/companygo-fleet-workflows.database.test.ts lib/e2e/tests/fleet-mobile-role-workflows.spec.ts docs/fleet-implementation-acceptance.md
git commit -m "test: verify complete Fleet role workflows"
```

- [ ] **Step 7: Full ship after the exact release tree is green**

Follow `docs/release-fast-path.md` and the repository standing authorization: non-force advance `main`, monitor web Publish, API deploy plus guarded migration, iOS OTA, TestFlight, and matching installed ChatGPT plugin update concurrently. Verify public web/Gate/API health, migration application/replay, OTA update group, TestFlight submission, installed plugin read plus harmless synthetic action/readback, and report public plugin review status separately.

---

## Plan Completion Gate

Implementation is complete only when all twelve tasks are committed, every required role completes its end-to-end workflow, the exact release tree passes mandatory gates, and every full-ship lane is independently verified. A rendered Fleet Home, a successful local build, or a green web deployment alone is not completion.
