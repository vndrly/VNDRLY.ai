# Web Multi-Role Gate Access Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make web users hold multiple operational roles, give MidCon Admins inherited access to every currently authorized site, and make Gate Mode, scheduling, gate creation, shift coverage, and Ask V use the same authorization rules.

**Architecture:** Add normalized direct-worker role and site-grant tables without removing the legacy `vendor_people.vendor_role` field. Centralize web/API authorization in one resolver that combines membership authority, direct-worker grants, managed-subcontractor grants, and current vendor/site eligibility; project a legacy primary role for unchanged mobile clients. Update the web Employees editor and Gate surfaces to consume the normalized response while leaving all mobile source and release lanes untouched.

**Tech Stack:** PostgreSQL, Drizzle ORM, Express 5, TypeScript 5.9, React 19, TanStack Query, Wouter, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-25-web-multi-role-gate-access-design.md`

## Global Constraints

- Web/API/database only; do not modify `artifacts/vndrly-mobile`, publish OTA, or start TestFlight.
- Database work is additive and guarded only; no DROP, TRUNCATE, reset, restore, or delete-and-reseed.
- Organization Admin remains membership authority and inherits all current and future active sites MidCon is authorized to service.
- Non-admin direct workers receive explicit site access; managed workers retain their existing site-scoped grants.
- Preserve `vendor_people.vendor_role` as a compatibility projection for current mobile clients.
- Use existing `ImagePill` for read-only role chips and `TogglePillButton` for interactive role controls.
- Every write is tenant-scoped, audited, idempotent where existing mutation contracts require it, and rejects stale or unauthorized site identifiers.
- Release only the working branch, `main`, web Publish, API Deploy, and guarded production migration; verify the public web surface and API health.

## Review Focus

- A vendor Admin whose legacy `vendorRole` is null, `admin`, `office`, or a gate role must still see Gate Mode and every currently authorized site.
- Removing a non-admin's gate role or site grant must revoke new actions immediately without deleting historical shifts or visits.
- A site assigned to the vendor but lacking current approved partner/vendor eligibility must not be inherited or manually grantable.
- Concurrent role/site edits must not create duplicate active grants or partially update one collection without the other.
- Current mobile sessions must keep their legacy role behavior and API shapes after the normalized web model is deployed.

---

### Task 1: Add normalized direct-worker grants and guarded migration

**Files:**
- Create: `lib/db/src/schema/vendorPersonAccess.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/package.json`
- Create: `artifacts/api-server/scripts/migrate-vendor-person-access.ts`
- Test: `artifacts/api-server/src/lib/vendor-person-access-migration.test.ts`

**Interfaces:**
- Produces: `vendorPersonOperationalRolesTable`, `vendorPersonSiteAccessTable`, and the guarded `migrate:vendor-person-access` command.
- Produces role values: `office | field_employee | foreman | gatekeeper | gate_supervisor`.

- [ ] **Step 1: Write the failing schema and migration contract test**

```ts
it("backfills both into office and field_employee without deleting the legacy role", async () => {
  const personId = await seedVendorPerson({ vendorRole: "both" });
  await runVendorPersonAccessMigration();
  expect(await activeRoles(personId)).toEqual(["field_employee", "office"]);
  expect(await legacyVendorRole(personId)).toBe("both");
});

it("is safe to run twice", async () => {
  await runVendorPersonAccessMigration();
  await runVendorPersonAccessMigration();
  expect(await duplicateActiveRoleCount()).toBe(0);
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the tables and migration do not exist**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/vendor-person-access-migration.test.ts`

- [ ] **Step 3: Define the additive Drizzle tables**

```ts
export const vendorPersonOperationalRolesTable = pgTable(
  "vendor_person_operational_roles",
  {
    id: serial("id").primaryKey(),
    vendorPeopleId: integer("vendor_people_id").notNull().references(() => vendorPeopleTable.id),
    role: text("role").$type<VendorPersonOperationalRole>().notNull(),
    isActive: boolean("is_active").notNull().default(true),
    grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("vendor_person_operational_roles_unique").on(table.vendorPeopleId, table.role)],
);

export const vendorPersonSiteAccessTable = pgTable(
  "vendor_person_site_access",
  {
    id: serial("id").primaryKey(),
    vendorPeopleId: integer("vendor_people_id").notNull().references(() => vendorPeopleTable.id),
    siteLocationId: integer("site_location_id").notNull().references(() => siteLocationsTable.id),
    isActive: boolean("is_active").notNull().default(true),
    grantedByUserId: integer("granted_by_user_id").references(() => usersTable.id),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("vendor_person_site_access_unique").on(table.vendorPeopleId, table.siteLocationId)],
);
```

- [ ] **Step 4: Implement the guarded SQL migration**

Use `CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`, and `INSERT ... ON CONFLICT ... DO UPDATE SET is_active = true`. Backfill recognized legacy roles only; map `both` to two rows and preserve every legacy column and row.

- [ ] **Step 5: Run migration tests, DB typecheck, and schema drift check**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/vendor-person-access-migration.test.ts && pnpm --filter @workspace/db run typecheck && pnpm --filter @workspace/db run check-schema`

- [ ] **Step 6: Commit the additive persistence layer**

```powershell
git add lib/db/src/schema artifacts/api-server/scripts artifacts/api-server/package.json artifacts/api-server/src/lib/vendor-person-access-migration.test.ts
git commit -m "feat: add direct worker role and site grants"
```

### Task 2: Centralize person, site, and Admin authority resolution

**Files:**
- Create: `artifacts/api-server/src/lib/vendor-person-access.ts`
- Create: `artifacts/api-server/src/lib/vendor-person-access.test.ts`
- Modify: `artifacts/api-server/src/lib/session.ts`
- Modify: `artifacts/api-server/src/routes/auth.ts`

**Interfaces:**
- Consumes: normalized tables from Task 1 and existing managed-subcontractor grants.
- Produces: `resolveVendorPersonAccess(session): Promise<VendorPersonAccess>`.
- Produces: `mayPerformGateAction(access, siteId, requiredRole): boolean`.

- [ ] **Step 1: Write failing resolver tests for Admin inheritance, explicit non-admin access, revocation, ineligible sites, and legacy projection**

```ts
it("gives vendor admins every currently eligible assigned site", async () => {
  const access = await resolveVendorPersonAccess(adminSession);
  expect(access.isVendorAdmin).toBe(true);
  expect(access.siteScope.kind).toBe("all_authorized");
  expect(access.siteIds).toEqual([bigCsDeepId, flywheelSpurId]);
});

it("requires both a role and an explicit active site grant for a direct non-admin", async () => {
  expect(mayPerformGateAction(gatekeeperAtBigCsDeep, bigCsDeepId, "gatekeeper")).toBe(true);
  expect(mayPerformGateAction(gatekeeperAtBigCsDeep, flywheelSpurId, "gatekeeper")).toBe(false);
});
```

- [ ] **Step 2: Run the resolver test and verify the module is missing**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/vendor-person-access.test.ts`

- [ ] **Step 3: Implement the normalized access type and resolver**

```ts
export type VendorPersonAccess = {
  vendorId: number;
  vendorPeopleId: number | null;
  isVendorAdmin: boolean;
  operationalRoles: VendorPersonOperationalRole[];
  siteScope: { kind: "all_authorized" } | { kind: "selected"; siteIds: number[] };
  siteIds: number[];
  legacyVendorRole: string | null;
};

export function mayPerformGateAction(
  access: VendorPersonAccess,
  siteId: number,
  requiredRole: "gatekeeper" | "gate_supervisor",
): boolean {
  return access.isVendorAdmin ||
    (access.operationalRoles.includes(requiredRole) && access.siteIds.includes(siteId));
}
```

Admin site inheritance must intersect active `site_work_assignments`, active visible sites, and the current approved partner/vendor relationship. Managed worker resolution must remain site-grant based.

- [ ] **Step 4: Project normalized roles into the authenticated web response without removing legacy fields**

Add `operationalRoles`, `gateSiteAccess`, and `gateSiteAccessMode` to the web session payload while retaining `vendorRole`. Do not require these new fields from current mobile clients.

- [ ] **Step 5: Run resolver, auth, session, and company-isolation tests**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/vendor-person-access.test.ts src/routes/auth.test.ts src/routes/company-isolation.test.ts`

- [ ] **Step 6: Commit centralized authorization**

```powershell
git add artifacts/api-server/src/lib/vendor-person-access.ts artifacts/api-server/src/lib/vendor-person-access.test.ts artifacts/api-server/src/lib/session.ts artifacts/api-server/src/routes/auth.ts
git commit -m "feat: centralize vendor person access"
```

### Task 3: Expose atomic employee role and site-access management APIs

**Files:**
- Modify: `artifacts/api-server/src/routes/fieldEmployees.ts`
- Modify: `artifacts/api-server/src/lib/vendor-people-management.ts`
- Test: `artifacts/api-server/src/routes/fieldEmployees-list.test.ts`
- Test: `artifacts/api-server/src/routes/fieldEmployees-mutations.test.ts`

**Interfaces:**
- Consumes: `resolveVendorPersonAccess` and normalized tables.
- Produces: employee response fields `operationalRoles`, `siteAccess`, `siteAccessMode`, `jobResponsibilities`.
- Produces: `PUT /api/field-employees/:id/access` accepting `{ operationalRoles, siteLocationIds }`.

- [ ] **Step 1: Write failing list and mutation tests**

```ts
expect(john).toMatchObject({
  operationalRoles: ["office", "field_employee", "gatekeeper", "gate_supervisor"],
  siteAccessMode: "all_authorized",
  siteAccess: [],
});

await request(app).put(`/api/field-employees/${workerId}/access`).send({
  operationalRoles: ["gatekeeper", "gate_supervisor"],
  siteLocationIds: [bigCsDeepId],
}).expect(200);
```

- [ ] **Step 2: Run the focused API tests and verify the new response and route fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/fieldEmployees-list.test.ts src/routes/fieldEmployees-mutations.test.ts`

- [ ] **Step 3: Implement one transaction for role and site replacement**

Validate role values, person ownership, active vendor/site eligibility, and Admin authority first. Upsert requested grants active and mark omitted grants inactive in the same transaction. Reject attempts to persist per-site rows for an Admin because Admin access is inherited.

- [ ] **Step 4: Preserve the legacy role projection**

Choose the legacy projection deterministically for unchanged consumers: `both` for Office plus Field Employee, otherwise Gate Supervisor, Gatekeeper, Foreman, Field Employee, Office in that order. Membership Admin remains authoritative and is never derived from an operational role.

- [ ] **Step 5: Add race, duplicate, cross-company, revoked-site, and invalid-role tests**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/fieldEmployees-list.test.ts src/routes/fieldEmployees-mutations.test.ts`

- [ ] **Step 6: Commit employee access APIs**

```powershell
git add artifacts/api-server/src/routes/fieldEmployees.ts artifacts/api-server/src/lib/vendor-people-management.ts artifacts/api-server/src/routes/fieldEmployees-list.test.ts artifacts/api-server/src/routes/fieldEmployees-mutations.test.ts
git commit -m "feat: manage employee roles and site access"
```

### Task 4: Replace the web Employees single-role editor with role and site controls

**Files:**
- Modify: `artifacts/vndrly/src/pages/field-employees.tsx`
- Create: `artifacts/vndrly/src/components/employee-access-editor.tsx`
- Test: `artifacts/vndrly/src/pages/field-employees.access.test.tsx`

**Interfaces:**
- Consumes: Task 3 employee fields and access mutation.
- Produces: `EmployeeAccessEditor` with role toggles and eligible-site selection.

- [ ] **Step 1: Write the failing UI tests**

```tsx
expect(screen.getAllByText(/Admin|Office|Field Employee|Gatekeeper|Gate Supervisor/)).toHaveLength(5);
await user.click(screen.getByRole("button", { name: "Gate Supervisor" }));
await user.click(screen.getByRole("checkbox", { name: "Big C's Deep" }));
await user.click(screen.getByRole("button", { name: "Save access" }));
expect(updateAccess).toHaveBeenCalledWith(expect.objectContaining({
  operationalRoles: expect.arrayContaining(["gate_supervisor"]),
  siteLocationIds: [bigCsDeepId],
}));
```

- [ ] **Step 2: Run the focused web test and verify the current single Select fails**

Run: `pnpm --filter @workspace/vndrly exec vitest run src/pages/field-employees.access.test.tsx`

- [ ] **Step 3: Render every assigned role as a separate `ImagePill`**

Render membership Admin alongside normalized operational roles. Rename the old company `roles` field to **Job responsibilities** and do not use it for authorization.

- [ ] **Step 4: Implement the role and site editor with `TogglePillButton`**

Admins display a read-only **All authorized sites** state. Non-admins can select only sites returned by the eligible-site API. Gatekeeper and Gate Supervisor remain independent toggles and may both be active.

- [ ] **Step 5: Test keyboard access, save failure rollback, Admin inheritance display, and four-role rendering**

Run: `pnpm --filter @workspace/vndrly exec vitest run src/pages/field-employees.access.test.tsx`

- [ ] **Step 6: Commit the Employees web experience**

```powershell
git add artifacts/vndrly/src/pages/field-employees.tsx artifacts/vndrly/src/components/employee-access-editor.tsx artifacts/vndrly/src/pages/field-employees.access.test.tsx
git commit -m "feat: add web multi-role employee editor"
```

### Task 5: Make Gate Mode and gate-site APIs use centralized access

**Files:**
- Modify: `artifacts/api-server/src/lib/gate-ops-access.ts`
- Modify: `artifacts/api-server/src/routes/visits.ts`
- Modify: `artifacts/api-server/src/routes/gateLocations.ts`
- Modify: `artifacts/vndrly/src/lib/gate-ops-nav.ts`
- Modify: `artifacts/vndrly/src/components/layout.tsx`
- Test: `artifacts/api-server/src/lib/gate-ops-access.test.ts`
- Test: `artifacts/api-server/src/routes/visits.test.ts`
- Test: `artifacts/api-server/src/routes/gateLocations.test.ts`
- Test: `artifacts/vndrly/src/components/layout.gate-mode.test.tsx`

**Interfaces:**
- Consumes: `resolveVendorPersonAccess` from Task 2.
- Produces: one Gate Mode visibility/entry rule and Admin-aware assigned-sites response.

- [ ] **Step 1: Write failing regressions for the exact screenshot state**

```ts
it("shows Gate Mode to a membership Admin even when legacy vendorRole is admin", async () => {
  renderLayout({ membershipRole: "admin", vendorRole: "admin", operationalRoles: [] });
  expect(await screen.findByText("Gate Mode")).toBeVisible();
});

it("returns every eligible assigned site to a vendor Admin", async () => {
  const response = await adminAgent.get("/api/visits/gate/assigned-sites").expect(200);
  expect(response.body.map((site: { id: number }) => site.id)).toEqual([bigCsDeepId, flywheelSpurId]);
});
```

- [ ] **Step 2: Run the gate access tests and verify current single-role checks fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/gate-ops-access.test.ts src/routes/visits.test.ts src/routes/gateLocations.test.ts && pnpm --filter @workspace/vndrly exec vitest run src/components/layout.gate-mode.test.tsx`

- [ ] **Step 3: Replace `vendorRole` gates with the centralized resolver**

`/visits/gate/enabled`, `/visits/gate/assigned-sites`, gate-location create/update, and Gate Mode entry must all accept membership Admin. Non-admin Gatekeeper and Gate Supervisor sessions must still require a matching active role and selected eligible site.

- [ ] **Step 4: Remove the navigation inconsistency**

Make `withGateLogNav` honor its gate-enabled argument and derive both Gate Log and Gate Mode from one resolved access response. A failed access request must not silently show one item and hide the other.

- [ ] **Step 5: Run exact Admin, role-combination, revoked-site, and cross-vendor tests**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/gate-ops-access.test.ts src/routes/visits.test.ts src/routes/gateLocations.test.ts && pnpm --filter @workspace/vndrly exec vitest run src/components/layout.gate-mode.test.tsx`

- [ ] **Step 6: Commit Gate Mode and site inheritance**

```powershell
git add artifacts/api-server/src/lib/gate-ops-access.ts artifacts/api-server/src/routes/visits.ts artifacts/api-server/src/routes/gateLocations.ts artifacts/vndrly/src/lib/gate-ops-nav.ts artifacts/vndrly/src/components/layout.tsx artifacts/api-server/src/lib/gate-ops-access.test.ts artifacts/api-server/src/routes/visits.test.ts artifacts/api-server/src/routes/gateLocations.test.ts artifacts/vndrly/src/components/layout.gate-mode.test.tsx
git commit -m "fix: honor admin access across gate mode"
```

### Task 6: Apply the same authority to scheduling and open-shift coverage

**Files:**
- Modify: `artifacts/api-server/src/routes/workHubScheduling.ts`
- Modify: `artifacts/api-server/src/routes/workHubOperations.ts`
- Modify: `artifacts/api-server/src/services/gate-duty.ts`
- Modify: `artifacts/api-server/src/services/gate-change-over.ts`
- Test: `artifacts/api-server/src/routes/workHubOperations.guardrails.test.ts`
- Test: `artifacts/api-server/src/services/gate-duty.test.ts`
- Test: `artifacts/api-server/src/services/gate-change-over-access.test.ts`

**Interfaces:**
- Consumes: centralized role/site authority.
- Produces: consistent Admin, Gate Supervisor, and Gatekeeper scheduling/coverage rules.

- [ ] **Step 1: Write failing tests for Admin schedule management and uncovered-shift coverage**

```ts
it("lets an Admin schedule eligible direct and managed gate workers", async () => {
  await scheduleGateShift(adminSession, { siteId: bigCsDeepId, workerId: managedWorkerId });
  expect(await activeGateShiftCount(bigCsDeepId, managedWorkerId)).toBe(1);
});

it("lets a Gate Supervisor manage only selected sites and a Gatekeeper cover only an open eligible shift", async () => {
  await expect(scheduleGateShift(supervisorAtBigCsDeep, { siteId: flywheelSpurId })).rejects.toMatchObject({ status: 403 });
  await expect(coverOpenShift(gatekeeperAtBigCsDeep, openBigCsDeepShift)).resolves.toBeDefined();
});
```

- [ ] **Step 2: Run focused scheduling tests and verify current literal-role checks fail**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/workHubOperations.guardrails.test.ts src/services/gate-duty.test.ts src/services/gate-change-over-access.test.ts`

- [ ] **Step 3: Replace literal `session.vendorRole` comparisons with resolver decisions**

Keep scheduling and coverage semantics distinct: Admin and Gate Supervisor may manage schedules at authorized sites; Gatekeeper may accept an uncovered shift only at a selected authorized site; historical records remain readable after later revocation.

- [ ] **Step 4: Test direct workers, NewTek managed workers, inactive sites, stale grants, and cross-company IDs**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/workHubOperations.guardrails.test.ts src/services/gate-duty.test.ts src/services/gate-change-over-access.test.ts`

- [ ] **Step 5: Commit scheduling authority parity**

```powershell
git add artifacts/api-server/src/routes/workHubScheduling.ts artifacts/api-server/src/routes/workHubOperations.ts artifacts/api-server/src/services/gate-duty.ts artifacts/api-server/src/services/gate-change-over.ts artifacts/api-server/src/routes/workHubOperations.guardrails.test.ts artifacts/api-server/src/services/gate-duty.test.ts artifacts/api-server/src/services/gate-change-over-access.test.ts
git commit -m "fix: align gate scheduling with multi-role access"
```

### Task 7: Give Ask V the same role and site authority

**Files:**
- Modify: `artifacts/api-server/src/assistant/change-over-tools.ts`
- Modify: `artifacts/api-server/src/assistant/gate-intent.ts`
- Modify: `artifacts/api-server/src/assistant/gate-toolbox-manifest.ts`
- Modify: `artifacts/api-server/src/assistant/write-tools.ts`
- Test: `artifacts/api-server/src/assistant/change-over-tools.test.ts`
- Test: `artifacts/api-server/src/assistant/gate-toolbox-manifest.test.ts`
- Test: `artifacts/api-server/src/assistant/tool-routing.test.ts`

**Interfaces:**
- Consumes: centralized access resolver and existing confirmation/idempotency rules.
- Produces: Ask V gate tools that authorize exactly like the web routes.

- [ ] **Step 1: Write failing Ask V parity tests**

```ts
it("allows a vendor Admin to create a gate and manage an eligible site schedule", async () => {
  expect(await gateToolboxFor(adminSession)).toEqual(expect.arrayContaining(["create_gate_location", "schedule_gate_shift"]));
});

it("does not expose a site outside the actor's resolved access", async () => {
  await expect(runGateTool(gatekeeperAtBigCsDeep, "cover_gate_shift", { siteId: flywheelSpurId })).rejects.toMatchObject({ code: "forbidden" });
});
```

- [ ] **Step 2: Run focused assistant tests and verify legacy role gating fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/assistant/change-over-tools.test.ts src/assistant/gate-toolbox-manifest.test.ts src/assistant/tool-routing.test.ts`

- [ ] **Step 3: Route all gate tool availability and execution through the central resolver**

Preserve confirmation, audit, idempotency, and deep-link behavior. Tool discovery and tool execution must consult the same access object so Ask V cannot advertise an action it later rejects for a properly authorized Admin.

- [ ] **Step 4: Test Admin, Gate Supervisor, Gatekeeper, managed worker, revoked access, and unauthorized site cases**

Run: `pnpm --filter @workspace/api-server exec vitest run src/assistant/change-over-tools.test.ts src/assistant/gate-toolbox-manifest.test.ts src/assistant/tool-routing.test.ts`

- [ ] **Step 5: Commit Ask V authorization parity**

```powershell
git add artifacts/api-server/src/assistant/change-over-tools.ts artifacts/api-server/src/assistant/gate-intent.ts artifacts/api-server/src/assistant/gate-toolbox-manifest.ts artifacts/api-server/src/assistant/write-tools.ts artifacts/api-server/src/assistant/change-over-tools.test.ts artifacts/api-server/src/assistant/gate-toolbox-manifest.test.ts artifacts/api-server/src/assistant/tool-routing.test.ts
git commit -m "fix: align Ask V with gate access authority"
```

### Task 8: Verify compatibility, full gates, and live web behavior

**Files:**
- Modify as needed only to fix demonstrated failures in files already in scope.
- Test: existing root, web, API, i18n, and e2e suites.

**Interfaces:**
- Consumes: Tasks 1-7 unchanged release tree.
- Produces: verified web/API release candidate and evidence.

- [ ] **Step 1: Run focused role, gate, scheduling, employee, and Ask V suites**

Run all focused commands from Tasks 1-7 on the unchanged tree.

- [ ] **Step 2: Run mandatory repository gates**

Run: `pnpm lint:i18n && pnpm run typecheck && pnpm run test:web && pnpm run test:api && pnpm test`

- [ ] **Step 3: Verify no mobile source changed**

Run: `git diff --name-only origin/main...HEAD | Select-String '^artifacts/vndrly-mobile/'`

Expected: no output.

- [ ] **Step 4: Start the local web/API preview and exercise the exact John Admin flow**

Verify Employees renders multiple role pills; editing John can add Gatekeeper and Gate Supervisor; Admin shows **All authorized sites**; Gate Mode appears; Big C's Deep and Flywheel Energy Spur are available; gate creation, scheduling, open-shift coverage, and Ask V authorization all succeed at eligible sites and fail closed elsewhere.

- [ ] **Step 5: Commit only demonstrated final corrections**

```powershell
git add -u
git commit -m "test: close web gate access regressions"
```

Skip this commit when verification required no corrections.

### Task 9: Publish the web/API-only release and verify production

**Files:**
- No new product files; release uses `.github/workflows/publish.yml` and `.github/workflows/deploy-api.yml`.

**Interfaces:**
- Consumes: exact verified commit from Task 8.
- Produces: updated `main`, live web, live API, and applied guarded production migration.

- [ ] **Step 1: Confirm remote `main` parent and publish without force**

Advance `main` from the verified branch in one non-force pass using the configured GitHub integration. Do not rewrite history.

- [ ] **Step 2: Monitor web Publish and API Deploy concurrently**

If the API path filter does not start, dispatch `.github/workflows/deploy-api.yml`. The API deploy must execute `migrate:vendor-person-access` before serving the new code.

- [ ] **Step 3: Verify public health and authenticated Admin behavior**

Verify `https://vndrly.ai/api/healthz`, then verify the production Employees page and John Admin Gate Mode flow: multiple role pills, All authorized sites, Gate Mode visible, eligible gates available, and unauthorized sites excluded.

- [ ] **Step 4: Confirm excluded release lanes stayed untouched**

Confirm no mobile OTA workflow and no TestFlight workflow were dispatched for this web-only release.

- [ ] **Step 5: Report the release evidence**

Report the commit, branch/main status, migration result, web workflow, API workflow, public health, authenticated Gate Mode verification, and elapsed commit-to-live time.
