# Work Hub, Gate Locations, and Ask V Follow-up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the approved permission-aware Files & Inventory, Search, Exports, Gate Location, and Ask V follow-up through a successful TestFlight submission.

**Architecture:** Extend the existing Work Hub, Implementation A custody, gate-station, and Ask V contracts rather than creating parallel systems. The API returns explicit capabilities and stable response/deep-link contracts; web and mobile render those contracts, while every mutation re-authorizes server-side and preserves versioning, idempotency, and audit history.

**Tech Stack:** TypeScript 5.9, React 19, React Native/Expo Router, Express 5, PostgreSQL/Drizzle, Zod, Vitest, Playwright, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-24-work-hub-gate-followup-design.md`

## Global Constraints

- No camera or NVR changes.
- No new external dependency without explicit user approval.
- Database changes are additive and guarded; never drop, truncate, reset, or restore over live data.
- The server is authoritative for role capabilities; clients do not infer mutation authority from labels.
- English and Spanish keys ship together.
- Full ship means commit, non-force advance `main`, web publish, API deploy plus guarded migrations, production verification, iOS OTA when compatible, and TestFlight build and submission.
- TestFlight submission success is the completion gate; Apple processing is reported separately.

## File structure

- `artifacts/api-server/src/work-hub/capabilities.ts` — shared Work Hub capability calculation and export dataset policy.
- `artifacts/api-server/src/routes/workHubOperations.ts` — federated search filters/results and inventory inclusion.
- `artifacts/api-server/src/routes/workHubFileLibrary.ts` and `workHubChannels.ts` — existing file/note APIs, capability fields, and author/admin edit checks.
- `artifacts/api-server/src/routes/implementationAAssets.ts` — canonical inventory response and custody authorization.
- `artifacts/api-server/src/routes/workHubExports.ts` — preview/final export authorization parity.
- `lib/db/src/schema/gateChangeOver.ts` and `lib/db/drizzle/gate_location_management.sql` — additive gate-location fields and indexes.
- `artifacts/api-server/src/routes/gateLocations.ts` — admin-only gate-location list/create/update/deactivate API.
- `artifacts/vndrly-mobile/app/work-hub/[module].tsx` — module routing only; focused UI moves to components below.
- `artifacts/vndrly-mobile/components/work-hub/FilesInventory.tsx` — combined Files & Notes and Inventory cards.
- `artifacts/vndrly-mobile/components/work-hub/WorkHubSearch.tsx` — branded search card and results.
- `artifacts/vndrly-mobile/components/work-hub/RoleExports.tsx` — capability-driven export card.
- `artifacts/vndrly-mobile/components/profile/GateLocationsCard.tsx` — admin gate-location settings surface.
- `artifacts/api-server/src/assistant/work-hub-tool-runtime.ts`, `tool-packs.ts`, `deep-links.ts`, and `tool-registry.ts` — Ask V execution, family aliases, destinations, and audit targets.
- `artifacts/vndrly-mobile/lib/askv-client-tools.ts` and `AssistantMarkdown.tsx` — native exact-item navigation.

## Review Focus

- CRLF or LF source files must produce identical source-inspection test results; normalize before assertions.
- A revoked membership between list and action must deny the action and expose no hidden record fields.
- A file reservation without upload finalization must never be reported as an uploaded file.
- An export preview must deny every owner/dataset combination the final export denies.
- A gate with coordinates far from its linked wellhead must retain independent coordinates and never mutate the partner site.

---

### Task 0: Repair the cross-platform baseline gate

**Files:**
- Modify: `artifacts/vndrly-mobile/components/BrandTitleRow.test.tsx`
- Modify: `artifacts/vndrly-mobile/app/__tests__/askv-composer.test.tsx`
- Test: the same two files

**Interfaces:**
- Produces: line-ending-independent source assertions used by the full mobile suite.

- [ ] **Step 1: Add a shared local normalization in each source-inspection test**

```ts
const source = readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
```

- [ ] **Step 2: Run the two tests and verify the old CRLF-only failure is gone**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run components/BrandTitleRow.test.tsx app/__tests__/askv-composer.test.tsx`

Expected: both files pass without changing product styles or controls.

- [ ] **Step 3: Run the complete mobile baseline**

Run: `pnpm --filter @workspace/vndrly-mobile test`

Expected: PASS.

- [ ] **Step 4: Commit**

```text
test: make mobile source assertions line-ending safe
```

### Task 1: Centralize Work Hub capability and role policy

**Files:**
- Create: `artifacts/api-server/src/work-hub/capabilities.ts`
- Create: `artifacts/api-server/src/work-hub/capabilities.test.ts`
- Modify: `artifacts/api-server/src/routes/workHubOperations.ts`
- Modify: `artifacts/vndrly-mobile/lib/work-hub-mobile.ts`
- Modify: `artifacts/vndrly-mobile/app/(tabs)/work-hub.tsx`
- Test: `artifacts/vndrly-mobile/app/__tests__/work-hub-home-cards.test.tsx`

**Interfaces:**
- Produces: `WorkHubCapabilities`, `resolveWorkHubCapabilities(viewer, ownerId)`, and `allowedExportDatasets`.

- [ ] **Step 1: Write failing API matrix tests**

```ts
expect(resolveWorkHubCapabilities(gatekeeper, ownerId)).toMatchObject({
  canUploadFile: true,
  canCreateNote: true,
  canCreateAsset: false,
  canCheckOutAsset: true,
  canViewExports: false,
  allowedExportDatasets: [],
  canManageGateLocations: false,
});
expect(resolveWorkHubCapabilities(gateSupervisor, ownerId).allowedExportDatasets).toEqual(["staffing"]);
expect(resolveWorkHubCapabilities(orgAdmin, ownerId).allowedExportDatasets).toEqual([
  "payroll-hours", "quickbooks-time", "inventory-custody", "staffing", "safety-response",
]);
```

- [ ] **Step 2: Run the matrix test and confirm it fails before implementation**

Run: `pnpm --filter @workspace/api-server exec vitest run src/work-hub/capabilities.test.ts`

- [ ] **Step 3: Implement the typed resolver and return it from Work Hub context/bootstrap responses**

```ts
export type WorkHubCapabilities = {
  canUploadFile: boolean;
  canCreateNote: boolean;
  canEditNote: boolean;
  canCreateAsset: boolean;
  canManageAsset: boolean;
  canCheckOutAsset: boolean;
  canVerifyIssuedAsset: boolean;
  canViewExports: boolean;
  allowedExportDatasets: ExportDataset[];
  canManageGateLocations: boolean;
};
```

- [ ] **Step 4: Make mobile home cards use returned capability data**

Assert that gatekeepers do not render Exports, supervisors render it only when `staffing` is allowed, and Files & Inventory remains visible.

- [ ] **Step 5: Run focused API/mobile tests and commit**

Run: `pnpm --filter @workspace/api-server exec vitest run src/work-hub/capabilities.test.ts && pnpm --filter @workspace/vndrly-mobile exec vitest run app/__tests__/work-hub-home-cards.test.tsx lib/work-hub-mobile.test.ts`

Commit: `feat: centralize Work Hub role capabilities`

### Task 2: Build the combined Files & Inventory mobile surface

**Files:**
- Create: `artifacts/vndrly-mobile/components/work-hub/FilesInventory.tsx`
- Create: `artifacts/vndrly-mobile/components/work-hub/FilesInventory.test.tsx`
- Modify: `artifacts/vndrly-mobile/app/work-hub/[module].tsx`
- Modify: `artifacts/vndrly-mobile/lib/work-hub-mobile.ts`
- Modify: `artifacts/api-server/src/routes/workHubFileLibrary.ts`
- Modify: `artifacts/api-server/src/routes/workHubChannels.ts`
- Test: `artifacts/api-server/src/routes/workHubFileLibrary.test.ts`

**Interfaces:**
- Consumes: `WorkHubCapabilities` from Task 1.
- Produces: `FilesInventory` component and file/note list contracts with explicit capabilities.

- [ ] **Step 1: Write failing mobile tests for both cards and role actions**

```tsx
expect(screen.getByText("Files & Notes")).toBeTruthy();
expect(screen.getByText("Inventory")).toBeTruthy();
expect(screen.getByRole("button", { name: "Upload File" })).toBeTruthy();
expect(screen.getByRole("button", { name: "Add Note" })).toBeTruthy();
```

Repeat with read-only capabilities and assert the two action buttons are absent while records remain visible.

- [ ] **Step 2: Write failing API tests for author/supervisor/admin note edits and revoked file access**

Assert an unrelated channel writer cannot edit another author's note, a supervisor in scope can, and a revoked file link returns 403 without metadata.

- [ ] **Step 3: Implement focused cards and existing upload/note flows**

Use the file reservation/finalization flow and channel note version field. Keep reserved, uploaded, and finalized states distinct in UI copy.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run components/work-hub/FilesInventory.test.tsx && pnpm --filter @workspace/api-server exec vitest run src/routes/workHubFileLibrary.test.ts src/routes/workHubChannels.test.ts`

Commit: `feat: combine mobile files notes and inventory`

### Task 3: Normalize inventory and add custody actions

**Files:**
- Modify: `artifacts/api-server/src/routes/implementationAAssets.ts`
- Modify: `artifacts/api-server/src/services/assets.ts`
- Modify: `artifacts/api-server/src/services/asset-database-repository.ts`
- Modify: `artifacts/vndrly-mobile/components/work-hub/FilesInventory.tsx`
- Modify: `artifacts/vndrly-mobile/components/implementation-a/Assets.tsx`
- Modify: `artifacts/vndrly/src/components/implementation-a/assets.tsx`
- Create: `artifacts/api-server/src/routes/implementationAAssets.test.ts`
- Test: `artifacts/vndrly-mobile/components/work-hub/FilesInventory.test.tsx`

**Interfaces:**
- Produces: canonical `{ assets: AssetSummary[], capabilities: AssetCapabilities }` response.

- [ ] **Step 1: Write a compatibility test for the response mismatch**

```ts
expect(response.body).toEqual(expect.objectContaining({
  assets: expect.any(Array),
  capabilities: expect.objectContaining({ canCheckOutAsset: expect.any(Boolean) }),
}));
```

- [ ] **Step 2: Write custody authorization and optimistic-conflict tests**

Cover gatekeeper self-checkout/verification, supervisor crew oversight, admin catalog management, forbidden gatekeeper catalog mutation, holds, and stale `expectedVersion`.

- [ ] **Step 3: Normalize the API and integrate existing location columns into repository mapping**

Return one documented object shape. Update both web and mobile callers together; do not add a second location table.

- [ ] **Step 4: Add mobile checkout, return, and verify-issued controls**

Controls render from capabilities and submit existing idempotency/version fields. Conflict refreshes the current asset rather than overwriting it.

- [ ] **Step 5: Run focused API, mobile, web, and e2e tests and commit**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/implementationAAssets.test.ts && pnpm --filter @workspace/vndrly-mobile exec vitest run components/work-hub/FilesInventory.test.tsx app/__tests__/implementation-a-journey.test.tsx && pnpm --filter @workspace/vndrly exec vitest run src/components/implementation-a/assets.test.tsx`

Commit: `feat: expose permission-aware inventory custody`

### Task 4: Build the branded federated Work Hub Search

**Files:**
- Create: `artifacts/vndrly-mobile/components/work-hub/WorkHubSearch.tsx`
- Create: `artifacts/vndrly-mobile/components/work-hub/WorkHubSearch.test.tsx`
- Modify: `artifacts/vndrly-mobile/app/work-hub/[module].tsx`
- Modify: `artifacts/vndrly-mobile/lib/work-hub-mobile.ts`
- Modify: `artifacts/api-server/src/routes/workHubOperations.ts`
- Create: `artifacts/api-server/src/routes/workHubOperations.search.test.ts`

**Interfaces:**
- Produces: `WorkHubSearchFilters { query, start?, end?, types? }` and exact-item result destinations.

- [ ] **Step 1: Write failing UI tests for branded structure and filter serialization**

Assert a two-pixel brand border, branded pill button, date/type controls, divider, loading/empty/no-results states, and exact query encoding.

- [ ] **Step 2: Write failing API tests for inventory inclusion and authorization**

Assert an authorized asset is returned with its exact destination, an unauthorized asset is absent, and revoked membership between search and open fails closed.

- [ ] **Step 3: Implement mobile component and extend the existing permission-scoped search**

Preserve current result caps. Include a stable continuation cursor only where the source query can honor it; never label capped results as a complete archive.

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/workHubOperations.search.test.ts && pnpm --filter @workspace/vndrly-mobile exec vitest run components/work-hub/WorkHubSearch.test.tsx`

Commit: `feat: add branded federated Work Hub search`

### Task 5: Enforce role-specific Exports

**Files:**
- Create: `artifacts/vndrly-mobile/components/work-hub/RoleExports.tsx`
- Create: `artifacts/vndrly-mobile/components/work-hub/RoleExports.test.tsx`
- Modify: `artifacts/vndrly-mobile/app/work-hub/[module].tsx`
- Modify: `artifacts/api-server/src/routes/workHubExports.ts`
- Test: `artifacts/api-server/src/routes/workHubExports.test.ts`

**Interfaces:**
- Consumes: `allowedExportDatasets` from Task 1.
- Produces: one shared authorization function for preview and final export.

- [ ] **Step 1: Write failing preview/final parity tests**

```ts
for (const endpoint of ["/preview", ""]) {
  await request(app).post(`/api/work-hub/exports${endpoint}`).send(forbiddenDataset).expect(403);
}
```

Cover gatekeeper no access, supervisor staffing only, admin all five datasets, and cross-owner denial.

- [ ] **Step 2: Reuse the same owner/dataset authorization in both routes**

Do not duplicate role conditionals in handlers. Preserve export audit rows and CSV injection protection.

- [ ] **Step 3: Render only allowed datasets and hide the entire gatekeeper card**

- [ ] **Step 4: Run focused tests and commit**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/workHubExports.test.ts && pnpm --filter @workspace/vndrly-mobile exec vitest run components/work-hub/RoleExports.test.tsx app/__tests__/work-hub-home-cards.test.tsx`

Commit: `fix: align Work Hub export roles`

### Task 6: Add admin-managed physical Gate Locations

**Files:**
- Modify: `lib/db/src/schema/gateChangeOver.ts`
- Create: `lib/db/drizzle/gate_location_management.sql`
- Create: `artifacts/api-server/src/routes/gateLocations.ts`
- Create: `artifacts/api-server/src/routes/gateLocations.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Create: `artifacts/vndrly-mobile/components/profile/GateLocationsCard.tsx`
- Create: `artifacts/vndrly-mobile/components/profile/GateLocationsCard.test.tsx`
- Modify: `artifacts/vndrly-mobile/app/(tabs)/profile.tsx`
- Modify: `artifacts/vndrly-mobile/lib/locales/en.json`
- Modify: `artifacts/vndrly-mobile/lib/locales/es.json`

**Interfaces:**
- Produces: `GateLocation { id, siteId, name, latitude, longitude, geofenceRadiusM, active, version }` and admin list/create/update/deactivate endpoints.

- [ ] **Step 1: Write failing schema and API authorization tests**

Cover multiple gates per site, a gate roughly fifteen miles from the wellhead, authorized MidCon admin management, gatekeeper/supervisor denial, cross-service-org denial, stale version conflict, and no mutation of `site_locations` coordinates.

- [ ] **Step 2: Add guarded fields and indexes**

```sql
ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS latitude double precision;
ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS longitude double precision;
ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS geofence_radius_m integer NOT NULL DEFAULT 500;
ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS active boolean NOT NULL DEFAULT true;
ALTER TABLE gate_stations ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1;
```

Add finite/range/radius validation and an index supporting active stations by site. Do not overwrite or backfill from partner coordinates as a hidden mutation.

- [ ] **Step 3: Implement admin-only service-site routes with audit/idempotency/version checks**

- [ ] **Step 4: Add the Profile & Settings card beneath Compliance**

The flow selects an authorized partner site, names the gate, captures or enters coordinates, previews the marker/radius, requires confirmation, and supports edit/deactivate/reactivate.

- [ ] **Step 5: Run migration replay, API/mobile tests, locale lint, and commit**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/gateLocations.test.ts && pnpm --filter @workspace/vndrly-mobile exec vitest run components/profile/GateLocationsCard.test.tsx app/__tests__/profile-settings.test.tsx && pnpm lint:i18n`

Commit: `feat: add admin gate location management`

### Task 7: Complete Ask V parity and exact-item routing

**Files:**
- Modify: `artifacts/api-server/src/assistant/work-hub-tool-runtime.ts`
- Modify: `artifacts/api-server/src/assistant/work-hub-tool-runtime.test.ts`
- Modify: `artifacts/api-server/src/assistant/tool-packs.ts`
- Modify: `artifacts/api-server/src/assistant/tool-registry.ts`
- Modify: `artifacts/api-server/src/assistant/deep-links.ts`
- Modify: `artifacts/api-server/src/routes/assistant.ts`
- Modify: `artifacts/vndrly-mobile/lib/askv-client-tools.ts`
- Modify: `artifacts/vndrly-mobile/components/AssistantMarkdown.tsx`
- Create: `docs/askv-work-hub-capability-matrix.md`

**Interfaces:**
- Consumes: capabilities and exact destinations from Tasks 1–6.
- Produces: executable asset tools, canonical family aliases, complete audit targets, and shared web/native destinations.

- [ ] **Step 1: Write failing runtime tests for registered asset tools**

```ts
expect(resolveExecutableWorkHubToolRequest("query_asset_custody", { ownerId })).toEqual(
  expect.objectContaining({ method: "GET", path: "/implementation-a/assets" }),
);
```

Add denied-role, prepared custody confirmation, unsupported action, and stale-version cases.

- [ ] **Step 2: Write family-alias and exact-destination tests**

Cover `files-notes`, `inventory`, `tasks-forms`, `implementation-exports`, settings/connections, Shift Notes, Profile & Settings, Gate, and Search result IDs/filter state.

- [ ] **Step 3: Make Implementation A tools executable through one metadata resolver**

Merge registered Work Hub and Implementation A metadata before authorization/execution. Unknown tools and unsupported destinations fail closed.

- [ ] **Step 4: Extend audit targets and add missing approved read/prepare/execute tools**

Record file, asset, station, channel, task, occurrence, and export identifiers. File tools distinguish reserve/upload/finalize. Gate-location and compliance mutations require exact-value confirmation. Shift authentication/transfer stays outside conversational execution.

- [ ] **Step 5: Add native exact-item navigation and capability matrix documentation**

For each approved UI control, record role, tool, confirmation, version/idempotency, audit target, web destination, native destination, and terminal states.

- [ ] **Step 6: Run assistant/API/mobile tests and commit**

Run: `pnpm --filter @workspace/api-server exec vitest run src/assistant/work-hub-tool-runtime.test.ts src/assistant/deep-link-markdown.test.ts src/assistant/assistant-smoke.test.ts && pnpm --filter @workspace/vndrly-mobile exec vitest run lib/askv-client-tools.test.ts components/AssistantMarkdown.test.tsx`

Commit: `feat: complete Ask V Work Hub and gate parity`

### Task 8: Accessibility, localization, and exact-tree verification

**Files:**
- Modify only files proven necessary by failing review/tests.
- Test: all focused and root gates.

**Interfaces:**
- Produces: a clean release candidate with preserved user data and no hidden failing gates.

- [ ] **Step 1: Run focused screen-reader, touch-target, keyboard/focus, contrast, and map-label review**

Verify every new button has an accessible name, touch targets meet platform minimums, disabled states are announced, and form errors associate with inputs.

- [ ] **Step 2: Run mandatory gates**

Run in order, retaining exact unchanged-tree evidence:

```text
pnpm lint:i18n
pnpm run typecheck
pnpm run test:web
pnpm run test:mobile
pnpm run test:api
pnpm run test:e2e
pnpm test
```

- [ ] **Step 3: Review migration safety and production guards**

Confirm every statement is additive/guarded and no command can drop, truncate, reset, reseed, or overwrite live rows.

- [ ] **Step 4: Request independent whole-branch functional and security review**

Fix root causes, add regression tests, and rerun only the affected focused gate plus any mandatory gate whose evidence became stale.

- [ ] **Step 5: Commit verification-only corrections**

Commit only if review required code/test changes; otherwise preserve the already verified tree.

### Task 9: Full ship through TestFlight submission

**Files:**
- Modify only release metadata required by the established workflows.

**Interfaces:**
- Consumes: exact green tree from Task 8.
- Produces: GitHub `main`, live web/API/migrations, production OTA, and submitted TestFlight build.

- [ ] **Step 1: Confirm remote-main parent and publish the branch plus non-force main advance**

Do not rewrite history. Reuse fresh exact-tree verification instead of repeating the full suite after an unchanged commit.

- [ ] **Step 2: Monitor web, API, OTA, and TestFlight workflows concurrently**

Dispatch API if path filters do not fire. Run the guarded gate-location migration during API deploy. If native/runtime changes make OTA ineligible, report that lane accurately and continue the required TestFlight build.

- [ ] **Step 3: Verify public surfaces**

Verify the public site, `/gate`, API health, authenticated Files & Inventory/Search/Exports role behavior, and an admin gate-location flow without creating production test data.

- [ ] **Step 4: Verify mobile release artifacts**

Record the production OTA update group when published and verify the native build is accepted by App Store Connect/TestFlight.

- [ ] **Step 5: Deliver release evidence**

Report commit, workflow outcomes, public verification, migration status, OTA status, TestFlight submission status, Apple processing state, and elapsed commit-to-live time. Do not call Apple processing complete until verified separately.
