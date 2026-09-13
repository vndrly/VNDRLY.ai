# Implementation A — Unified Field Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver one coordinated VNDRLY release that adds vendor-managed subcontractors, secure employee activation, complete Ask V capability parity, workforce scheduling and escalation, asset custody, automated Gate/site presence, trips and ETA, incident awareness, operations displays, entitlements, and company-sponsored worker subscriptions across web, iPhone, and iPad.

**Architecture:** Extend the existing Work Hub relational modules and event stream with focused domain services. Current-state tables remain authoritative; append-only events provide audit, real-time updates, offline replay, and projections. Ask V presents one continuous assistant while routing internally through permission-filtered capability families. All schema changes are additive and risky/native behavior is feature-gated.

**Tech Stack:** TypeScript 5.9, Node.js 24, Express 5, PostgreSQL/Supabase, Drizzle ORM, Zod, React 19/Vite, TanStack Query, Expo/React Native, Expo Modules/Swift SafetyKit bridge, Mapbox, Server-Sent Events, Vitest, Playwright, pnpm.

**Spec:** `docs/plans/2026-09-13-implementation-a-design.md`

## Global Constraints

- Ship as one coordinated release; internal stages must remain independently testable.
- No destructive database operation. Every production migration is additive and guarded with `IF NOT EXISTS` where applicable.
- Do not rotate canonical demo credentials or match demo users by numeric id.
- Ask V may exercise only the authority of the authenticated identity, active membership, sponsorship, site/crew assignment, and trusted device.
- Voice is an input method, never identity proof.
- No reusable or temporary password may be emailed, displayed, or logged during employee activation.
- No third-party crash-detection service; SafetyKit is gated and manual incident reporting works everywhere.
- VNDRLY never silently contacts emergency services based on inference.
- Raw meeting audio/video expires after 30 days unless a record-specific hold suspends deletion.
- New English copy must ship with Spanish parity in the same task.
- Every mutating endpoint accepts or derives a durable operation id and produces an audit event.
- Every task uses test-first implementation and commits only its own files.
- Before full ship, obtain fresh accessibility, security, and release reviews and resolve every blocking finding.
- `full ship` means commit, non-force push/main advancement, web publication, API deploy with guarded Supabase migrations, OTA compatibility decision, and TestFlight submission.

---

## File structure and ownership

### Shared data and contracts

- `lib/db/src/schema/managedSubcontractors.ts` — managed companies, sponsorships, scoped role grants, and conversion history.
- `lib/db/src/schema/accountInvitations.ts` — hashed single-use activation tokens and delivery/claim lifecycle.
- `lib/db/src/schema/workParticipationAuthorizations.ts` — versioned sponsor-specific consent/authorization facts.
- `lib/db/src/schema/workerSubscriptions.ts` — company-paid seat plan and lifecycle.
- `lib/db/src/schema/workforceCoverage.ts` — staffing requirements, vacancies, acknowledgements, and escalation state.
- `lib/db/src/schema/assets.ts` — assets, aliases, category policy, custody, condition evidence, holds, and merges.
- `lib/db/src/schema/fieldTrips.ts` — active trips, vehicle association, tracking status, and Gate crossing candidates.
- `lib/db/src/schema/safetyResponse.ts` — escalation chains, acknowledgements, responders, and evidence holds.
- `lib/db/src/schema/operationsDisplays.ts` — display identity, view grants, monitor names, and room-device state.
- `lib/db/src/schema/capabilityFlags.ts` — organization/site rollout switches and emergency disables.
- `lib/api-zod/src/implementation-a/` — request/response and event schemas shared by API, web, and mobile.

### API services and routes

- `artifacts/api-server/src/lib/authority-matrix.ts` — one policy evaluator for UI, API, streams, exports, and Ask V.
- `artifacts/api-server/src/lib/operation-ledger.ts` — idempotent command receipt and conflict outcome helpers.
- `artifacts/api-server/src/services/managed-subcontractors.ts` — managed organization and sponsorship lifecycle.
- `artifacts/api-server/src/services/account-invitations.ts` — activation issuance, resend, revoke, claim, and status.
- `artifacts/api-server/src/services/workforce-coverage.ts` — acknowledgements, vacancy detection, reminders, and escalation.
- `artifacts/api-server/src/services/assets.ts` — catalog, aliases, custody, provisional matching, merge, and holds.
- `artifacts/api-server/src/services/field-trips.ts` — active trip, ETA, location visibility, and crossing reconciliation.
- `artifacts/api-server/src/services/safety-response.ts` — incident creation, company escalation, acknowledgement, and closure.
- `artifacts/api-server/src/services/worker-subscriptions.ts` — seat activation and lifecycle.
- `artifacts/api-server/src/services/operations-health.ts` — degraded dependency and backlog summaries.
- `artifacts/api-server/src/routes/implementationA*.ts` — thin HTTP boundaries grouped by domain.

### Ask V

- `artifacts/api-server/src/assistant/capabilities/` — focused tool definitions and executors.
- `artifacts/api-server/src/assistant/capability-context.ts` — unified worker/shift/site/vehicle/communication context.
- `artifacts/api-server/src/assistant/capability-parity.ts` — capability-to-UI-route registry and parity assertion.
- Existing `tool-registry.ts`, `tool-packs.ts`, `work-hub-tools.ts`, and `work-hub-tool-runtime.ts` — register and route the new capabilities.

### Web and mobile

- `artifacts/vndrly/src/components/implementation-a/` — desktop Work Hub views and in-place confirmation surfaces.
- `artifacts/vndrly-mobile/components/implementation-a/` — native equivalents.
- Existing Work Hub page/module files — route and compose the new views.
- Existing native Work Hub queue — add domain command codecs and conflict handling.
- `artifacts/vndrly-mobile/modules/vndrly-safetykit/` — first-party, entitlement-gated SafetyKit bridge.

---

### Task 1: Shared contracts, feature flags, and operation ledger

**Files:**

- Create: `lib/api-zod/src/implementation-a/common.ts`
- Create: `lib/api-zod/src/implementation-a/events.ts`
- Create: `lib/api-zod/src/implementation-a/index.ts`
- Create: `lib/db/src/schema/capabilityFlags.ts`
- Create: `artifacts/api-server/src/lib/operation-ledger.ts`
- Test: `lib/api-zod/src/implementation-a/common.test.ts`
- Test: `artifacts/api-server/src/lib/operation-ledger.test.ts`
- Modify: `lib/api-zod/src/index.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**

- Produces: `ImplementationAOwner`, `ScopedActor`, `OperationEnvelope<T>`, `OperationReceipt<T>`, `ImplementationAEvent`, `CapabilityFlagName`, `executeIdempotentOperation<T>()`.

- [ ] **Step 1: Write failing contract tests**

```ts
expect(
  OperationEnvelopeSchema.parse({
    operationId: crypto.randomUUID(),
    occurredAt: new Date().toISOString(),
    deviceId: "device-1",
    payload: { value: 1 },
  }).payload,
).toEqual({ value: 1 });
expect(() =>
  OperationEnvelopeSchema.parse({ operationId: "not-a-uuid", payload: {} }),
).toThrow();
```

- [ ] **Step 2: Run the tests and confirm the missing contracts fail**

Run: `pnpm --filter @workspace/api-zod test -- implementation-a/common.test.ts`
Expected: FAIL because `OperationEnvelopeSchema` is not exported.

- [ ] **Step 3: Define the shared command and event types**

```ts
export const OperationEnvelopeSchema = z.object({
  operationId: z.string().uuid(),
  occurredAt: z.string().datetime(),
  deviceId: z.string().min(1),
  expectedVersion: z.number().int().nonnegative().optional(),
  payload: z.unknown(),
});
export type OperationReceipt<T> = {
  operationId: string;
  status: "applied" | "duplicate" | "conflict" | "queued";
  resource: T | null;
  authoritativeVersion: number | null;
};
```

- [ ] **Step 4: Add capability flags and idempotent execution**

Implement an additive `capability_flags` table keyed by owner type/id, site id, and flag name. Implement `executeIdempotentOperation` using the existing Work Hub operation/event storage so repeated operation ids return the original receipt and never reapply side effects.

- [ ] **Step 5: Run focused tests and typecheck**

Run: `pnpm --filter @workspace/api-zod test -- implementation-a/common.test.ts && pnpm --filter @workspace/api-server test:no-isolated-db -- operation-ledger.test.ts && pnpm run typecheck:libs`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/api-zod/src/implementation-a lib/api-zod/src/index.ts lib/db/src/schema/capabilityFlags.ts lib/db/src/schema/index.ts artifacts/api-server/src/lib/operation-ledger.ts artifacts/api-server/src/lib/operation-ledger.test.ts
git commit -m "feat(platform): add implementation A command contracts"
```

### Task 2: Managed subcontractor organizations and portable sponsorships

**Files:**

- Create: `lib/db/src/schema/managedSubcontractors.ts`
- Create: `lib/api-zod/src/implementation-a/sponsorships.ts`
- Create: `artifacts/api-server/src/services/managed-subcontractors.ts`
- Create: `artifacts/api-server/src/routes/implementationASponsorships.ts`
- Test: `artifacts/api-server/src/routes/implementationASponsorships.test.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**

- Consumes: `OperationEnvelope<T>`, `executeIdempotentOperation<T>()`.
- Produces: `createManagedOrganization`, `inviteManagedWorker`, `grantSponsoredRole`, `claimManagedOrganization`, `listVisibleSponsorships`.

- [ ] **Step 1: Write failing isolation and conversion tests**

```ts
it("keeps concurrent sponsorship records private to each sponsor", async () => {
  const identity = await fixtures.portableWorker();
  await sponsor(identity, midcon);
  await sponsor(identity, secondVendor);
  expect(await visibleSponsorships(midconAdmin, identity)).toHaveLength(1);
  expect(await visibleSponsorships(secondAdmin, identity)).toHaveLength(1);
});

it("claims a managed company without replacing worker identities", async () => {
  const before = await managedWorkerIds(newTekManaged.id);
  await claimAsVendor(newTekManaged.id, verifiedRepresentative.id);
  expect(await vendorWorkerIds(newTekVendor.id)).toEqual(before);
});
```

- [ ] **Step 2: Run the focused API test**

Run: `pnpm --filter @workspace/api-server test -- implementationASponsorships.test.ts`
Expected: FAIL because the schema and routes do not exist.

- [ ] **Step 3: Add additive sponsorship tables**

Create tables for managed organizations, sponsor relationships, worker sponsorships, scoped grants, and claim history. Enforce unique active sponsorship per `(worker_user_id, sponsor_vendor_id, managed_organization_id)` and retain historical rows through status changes.

- [ ] **Step 4: Implement service and thin routes**

Use sponsor-vendor authorization on every mutation. Permit `managed_company_manager`, `gatekeeper`, `gate_supervisor`, `foreman`, `asset_manager`, and `safety_manager` grants with site/crew scope. Reject partner sponsorship during this release while preserving the owner-type contract.

- [ ] **Step 5: Run focused tests and schema drift check**

Run: `pnpm --filter @workspace/api-server test -- implementationASponsorships.test.ts`
Expected: PASS, including cross-sponsor denial and identity-preserving conversion.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/managedSubcontractors.ts lib/db/src/schema/index.ts lib/api-zod/src/implementation-a/sponsorships.ts artifacts/api-server/src/services/managed-subcontractors.ts artifacts/api-server/src/routes/implementationASponsorships.ts artifacts/api-server/src/routes/implementationASponsorships.test.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(workforce): add managed subcontractor sponsorships"
```

### Task 3: Secure employee activation and onboarding authorization

**Files:**

- Create: `lib/db/src/schema/accountInvitations.ts`
- Create: `lib/db/src/schema/workParticipationAuthorizations.ts`
- Create: `lib/api-zod/src/implementation-a/invitations.ts`
- Create: `artifacts/api-server/src/services/account-invitations.ts`
- Create: `artifacts/api-server/src/routes/implementationAInvitations.ts`
- Create: `artifacts/vndrly/src/pages/activate-account.tsx`
- Create: `artifacts/vndrly-mobile/app/activate-account.tsx`
- Test: `artifacts/api-server/src/routes/implementationAInvitations.test.ts`
- Test: `artifacts/vndrly/src/pages/activate-account.test.tsx`
- Test: `artifacts/vndrly-mobile/app/__tests__/activate-account.test.tsx`
- Modify: `artifacts/api-server/src/lib/sendgrid.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: web and mobile route configuration

**Interfaces:**

- Consumes: sponsorship scope and `executeIdempotentOperation`.
- Produces: `issueAccountInvitation`, `resendAccountInvitation`, `revokeAccountInvitation`, `claimAccountInvitation`, `getInvitationStatus`, `sendAccountInvitationEmail`.

- [ ] **Step 1: Write failing token security tests**

```ts
it("stores only the activation token hash", async () => {
  const issued = await issueInvitation(input);
  const row = await invitationRow(issued.invitationId);
  expect(row.tokenHash).toMatch(/^[a-f0-9]{64}$/);
  expect(JSON.stringify(row)).not.toContain(issued.rawToken);
});

it("invalidates the old link when resent", async () => {
  const first = await issueInvitation(input);
  const second = await resendInvitation(first.invitationId);
  expect(await validate(first.rawToken)).toBe(false);
  expect(await validate(second.rawToken)).toBe(true);
});
```

- [ ] **Step 2: Verify the security tests fail**

Run: `pnpm --filter @workspace/api-server test -- implementationAInvitations.test.ts`
Expected: FAIL because invitation issuance is missing.

- [ ] **Step 3: Implement invitation lifecycle**

Generate 32 random bytes, persist SHA-256 only, expire after 24 hours, permit single use, invalidate older links on resend, and increment session version on claim. Create the user with an unusable random password hash that is never returned; replace it only when the invitee sets the first password.

- [ ] **Step 4: Implement safe email and activation screens**

Email the username, sponsor name, expiration, and HTTPS activation link. Never include a password. The activation screen validates the token, collects the first password, records the versioned Work Participation Authorization, and continues into existing employee onboarding in place.

- [ ] **Step 5: Add delivery and enumeration tests**

Assert `pending`, `delivered`, `claimed`, `expired`, `revoked`, and `delivery_failed` states; public validation must not reveal whether an unrelated username exists. Assert logs and API responses do not contain raw tokens or passwords.

- [ ] **Step 6: Run API, web, mobile, and locale tests**

Run: `pnpm --filter @workspace/api-server test -- implementationAInvitations.test.ts && pnpm --filter @workspace/vndrly test -- activate-account.test.tsx && pnpm --filter @workspace/vndrly-mobile test -- activate-account.test.tsx && pnpm lint:i18n`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/schema/accountInvitations.ts lib/db/src/schema/workParticipationAuthorizations.ts lib/db/src/schema/index.ts lib/api-zod/src/implementation-a/invitations.ts artifacts/api-server/src/services/account-invitations.ts artifacts/api-server/src/routes/implementationAInvitations.ts artifacts/api-server/src/routes/implementationAInvitations.test.ts artifacts/api-server/src/lib/sendgrid.ts artifacts/vndrly/src/pages/activate-account.tsx artifacts/vndrly/src/pages/activate-account.test.tsx artifacts/vndrly-mobile/app/activate-account.tsx artifacts/vndrly-mobile/app/__tests__/activate-account.test.tsx
git commit -m "feat(onboarding): add secure employee activation links"
```

### Task 4: Central authority matrix and cross-company boundaries

**Files:**

- Create: `artifacts/api-server/src/lib/authority-matrix.ts`
- Create: `artifacts/api-server/src/lib/authority-matrix.test.ts`
- Create: `lib/api-zod/src/implementation-a/authority.ts`
- Modify: `artifacts/api-server/src/assistant/tool-registry.ts`
- Modify: Work Hub SSE authorization helpers
- Modify: Work Hub export authorization helpers

**Interfaces:**

- Produces: `authorizeCapability(context, capability, resource): AuthorityDecision`, `AuthorityDecision = { allowed; reasonCode; confirmation; visibleFields }`.

- [ ] **Step 1: Encode the approved matrix as table-driven failing tests**

```ts
it.each([
  ["newtek_worker", "midcon_to_flywheel_directory", false],
  ["newtek_worker_explicit_invitee", "shared_meeting", true],
  ["gate_supervisor", "assigned_site_schedule", true],
  ["gate_supervisor", "company_pay_rates", false],
  ["operations_display", "change_schedule", false],
])("evaluates %s for %s", async (actor, capability, allowed) => {
  expect((await authorizeFixture(actor, capability)).allowed).toBe(allowed);
});
```

- [ ] **Step 2: Run and observe missing evaluator failure**

Run: `pnpm --filter @workspace/api-server test:no-isolated-db -- authority-matrix.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement one evaluator**

Resolve actor, membership, sponsorship, assignment, relationship, explicit invitation, resource owner, and site scope. Return stable denial codes and field filters. Do not duplicate policy logic inside Ask V executors or UI routes.

- [ ] **Step 4: Wire evaluator into Ask V, streams, and exports**

Ensure list queries filter before serialization, reconnect re-evaluates access, export rows use the same field mask, and explicit invitations grant only the referenced item.

- [ ] **Step 5: Run focused tests**

Run: `pnpm --filter @workspace/api-server test:no-isolated-db -- authority-matrix.test.ts workHubEvents.test.ts workHubExports.test.ts tool-registry.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/lib/authority-matrix.ts artifacts/api-server/src/lib/authority-matrix.test.ts lib/api-zod/src/implementation-a/authority.ts artifacts/api-server/src/assistant/tool-registry.ts artifacts/api-server/src/routes/workHubEvents.ts artifacts/api-server/src/routes/workHubExports.ts
git commit -m "feat(authz): centralize implementation A authority"
```

### Task 5: Workforce coverage, assignment acknowledgements, and escalation

**Files:**

- Create: `lib/db/src/schema/workforceCoverage.ts`
- Create: `lib/api-zod/src/implementation-a/workforce.ts`
- Create: `artifacts/api-server/src/services/workforce-coverage.ts`
- Create: `artifacts/api-server/src/routes/implementationAWorkforce.ts`
- Test: `artifacts/api-server/src/services/workforce-coverage.test.ts`
- Modify: `artifacts/api-server/src/routes/workHubScheduling.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**

- Produces: `assignShift`, `acknowledgeAssignment`, `evaluateCoverage`, `evaluateNoShow`, `escalateCoverage`, `reviewHours`.

- [ ] **Step 1: Write failing deadline, coverage, and guard tests**

```ts
expect(ackDeadline(assignedAt, shiftInTwoDays)).toEqual(
  addHours(assignedAt, 4),
);
expect(ackDeadline(assignedAt, shiftTomorrow)).toEqual(
  subHours(shiftTomorrow, 24),
);
expect(ackDeadline(assignedAt, shiftInTwoHours)).toEqual(
  addMinutes(assignedAt, 30),
);
expect(await assign(pausedWorker)).toMatchObject({
  allowed: false,
  code: "workforce.account_paused",
});
```

- [ ] **Step 2: Run the focused test**

Run: `pnpm --filter @workspace/api-server test -- workforce-coverage.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add coverage and acknowledgement state**

Store staffing requirements, vacancy origin, assignees, acknowledgement deadline/state, reminder receipts, escalation target/time, no-show state, and override reason. Use optimistic versions for schedule mutations.

- [ ] **Step 4: Implement approved rules**

Hard-block expired credentials, paused/terminated accounts, and overlaps. Warn for overtime/rest and require override authority plus reason. Notify at assignment, T-24h, T-1h, shift start, and +15 minutes. Escalate uncovered shifts using the approved 15-minute/one-hour/four-hour windows.

- [ ] **Step 5: Run scheduling regression tests**

Run: `pnpm --filter @workspace/api-server test -- workforce-coverage.test.ts workHubScheduling.test.ts crew-schedule-conflict.test.ts schedule-changed-notification.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/workforceCoverage.ts lib/db/src/schema/index.ts lib/api-zod/src/implementation-a/workforce.ts artifacts/api-server/src/services/workforce-coverage.ts artifacts/api-server/src/services/workforce-coverage.test.ts artifacts/api-server/src/routes/implementationAWorkforce.ts artifacts/api-server/src/routes/workHubScheduling.ts
git commit -m "feat(workforce): add coverage acknowledgement and escalation"
```

### Task 6: Reliable notification delivery and acknowledgemen

**Files:**

- Create: `artifacts/api-server/src/services/notification-delivery.ts`
- Create: `artifacts/api-server/src/services/notification-delivery.test.ts`
- Modify: `lib/db/src/schema/notifications.ts`
- Modify: `artifacts/api-server/src/routes/notifications.ts`
- Modify: notification worker entrypoin
- Modify: web and mobile notification link helpers

**Interfaces:**

- Produces: `deliverNotification`, `acknowledgeNotification`, `retryDueNotifications`, `escalateUnacknowledged`.

- [ ] **Step 1: Write failing retry and escalation tests**

```ts
it("bypasses quiet hours only for safety and shift-critical notices", async () => {
  expect(deliveryWindow(safetyNotice, quietHours).sendNow).toBe(true);
  expect(deliveryWindow(chatNotice, quietHours).sendNow).toBe(false);
});
```

- [ ] **Step 2: Run the focused tests**

Run: `pnpm --filter @workspace/api-server test -- notification-delivery.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add delivery receipts and escalation linkage**

Add delivery status, attempts, next attempt, acknowledgement, escalation policy/id, and final failure fields. Keep existing notification rows compatible.

- [ ] **Step 4: Implement retry policy**

Use bounded exponential retry, persistent acknowledgement for critical notices, stable deep links, and escalation to the configured chain. Expose final delivery failure to responsible admins.

- [ ] **Step 5: Run notification regressions**

Run: `pnpm --filter @workspace/api-server test -- notification-delivery.test.ts notifications.test.ts notifications-list-filter.test.ts && pnpm --filter @workspace/vndrly-mobile test -- notification-link.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/services/notification-delivery.ts artifacts/api-server/src/services/notification-delivery.test.ts lib/db/src/schema/notifications.ts artifacts/api-server/src/routes/notifications.ts artifacts/vndrly-mobile/lib/notification-link.ts artifacts/vndrly-mobile/lib/__tests__/notification-link.test.ts
git commit -m "feat(notifications): add reliable acknowledgement delivery"
```

### Task 7: Asset catalog, aliases, policy, and custody

**Files:**

- Create: `lib/db/src/schema/assets.ts`
- Create: `lib/api-zod/src/implementation-a/assets.ts`
- Create: `artifacts/api-server/src/services/assets.ts`
- Create: `artifacts/api-server/src/routes/implementationAAssets.ts`
- Test: `artifacts/api-server/src/services/assets.test.ts`
- Modify: `lib/db/src/schema/index.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`

**Interfaces:**

- Produces: `createAsset`, `findAsset`, `checkoutAsset`, `returnAsset`, `transferAsset`, `reportAssetCondition`, `placeAssetHold`, `mergeAssets`.

- [ ] **Step 1: Write failing asset identity and custody tests**

```ts
it("finds a vehicle by current or historical plate alias", async () => {
  expect(
    await findAsset({ kind: "plate", jurisdiction: "TX", value: "ABC123" }),
  ).toMatchObject({ vin: knownVin });
});
it("rejects simultaneous custody transfer with the stale version", async () => {
  await checkout(asset.id, workerA.id, 1);
  expect(await checkout(asset.id, workerB.id, 1)).toMatchObject({
    status: "conflict",
  });
});
```

- [ ] **Step 2: Run the focused tests**

Run: `pnpm --filter @workspace/api-server test -- assets.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add additive asset tables**

Create asset, alias, category policy, custody event, condition evidence, hold, merge, and attachment link tables. Separate legal owner, responsible organization, current location, and holder.

- [ ] **Step 4: Implement service rules**

Allow optional identifiers/photos by default; apply category policy when configured. Require condition choice and confirmation for checkout/return. Permit worker self-service only for authorized ordinary assets. Require Asset Manager approval for protected categories.

- [ ] **Step 5: Implement provisional and merge behavior**

Unknown identifiers create provisional records. Similar records return suggestions. Only an Asset Manager may merge, and the surviving asset retains both custody histories, aliases, photos, reports, and an immutable merge event.

- [ ] **Step 6: Run focused tests**

Run: `pnpm --filter @workspace/api-server test -- assets.test.ts`
Expected: PASS for plate aliases, provisional assets, conflict, hold, and history-preserving merge.

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/schema/assets.ts lib/db/src/schema/index.ts lib/api-zod/src/implementation-a/assets.ts artifacts/api-server/src/services/assets.ts artifacts/api-server/src/services/assets.test.ts artifacts/api-server/src/routes/implementationAAssets.ts artifacts/api-server/src/routes/index.ts
git commit -m "feat(inventory): add asset custody and condition history"
```

### Task 8: Gate vehicle matching and retrospective reconciliation

**Files:**

- Create: `artifacts/api-server/src/services/gate-reconciliation.ts`
- Create: `artifacts/api-server/src/services/gate-reconciliation.test.ts`
- Modify: `artifacts/api-server/src/routes/visits.ts`
- Modify: `lib/db/src/schema/siteVisits.ts`
- Modify: `artifacts/vndrly/src/pages/gatekeeper.tsx`
- Modify: `artifacts/vndrly-mobile/app/(tabs)/gate.tsx`

**Interfaces:**

- Consumes: asset aliases and operation ledger.
- Produces: `observeGateCrossing`, `matchVehicleByPlate`, `reconcileVisit`, `completeRetrospectiveVisit`.

- [ ] **Step 1: Write failing observed-versus-supplied fact tests**

```ts
expect(reconciled.observedArrivalAt).toEqual(cameraObservation.at);
expect(reconciled.completedAt).toEqual(clock.now());
expect(reconciled.facts.driverName.source).toBe("supplied_later");
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @workspace/api-server test -- gate-reconciliation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend visit records additively**

Store observed time, direction, source, provisional vehicle id, reconciliation state, supplied-later facts, completing Gatekeeper, and conflict reason without changing existing visit meaning.

- [ ] **Step 4: Implement routine and supervisor paths**

Gatekeepers may complete routine missed-entry records. Unresolved identity, conflicting times, access denial, or safety issues route to Gate Supervisor review. First-seen plates create provisional vehicle assets.

- [ ] **Step 5: Add web/mobile reconciliation views and tests**

Show the observed event separately from later information; provide voice/manual completion and supervisor review status.

- [ ] **Step 6: Run Gate regressions**

Run: `pnpm --filter @workspace/api-server test -- gate-reconciliation.test.ts visits.test.ts && pnpm --filter @workspace/vndrly test -- gatekeeper.voice.test.tsx && pnpm --filter @workspace/vndrly-mobile test -- gate.test.tsx`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/services/gate-reconciliation.ts artifacts/api-server/src/services/gate-reconciliation.test.ts artifacts/api-server/src/routes/visits.ts lib/db/src/schema/siteVisits.ts artifacts/vndrly/src/pages/gatekeeper.tsx artifacts/vndrly-mobile/app/(tabs)/gate.tsx
git commit -m "feat(gate): add vehicle matching and reconciliation"
```

### Task 9: Trips, directional crossings, automatic presence, and ETA

**Files:**

- Create: `lib/db/src/schema/fieldTrips.ts`
- Create: `lib/api-zod/src/implementation-a/trips.ts`
- Create: `artifacts/api-server/src/services/field-trips.ts`
- Create: `artifacts/api-server/src/services/geofence-crossings.ts`
- Create: `artifacts/api-server/src/routes/implementationATrips.ts`
- Test: `artifacts/api-server/src/services/geofence-crossings.test.ts`
- Test: `artifacts/api-server/src/services/field-trips.test.ts`
- Modify: `artifacts/api-server/src/routes/locations.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**

- Produces: `startTrip`, `updateTripLocation`, `estimateTripEta`, `evaluateDirectionalCrossing`, `finalizeAutomaticPresence`, `pauseWorkTracking`.

- [ ] **Step 1: Write failing drift and drive-by tests**

```ts
expect(evaluateDirectionalCrossing(driftSamples)).toEqual({ kind: "none" });
expect(evaluateDirectionalCrossing(driveBySamples)).toEqual({ kind: "none" });
expect(evaluateDirectionalCrossing(validEntrySamples)).toMatchObject({
  kind: "entry",
  crossedAt: validEntrySamples[2].at,
});
```

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @workspace/api-server test -- geofence-crossings.test.ts field-trips.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add trip and crossing state**

Store driver, vehicle, assignment, inferred/confirmed destination, active-shift scope, tracking state, last reliable point, freshness, crossing candidate, and final visit link.

- [ ] **Step 4: Implement crossing rules**

Require directional boundary transition plus configured brief presence inside/outside. Preserve the original crossing timestamp. Coalesce duplicate person/vehicle/site/direction crossings in the conflict window.

- [ ] **Step 5: Implement ETA and visibility**

Use existing Mapbox routing. Return estimate timestamp and source freshness. Apply authority matrix field filters so ordinary coworkers see site/status while authorized operations roles see route and exact location.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @workspace/api-server test -- geofence-crossings.test.ts field-trips.test.ts locations.test.ts visits-events-sse.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/schema/fieldTrips.ts lib/db/src/schema/index.ts lib/api-zod/src/implementation-a/trips.ts artifacts/api-server/src/services/field-trips.ts artifacts/api-server/src/services/geofence-crossings.ts artifacts/api-server/src/services/geofence-crossings.test.ts artifacts/api-server/src/services/field-trips.test.ts artifacts/api-server/src/routes/implementationATrips.ts artifacts/api-server/src/routes/locations.ts
git commit -m "feat(location): add trips and automatic site presence"
```

### Task 10: Safety response, escalation, and evidence preservation

**Files:**

- Create: `lib/db/src/schema/safetyResponse.ts`
- Create: `lib/api-zod/src/implementation-a/safety.ts`
- Create: `artifacts/api-server/src/services/safety-response.ts`
- Create: `artifacts/api-server/src/routes/implementationASafety.ts`
- Test: `artifacts/api-server/src/services/safety-response.test.ts`
- Modify: `lib/db/src/schema/safetyEvents.ts`
- Modify: `artifacts/api-server/src/routes/safety.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**

- Produces: `createIncident`, `startPossibleCrashCountdown`, `acknowledgeIncident`, `escalateIncident`, `appendIncidentEvidence`, `closeIncident`, `placeEvidenceHold`.

- [ ] **Step 1: Write failing degraded-mode and escalation tests**

```ts
it("creates a manual incident when AI mapping and push are unavailable", async () => {
  const incident = await createIncident(input, unavailableDependencies);
  expect(incident.persisted).toBe(true);
  expect(incident.degradedCapabilities).toEqual(
    expect.arrayContaining(["askv", "mapbox", "push"]),
  );
});
```

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @workspace/api-server test -- safety-response.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add response and evidence tables**

Store severity, response countdown, safety chain snapshot, delivery/acknowledgement, assigned responder, immutable original report, append-only evidence, closure, and legal/evidence hold.

- [ ] **Step 4: Implement approved incident workflow**

Use a 60-second response window for possible crash signals. No response alerts the company chain. If no chain exists, alert all active company admins and surface configuration health. Never initiate an emergency call without explicit user or platform action.

- [ ] **Step 5: Enforce immutable origin and closure authority**

Workers append corrections/evidence; only assigned responder, Safety Manager, or company admin closes. Holds suspend related media deletion.

- [ ] **Step 6: Run safety regressions**

Run: `pnpm --filter @workspace/api-server test -- safety-response.test.ts safety.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/schema/safetyResponse.ts lib/db/src/schema/safetyEvents.ts lib/db/src/schema/index.ts lib/api-zod/src/implementation-a/safety.ts artifacts/api-server/src/services/safety-response.ts artifacts/api-server/src/services/safety-response.test.ts artifacts/api-server/src/routes/implementationASafety.ts artifacts/api-server/src/routes/safety.ts
git commit -m "feat(safety): add resilient incident escalation"
```

### Task 11: Entitlement-gated iOS SafetyKit bridge

**Files:**

- Create: `artifacts/vndrly-mobile/modules/vndrly-safetykit/expo-module.config.json`
- Create: `artifacts/vndrly-mobile/modules/vndrly-safetykit/ios/VndrlySafetyKitModule.swift`
- Create: `artifacts/vndrly-mobile/modules/vndrly-safetykit/src/VndrlySafetyKit.types.ts`
- Create: `artifacts/vndrly-mobile/modules/vndrly-safetykit/src/VndrlySafetyKitModule.ts`
- Create: `artifacts/vndrly-mobile/lib/crash-awareness.ts`
- Test: `artifacts/vndrly-mobile/lib/crash-awareness.test.ts`
- Modify: `artifacts/vndrly-mobile/app.json`

**Interfaces:**

- Produces: `CrashAwarenessCapability`, `subscribeToSevereCrashEvents`, `evaluatePossibleCrashFallback`, `openSystemEmergencyAction`.

- [ ] **Step 1: Write capability-gating tests**

```ts
expect(resolveCrashCapability({ entitlement: false, platform: "ios" })).toEqual(
  { mode: "manual_only" },
);
expect(
  resolveCrashCapability({
    entitlement: true,
    supported: true,
    permission: true,
  }),
).toEqual({ mode: "safetykit" });
```

- [ ] **Step 2: Run mobile tests**

Run: `pnpm --filter @workspace/vndrly-mobile test -- crash-awareness.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement the first-party bridge**

Expose availability, permission, and severe-crash events through an Expo Module. Compile cleanly when entitlement configuration is absent and return `manual_only`; do not block app startup or release.

- [ ] **Step 4: Implement conservative fallback**

Evaluate only during an authorized active driving trip. Combine recent speed, device motion, location confidence, and stop duration. Emit `possible_crash`; do not label it a confirmed crash.

- [ ] **Step 5: Connect the countdown and explicit emergency action**

Display and speak `I'm okay` and `Get help`; route `Get help` to the system emergency action. Send company escalation after timeout independently of emergency calling.

- [ ] **Step 6: Run mobile unit tests and native build check**

Run: `pnpm --filter @workspace/vndrly-mobile test -- crash-awareness.test.ts && pnpm --filter @workspace/vndrly-mobile run typecheck && pnpm run mobile:release-impact`
Expected: PASS; release impact reports a native binary requirement.

- [ ] **Step 7: Commit**

```bash
git add artifacts/vndrly-mobile/modules/vndrly-safetykit artifacts/vndrly-mobile/lib/crash-awareness.ts artifacts/vndrly-mobile/lib/crash-awareness.test.ts artifacts/vndrly-mobile/app.json
git commit -m "feat(ios): add gated SafetyKit crash awareness"
```

### Task 12: Ask V unified capability context and parity registry

**Files:**

- Create: `artifacts/api-server/src/assistant/capability-context.ts`
- Create: `artifacts/api-server/src/assistant/capability-parity.ts`
- Create: `artifacts/api-server/src/assistant/capability-parity.test.ts`
- Create: `artifacts/api-server/src/assistant/capabilities/invitations.ts`
- Create: `artifacts/api-server/src/assistant/capabilities/workforce.ts`
- Create: `artifacts/api-server/src/assistant/capabilities/assets.ts`
- Create: `artifacts/api-server/src/assistant/capabilities/trips.ts`
- Create: `artifacts/api-server/src/assistant/capabilities/safety.ts`
- Create: `artifacts/api-server/src/assistant/capabilities/accounts.ts`
- Modify: `artifacts/api-server/src/assistant/tool-registry.ts`
- Modify: `artifacts/api-server/src/assistant/tool-packs.ts`
- Modify: `artifacts/api-server/src/assistant/work-hub-tool-runtime.ts`

**Interfaces:**

- Produces: `AskVCapabilityContext`, `ASK_V_CAPABILITY_PARITY`, new read/prepare/confirm tools for each domain.

- [ ] **Step 1: Write failing parity tests**

```ts
for (const action of USER_FACING_ACTIONS) {
  expect(ASK_V_CAPABILITY_PARITY[action.id]).toMatchObject({
    readTool: expect.any(String),
    route: expect.stringMatching(/^\//),
  });
}
```

- [ ] **Step 2: Run parity tests**

Run: `pnpm --filter @workspace/api-server test:no-isolated-db -- capability-parity.test.ts`
Expected: FAIL.

- [ ] **Step 3: Build unified context**

Resolve identity, active membership, sponsorship, assignment, shift, site, crew, vehicle, trip, device, meeting/call/chat, and pending confirmation once per turn. Context switching must invalidate stale tool results.

- [ ] **Step 4: Register domain tools**

Add read tools plus prepare/confirm mutations for invitations, schedules, acknowledgements, assets, trips, incidents, subscriptions, and displays. Invitation tools may create, send, resend, revoke, and report status but never receive or return a password.

- [ ] **Step 5: Apply authority and confirmation metadata**

Every tool calls the central authority matrix. Sending invitations, changing schedules/hours, custody transfers, incident escalation, account lifecycle, recording, and cross-company actions require confirmation. Queries and explanations do not.

- [ ] **Step 6: Run Ask V tests**

Run: `pnpm --filter @workspace/api-server test:no-isolated-db -- capability-parity.test.ts tool-registry.test.ts tool-packs.test.ts work-hub-tool-runtime.test.ts askv-idempotency.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/api-server/src/assistant/capability-context.ts artifacts/api-server/src/assistant/capability-parity.ts artifacts/api-server/src/assistant/capability-parity.test.ts artifacts/api-server/src/assistant/capabilities artifacts/api-server/src/assistant/tool-registry.ts artifacts/api-server/src/assistant/tool-packs.ts artifacts/api-server/src/assistant/work-hub-tool-runtime.ts
git commit -m "feat(askv): add unified field operations capabilities"
```

### Task 13: Ask V continuous hands-free session and natural-language coverage

**Files:**

- Create: `artifacts/api-server/src/assistant/continuous-work-session.ts`
- Create: `artifacts/api-server/src/assistant/continuous-work-session.test.ts`
- Create: `artifacts/api-server/src/assistant/__evals__/implementation-a.eval.ts`
- Modify: `artifacts/api-server/src/assistant/realtime-session.ts`
- Modify: `artifacts/api-server/src/assistant/prompts/system.ts`
- Modify: `artifacts/vndrly-mobile/modules/askv-wake/ios/AskVWakeModule.swift`
- Modify: `artifacts/vndrly-mobile/app/__tests__/askv-voice-session.test.tsx`

**Interfaces:**

- Consumes: unified capability context and tool registry.
- Produces: `ContinuousWorkSession`, context carryover, one-question clarification, truthfully confirmed results.

- [ ] **Step 1: Add failing conversation scenarios**

Cover “Morning V,” plate-only trip start, asset checkout, schedule acknowledgement, ETA, missed Gate visit, invitation resend, accident report, and switching from a call to an asset action without losing company/site context.

- [ ] **Step 2: Run focused tests and evals**

Run: `pnpm --filter @workspace/api-server test:no-isolated-db -- continuous-work-session.test.ts && pnpm --filter @workspace/api-server run eval -- implementation-a.eval.ts`
Expected: FAIL on missing context transitions/tools.

- [ ] **Step 3: Implement continuous session state**

Persist only necessary authorized work context. Use on-device wake phrase detection; do not stream or store ambient audio before activation. Ask one short clarification only when ambiguity changes the target or consequence.

- [ ] **Step 4: Enforce truthful completion**

Speak success only after an authoritative server receipt or durable offline queue receipt. On conflict, explain the authoritative state and offer the allowed next action.

- [ ] **Step 5: Run voice tests and evals**

Run: `pnpm --filter @workspace/api-server test:no-isolated-db -- continuous-work-session.test.ts realtime-session.test.ts voice-context.test.ts && pnpm --filter @workspace/vndrly-mobile test -- askv-voice-session.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/assistant/continuous-work-session.ts artifacts/api-server/src/assistant/continuous-work-session.test.ts artifacts/api-server/src/assistant/__evals__/implementation-a.eval.ts artifacts/api-server/src/assistant/realtime-session.ts artifacts/api-server/src/assistant/prompts/system.ts artifacts/vndrly-mobile/modules/askv-wake/ios/AskVWakeModule.swift artifacts/vndrly-mobile/app/__tests__/askv-voice-session.test.tsx
git commit -m "feat(askv): add continuous hands-free work sessions"
```

### Task 14: Meeting participant, in-place authorization, and media retention

**Files:**

- Create: `lib/db/src/schema/workHubMeetingParticipation.ts`
- Create: `artifacts/api-server/src/services/meeting-participation.ts`
- Create: `artifacts/api-server/src/services/meeting-participation.test.ts`
- Modify: `artifacts/api-server/src/routes/workHubMeetings.ts`
- Modify: `artifacts/api-server/src/routes/workHubMeetingReplay.ts`
- Modify: `artifacts/vndrly/src/components/meeting-workspace.tsx`
- Modify: `artifacts/vndrly-mobile/components/meeting-workspace.tsx`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**

- Produces: `participationState`, `acceptParticipationAuthorization`, `startAutomaticTranscript`, `applyRecordingRetention`, `placeRecordingHold`.

- [ ] **Step 1: Write failing participation tests**

```ts
expect(await join(unacceptedUser)).toMatchObject({ mode: "view_only" });
expect(await sendAudio(unacceptedUser)).toMatchObject({
  allowed: false,
  code: "meeting.authorization_required",
});
expect(await acceptInMeeting(unacceptedUser)).toMatchObject({
  mode: "active",
  rejoinRequired: false,
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @workspace/api-server test -- meeting-participation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement participation and Ask V attendee state**

Show unaccepted participants as view-only with private authorization card. Activate immediately after acceptance. Add visible `VNDRLY Assistant` participant, silent unless addressed, excluded from attendance/quorum, host-pausable/removable.

- [ ] **Step 4: Implement transcript and recording policy**

Verified company policy starts transcripts automatically with persistent indicator. Raw recording remains separately configured, expires at 30 days, and skips deletion while a specific legal/incident/evidence hold is active.

- [ ] **Step 5: Run meeting tests across API/web/mobile**

Run: `pnpm --filter @workspace/api-server test -- meeting-participation.test.ts workHubMeetings.test.ts workHubMeetingReplay.test.ts && pnpm --filter @workspace/vndrly test -- meeting-workspace.test.tsx && pnpm --filter @workspace/vndrly-mobile test -- meeting-workspace.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/workHubMeetingParticipation.ts lib/db/src/schema/index.ts artifacts/api-server/src/services/meeting-participation.ts artifacts/api-server/src/services/meeting-participation.test.ts artifacts/api-server/src/routes/workHubMeetings.ts artifacts/api-server/src/routes/workHubMeetingReplay.ts artifacts/vndrly/src/components/meeting-workspace.tsx artifacts/vndrly-mobile/components/meeting-workspace.tsx
git commit -m "feat(meetings): add in-place participation authorization"
```

### Task 15: Worker subscriptions, entitlement previews, and account lifecycle

**Files:**

- Create: `lib/db/src/schema/workerSubscriptions.ts`
- Create: `lib/api-zod/src/implementation-a/subscriptions.ts`
- Create: `artifacts/api-server/src/services/worker-subscriptions.ts`
- Create: `artifacts/api-server/src/routes/implementationASubscriptions.ts`
- Test: `artifacts/api-server/src/services/worker-subscriptions.test.ts`
- Modify: `artifacts/api-server/src/routes/accountManagement.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**

- Produces: `previewSeatChange`, `activateSeat`, `pauseSeat`, `terminateSeat`, `reactivateSeat`, `resolveEntitlement`.

- [ ] **Step 1: Write failing lifecycle and billing tests**

```ts
expect(await createEmployeeAndSeat(input)).toMatchObject({
  seat: { state: "active" },
  invitation: { state: "pending" },
});
expect(await pauseSeat(seat.id)).toMatchObject({
  accessEndsAt: now,
  billingEndsAt: renewalAt,
});
expect(await terminateSeat(seat.id)).toMatchObject({
  accessEndsAt: now,
  renews: false,
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @workspace/api-server test -- worker-subscriptions.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add subscription and entitlement state**

Store paying company, worker, plan (`gate_only` or `full_worker`), price snapshot, renewal, state, effective dates, founding-site entitlement, preview access, and audit actor. Do not couple access state to destructive user deletion.

- [ ] **Step 4: Implement preview and confirmation**

Before account creation, return exact plan, monthly price, payor, renewal date, and resulting seat count. Only the confirmed command creates the account, seat, and invitation.

- [ ] **Step 5: Implement pause/termination/reactivation**

Pause revokes access immediately and ends billing at the next renewal while preserving identity. Termination revokes immediately, cancels renewal, and archives. Reactivation restores the same identity. Keep privacy deletion separate.

- [ ] **Step 6: Run tests**

Run: `pnpm --filter @workspace/api-server test -- worker-subscriptions.test.ts accountManagement.test.ts`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add lib/db/src/schema/workerSubscriptions.ts lib/db/src/schema/index.ts lib/api-zod/src/implementation-a/subscriptions.ts artifacts/api-server/src/services/worker-subscriptions.ts artifacts/api-server/src/services/worker-subscriptions.test.ts artifacts/api-server/src/routes/implementationASubscriptions.ts artifacts/api-server/src/routes/accountManagement.ts
git commit -m "feat(billing): add company sponsored worker seats"
```

### Task 16: Operations displays and trusted multi-monitor control

**Files:**

- Create: `lib/db/src/schema/operationsDisplays.ts`
- Create: `lib/api-zod/src/implementation-a/displays.ts`
- Create: `artifacts/api-server/src/services/operations-displays.ts`
- Create: `artifacts/api-server/src/routes/implementationADisplays.ts`
- Create: `artifacts/vndrly/src/pages/operations-display.tsx`
- Test: `artifacts/api-server/src/services/operations-displays.test.ts`
- Test: `artifacts/vndrly/src/pages/operations-display.test.tsx`
- Modify: `artifacts/api-server/src/routes/workHubDevices.ts`
- Modify: `lib/db/src/schema/index.ts`

**Interfaces:**

- Produces: `registerOperationsDisplay`, `authorizeDisplayView`, `routeViewToMonitor`, `joinAsRoomDevice`, `revokeDisplay`.

- [ ] **Step 1: Write failing display authority tests**

```ts
expect(
  await routeView(nearbyUnauthenticatedVoice, restrictedMap),
).toMatchObject({ allowed: false });
expect(await routeView(authorizedCompanion, restrictedMap)).toMatchObject({
  allowed: true,
});
expect(await mutateSchedule(displayIdentity)).toMatchObject({ allowed: false });
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @workspace/api-server test -- operations-displays.test.ts`
Expected: FAIL.

- [ ] **Step 3: Add display identity and view grants**

Use a non-person device record, named monitor outputs, site/view allowlist, short-lived renewable token, privacy mode, remote revoke, and room-device meeting state.

- [ ] **Step 4: Build full-screen view and Ask V routing**

Support crew map, Gate log, safety, coverage, and meeting room views. Verify the controlling person through a signed-in companion device. Camera and microphone start off.

- [ ] **Step 5: Run tests**

Run: `pnpm --filter @workspace/api-server test -- operations-displays.test.ts workHubDevices.test.ts && pnpm --filter @workspace/vndrly test -- operations-display.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/db/src/schema/operationsDisplays.ts lib/db/src/schema/index.ts lib/api-zod/src/implementation-a/displays.ts artifacts/api-server/src/services/operations-displays.ts artifacts/api-server/src/services/operations-displays.test.ts artifacts/api-server/src/routes/implementationADisplays.ts artifacts/api-server/src/routes/workHubDevices.ts artifacts/vndrly/src/pages/operations-display.tsx artifacts/vndrly/src/pages/operations-display.test.tsx
git commit -m "feat(work-hub): add trusted operations displays"
```

### Task 17: Web Work Hub experience

**Files:**

- Create: `artifacts/vndrly/src/components/implementation-a/managed-crews.tsx`
- Create: `artifacts/vndrly/src/components/implementation-a/workforce-coverage.tsx`
- Create: `artifacts/vndrly/src/components/implementation-a/assets.tsx`
- Create: `artifacts/vndrly/src/components/implementation-a/site-presence.tsx`
- Create: `artifacts/vndrly/src/components/implementation-a/safety-response.tsx`
- Create: `artifacts/vndrly/src/components/implementation-a/subscriptions.tsx`
- Create: `artifacts/vndrly/src/components/implementation-a/operations-health.tsx`
- Test: matching `.test.tsx` files
- Modify: `artifacts/vndrly/src/pages/work-hub.tsx`
- Modify: `artifacts/vndrly/src/components/work-hub/navigation.tsx`

**Interfaces:**

- Consumes: implementation-A APIs and SSE events.
- Produces: full desktop workflows with Ask V parity routes.

- [ ] **Step 1: Write failing role and entitlement UI tests**

Assert NewTek manager sees NewTek workers only; Gate Supervisor sees assigned site crew; unentitled actions show preview/request-access; protected data never renders; confirmation surfaces state the exact effect.

- [ ] **Step 2: Run focused web tests**

Run: `pnpm --filter @workspace/vndrly test -- components/implementation-a`
Expected: FAIL because the components do not exist.

- [ ] **Step 3: Build the Work Hub modules**

Use existing Work Hub chrome, primary-brand controls, responsive full-width layout, real-time refresh, and no icon shadows. Include activity attention cards, schedule gaps, invitation status, asset custody, site presence, incidents, subscriptions, and health.

- [ ] **Step 4: Add Ask V route parity**

Every visible action registers a parity route and confirmation surface. Voice-triggered actions focus or update the same screen state rather than creating a separate workflow.

- [ ] **Step 5: Run web suite and typecheck**

Run: `pnpm run test:web && pnpm --filter @workspace/vndrly run typecheck`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/vndrly/src/components/implementation-a artifacts/vndrly/src/pages/work-hub.tsx artifacts/vndrly/src/components/work-hub/navigation.tsx
git commit -m "feat(web): add implementation A Work Hub workflows"
```

### Task 18: Mobile Work Hub, offline queue, and active-shift tracking

**Files:**

- Create: `artifacts/vndrly-mobile/components/implementation-a/ManagedCrews.tsx`
- Create: `artifacts/vndrly-mobile/components/implementation-a/WorkforceCoverage.tsx`
- Create: `artifacts/vndrly-mobile/components/implementation-a/Assets.tsx`
- Create: `artifacts/vndrly-mobile/components/implementation-a/SitePresence.tsx`
- Create: `artifacts/vndrly-mobile/components/implementation-a/SafetyResponse.tsx`
- Create: `artifacts/vndrly-mobile/lib/implementation-a-queue.ts`
- Create: `artifacts/vndrly-mobile/lib/active-shift-tracking.ts`
- Test: `artifacts/vndrly-mobile/lib/implementation-a-queue.test.ts`
- Test: `artifacts/vndrly-mobile/lib/active-shift-tracking.test.ts`
- Modify: `artifacts/vndrly-mobile/app/work-hub/[module].tsx`
- Modify: `artifacts/vndrly-mobile/lib/work-hub-queue-runtime.ts`

**Interfaces:**

- Consumes: operation envelope and implementation-A APIs.
- Produces: offline codecs/replay and native parity.

- [ ] **Step 1: Write failing offline replay tests**

```ts
await queue(commandWithOperationId);
await flush();
await flush();
expect(await serverEffects(commandWithOperationId.operationId)).toHaveLength(1);
```

Cover Gate crossing, custody transfer, schedule acknowledgement, task, and incident. Cover a stale custody version returning a visible conflict rather than retrying forever.

- [ ] **Step 2: Run mobile tests**

Run: `pnpm --filter @workspace/vndrly-mobile test -- implementation-a-queue.test.ts active-shift-tracking.test.ts`
Expected: FAIL.

- [ ] **Step 3: Extend the native queue**

Persist domain/version/operation id/original event time/device/auth scope. Replay only in the same authenticated scope. Stop automatic retry on authorization denial or conflict and surface resolution.

- [ ] **Step 4: Implement shift tracking lifecycle**

After versioned onboarding consent, start with scheduled shift/approved early start/check-in and stop at shift end/check-out. Show persistent indicator, battery/location health, pause, and stale state. Opening the app off duty must not start tracking.

- [ ] **Step 5: Build native workflows**

Provide the same managed crew, schedule, asset, Gate/trip, incident, invitation, and health actions as web with camera, scanner, and hands-free affordances.

- [ ] **Step 6: Run mobile suite and locale parity**

Run: `pnpm run test:mobile && pnpm lint:i18n && pnpm --filter @workspace/vndrly-mobile run typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add artifacts/vndrly-mobile/components/implementation-a artifacts/vndrly-mobile/lib/implementation-a-queue.ts artifacts/vndrly-mobile/lib/implementation-a-queue.test.ts artifacts/vndrly-mobile/lib/active-shift-tracking.ts artifacts/vndrly-mobile/lib/active-shift-tracking.test.ts artifacts/vndrly-mobile/app/work-hub/[module].tsx artifacts/vndrly-mobile/lib/work-hub-queue-runtime.ts
git commit -m "feat(mobile): add offline implementation A workflows"
```

### Task 19: Payroll, accounting, asset, and safety exports

**Files:**

- Create: `artifacts/api-server/src/services/implementation-a-exports.ts`
- Create: `artifacts/api-server/src/services/implementation-a-exports.test.ts`
- Modify: `artifacts/api-server/src/routes/workHubExports.ts`
- Modify: `artifacts/vndrly/src/components/work-hub/import-export.tsx`
- Modify: mobile Work Hub export view

**Interfaces:**

- Produces: scoped CSV/Excel-compatible/QuickBooks-time, custody, inventory, staffing, and safety exports.

- [ ] **Step 1: Write failing scope and column tests**

Assert NewTek exports contain NewTek-attributed hours but no pay rates unless separately permitted; sponsor exports retain sponsor-owned assignment history; asset exports include custody/condition without hidden incident details.

- [ ] **Step 2: Run focused tests**

Run: `pnpm --filter @workspace/api-server test -- implementation-a-exports.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement deterministic exports**

Use explicit schemas and stable headers. Record export actor, filter, scope, row count, hash, and result in the existing export audit flow. Use the authority matrix for every row and field.

- [ ] **Step 4: Add UI controls and explanatory preview**

Show included period, people, sites, employer/sponsor attribution, and excluded sensitive fields before confirmation.

- [ ] **Step 5: Run export regressions**

Run: `pnpm --filter @workspace/api-server test -- implementation-a-exports.test.ts workHubExports.test.ts payroll.test.ts && pnpm --filter @workspace/vndrly test -- import-export.exports.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/services/implementation-a-exports.ts artifacts/api-server/src/services/implementation-a-exports.test.ts artifacts/api-server/src/routes/workHubExports.ts artifacts/vndrly/src/components/work-hub/import-export.tsx artifacts/vndrly-mobile/app/work-hub/[module].tsx
git commit -m "feat(exports): add scoped workforce and asset exports"
```

### Task 20: Operations health, retention, accessibility, and language

**Files:**

- Create: `artifacts/api-server/src/services/operations-health.ts`
- Create: `artifacts/api-server/src/routes/implementationAHealth.ts`
- Create: `artifacts/api-server/src/services/operations-health.test.ts`
- Modify: `artifacts/api-server/src/routes/workHubGovernance.ts`
- Modify: platform retention worker
- Modify: web/mobile English and Spanish locale files
- Modify: implementation-A web/mobile components for accessibility findings

**Interfaces:**

- Produces: `getOperationsHealth`, `runImplementationARetention`, accessible localized state/error copy.

- [ ] **Step 1: Write failing health and retention tests**

```ts
expect(await health()).toEqual(
  expect.objectContaining({
    offlineBacklog: expect.any(Number),
    failedAlerts: expect.any(Number),
    staleLocations: expect.any(Number),
    missingSafetyChain: expect.any(Boolean),
  }),
);
expect(await retention(recordingOnHold)).toMatchObject({
  deleted: false,
  reason: "hold",
});
```

- [ ] **Step 2: Run tests**

Run: `pnpm --filter @workspace/api-server test -- operations-health.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement health aggregation and retention**

Report sync backlog, terminal conflicts, missing permissions, stale locations, failed alerts, transcription availability, unhealthy displays, and missing safety chain. Delete raw media at 30 days unless record-specific hold exists; retain transcript/summary under normal policy.

- [ ] **Step 4: Complete accessibility and locale parity**

Ensure 44-point mobile targets, screen-reader labels, focus management, non-color status text, reduced-motion behavior, noisy-environment text fallback, and equivalent English/Spanish copy.

- [ ] **Step 5: Run health, governance, accessibility, and locale tests**

Run: `pnpm --filter @workspace/api-server test -- operations-health.test.ts workHubGovernance.test.ts platformSettings-retention-audit.test.ts && pnpm lint:i18n && pnpm run test:web && pnpm run test:mobile`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add artifacts/api-server/src/services/operations-health.ts artifacts/api-server/src/services/operations-health.test.ts artifacts/api-server/src/routes/implementationAHealth.ts artifacts/api-server/src/routes/workHubGovernance.ts artifacts/vndrly/src/lib/locales artifacts/vndrly-mobile/lib/locales artifacts/vndrly/src/components/implementation-a artifacts/vndrly-mobile/components/implementation-a
git commit -m "feat(operations): add health retention and accessibility"
```

### Task 21: Cross-domain browser and mobile acceptance coverage

**Files:**

- Create: `lib/e2e/tests/implementation-a-subcontractor.spec.ts`
- Create: `lib/e2e/tests/implementation-a-gate-assets.spec.ts`
- Create: `lib/e2e/tests/implementation-a-meeting-safety.spec.ts`
- Create: `lib/e2e/tests/implementation-a-entitlements.spec.ts`
- Create: `artifacts/vndrly-mobile/app/__tests__/implementation-a-journey.test.tsx`

**Interfaces:**

- Consumes: all completed Plan A modules.
- Produces: user-journey release evidence.

- [ ] **Step 1: Write end-to-end journeys**

Cover: MidCon creates NewTek and a paid worker seat; activation email contains no password; employee sets password and accepts onboarding; Gate Supervisor schedules and worker acknowledges; active shift starts location; driver identifies truck by Texas plate; automatic Gate entry occurs once; asset is checked out by voice; cross-sponsor data stays hidden; view-only meeting participant authorizes in place; manual crash incident escalates during degraded services; account pause preserves history; managed company claim preserves identities.

- [ ] **Step 2: Run new E2E tests and verify failures identify incomplete integration**

Run: `pnpm --filter @workspace/api-server exec tsx scripts/run-with-test-db.ts -- corepack pnpm --dir ../.. --filter @workspace/e2e exec playwright test implementation-a-*.spec.ts`
Expected: the first run may reveal wiring gaps; record each as a failing assertion, not a manual exception.

- [ ] **Step 3: Fix only demonstrated integration gaps**

Update the owning task's service/component and add a focused regression test for each failure. Do not weaken assertions or add unconditional waits.

- [ ] **Step 4: Run all new journeys again**

Run: `pnpm --filter @workspace/api-server exec tsx scripts/run-with-test-db.ts -- corepack pnpm --dir ../.. --filter @workspace/e2e exec playwright test implementation-a-*.spec.ts`
Expected: PASS.

- [ ] **Step 5: Run mobile journey**

Run: `pnpm --filter @workspace/vndrly-mobile test -- implementation-a-journey.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/e2e/tests/implementation-a-*.spec.ts artifacts/vndrly-mobile/app/__tests__/implementation-a-journey.test.tsx
git commit -m "test: add implementation A user journeys"
```

### Task 22: Migration rehearsal and complete validation

**Files:**

- Create: additive migration chunks under `lib/db/drizzle/`
- Create: corresponding guarded migration runners under `lib/db/src/scripts/`
- Modify: API deploy migration manifes
- Modify: `docs/database.md`

**Interfaces:**

- Consumes: final schema.
- Produces: production-safe migration and complete release evidence.

- [ ] **Step 1: Generate and inspect additive migrations**

Generate migration SQL from the completed schema. Manually verify it contains no `DROP`, `TRUNCATE`, broad `DELETE`, table recreation, destructive cast, or credential mutation. Convert production additions to guarded `ADD COLUMN IF NOT EXISTS`/`CREATE TABLE IF NOT EXISTS`/`CREATE INDEX IF NOT EXISTS` forms supported by project conventions.

- [ ] **Step 2: Rehearse against a production-shaped disposable database**

Run the guarded migration twice. The second run must be a no-op. Verify existing row counts and canonical credentials are unchanged.

- [ ] **Step 3: Run fast checks**

Run: `pnpm run typecheck && pnpm lint:i18n`
Expected: PASS.

- [ ] **Step 4: Run individual mandatory suites**

Run: `pnpm run test:web`
Expected: PASS.
Run: `pnpm run test:mobile`
Expected: PASS.
Run: `pnpm run test:api`
Expected: PASS against the isolated test database.

- [ ] **Step 5: Run the aggregate release gate on the unchanged tree**

Run: `pnpm test`
Expected: PASS, including Playwright workflows.

- [ ] **Step 6: Request fresh reviews**

Run accessibility review on web/iPhone/iPad, security review on authorization/invitations/location/media/billing, and release review on exact tree/migrations/native impact. Fix every release-blocking finding with a focused regression test, then rerun only affected focused tests and the final aggregate gate if code changed.

- [ ] **Step 7: Commit migration and documentation**

```bash
git add lib/db/drizzle lib/db/src/scripts docs/database.md
git commit -m "chore(db): add guarded implementation A migrations"
```

### Task 23: Full ship and live verification

**Files:**

- No product-code changes unless a release failure demonstrates a defect.
- Update: release evidence artifact under `docs/releases/` using the established format.

**Interfaces:**

- Consumes: exact validated commit.
- Produces: live web/API/database/OTA decision/TestFlight release evidence.

- [ ] **Step 1: Lock the exact release tree**

Confirm `git status --short` contains no unintended file and remote `main` is the expected parent. Record the validated commit and start the commit-to-live timer.

- [ ] **Step 2: Push and advance main non-force**

Use the configured GitHub integration as the primary publication path. Publish the working branch and advance `main` in one non-force pass. Never rewrite history.

- [ ] **Step 3: Monitor all release tracks concurrently**

Monitor `.github/workflows/publish.yml`, `.github/workflows/deploy-api.yml`, `.github/workflows/mobile-ota.yml`, and `.github/workflows/mobile-testflight.yml`. Dispatch API if path filters did not start it. Dispatch TestFlight explicitly. Apply guarded Supabase migrations only through the API release path.

- [ ] **Step 4: Verify public surfaces**

Run: `node scripts/check-live.mjs`
Expected: production web and Gate checks pass.
Run: `node scripts/check-vps-api.mjs`
Expected: API health and version checks pass.

- [ ] **Step 5: Verify mobile delivery decision**

Confirm the native SafetyKit bridge causes the OTA safety check to defer incompatible delivery to the new binary. Verify any compatible JS update group when applicable.

- [ ] **Step 6: Verify TestFlight submission**

Confirm the new native build uploads successfully, Apple accepts it for processing, processing completes, and the build is available to the configured TestFlight group. App Store `Ready for Sale` is outside this authorization.

- [ ] **Step 7: Record release evidence**

Document commit, workflow results, migration result, public web/API verification, OTA decision/update group, TestFlight version/build/status, and elapsed commit-to-live time. The release is incomplete until TestFlight submission and processing status are verified.

---

## Plan completion criteria

Plan A is complete only when every checkbox is satisfied, all mandatory gates pass on the exact shipped tree, every release-blocking review finding is resolved, production web and API are verified, guarded database migrations are applied, the native delivery decision is verified, and TestFlight is available to the configured tester group. Partial deployment does not count as completion.
