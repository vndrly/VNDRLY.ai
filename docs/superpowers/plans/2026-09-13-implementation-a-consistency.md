# Implementation A — Binding Consistency Corrections

**Reviewed:** 2026-09-13
**Applies to:** `docs/superpowers/plans/2026-09-13-implementation-a.md`
**Precedence:** These corrections override conflicting or less-specific wording in the detailed plan.

## Review resul

- Spec coverage: complete after the corrections below.
- Placeholder scan: clean; no deferred implementation placeholders remain.
- Type and interface consistency: shared command, authority, asset, trip, incident, invitation, and Ask V interfaces are aligned.
- Repository fit: existing Work Hub, Ask V, offline queue, SendGrid, Stripe, Mapbox, Safety, Governance, and meeting foundations are reused.
- Database safety: additive-only; no destructive migration is authorized.

## Correction 1: Exact secure-invitation integration files

Task 3 also modifies:

- `artifacts/api-server/src/routes/orgMembers.ts`
- `artifacts/vndrly/src/App.tsx`
- `artifacts/vndrly-mobile/app/_layout.tsx`

No temporary password is created. The user row receives an unusable random password hash solely to satisfy the current non-null schema; the value is never returned, displayed, logged, or emailed. Claiming the hashed, single-use, 24-hour activation token sets the employee's first chosen password. A resend invalidates every earlier unused activation token.

Ask V receives these invitation capabilities:

```ts
type InvitationCapability =
  | "query_employee_invitation"
  | "prepare_employee_invitation"
  | "confirm_employee_invitation"
  | "prepare_resend_employee_invitation"
  | "confirm_resend_employee_invitation"
  | "prepare_revoke_employee_invitation"
  | "confirm_revoke_employee_invitation"
  | "query_employee_onboarding";
```

Ask V may report delivery and onboarding state but may never receive, generate for display, or retrieve an employee password.

## Correction 2: Relationship-based cross-company communication

Task 4 must explicitly modify and test:

- `artifacts/api-server/src/routes/partnerVendorRelationships.ts`
- `artifacts/api-server/src/routes/workHubCollaboration.ts`
- `artifacts/api-server/src/routes/workHubCalls.ts`
- `artifacts/api-server/src/routes/workHubEvents.ts`
- `artifacts/api-server/src/routes/workHubExports.ts`
- `artifacts/api-server/src/routes/implementationACrossCompanyCommunication.test.ts`

Company-wide discovery requires approval from administrators of both organizations. Contextual discovery is permitted only through a shared ticket, site, crew, contract, or specific invitation. Either organization may revoke future discovery without deleting legitimate history. A sponsored NewTek worker cannot use MidCon's Flywheel relationship unless invited to the exact chat, call, or meeting.

Focused verification:

```powershell
pnpm --filter @workspace/api-server test:no-isolated-db -- authority-matrix.test.ts implementationACrossCompanyCommunication.test.ts workHubEvents.test.ts workHubExports.test.ts tool-registry.test.ts
```

## Correction 3: Exact notification worker boundary

Task 6 creates `artifacts/api-server/src/lib/implementation-a-notification-worker.ts` and starts/stops it from `artifacts/api-server/src/index.ts`. It must drain due retries and escalations without overlapping runs, expose a testable single-drain function, and stop cleanly during process shutdown.

```ts
export type NotificationWorker = {
  drain(
    now?: Date,
  ): Promise<{ delivered: number; escalated: number; failed: number }>;
  start(): void;
  stop(): void;
};
```

## Correction 4: Exact cross-platform meeting participation scope

Task 14 includes Ask V participant presence in chats and calls, not only meetings. It modifies:

- `artifacts/api-server/src/routes/workHubCollaboration.ts`
- `artifacts/api-server/src/routes/workHubCalls.ts`
- their existing API tests;
- `artifacts/vndrly/src/components/work-hub/collaboration.tsx`;
- `artifacts/vndrly/src/components/work-hub/calls.tsx`;
- their existing web tests.

Ask V is visibly labeled, silent unless addressed, excluded from attendance/quorum, and pausable/removable by the host in all three communication modes.

## Correction 5: Complete worker-subscription billing

Task 15 also creates:

- `lib/db/src/schema/workerPlanCatalog.ts`
- `artifacts/api-server/src/services/worker-subscription-billing.ts`
- `artifacts/api-server/src/services/worker-subscription-billing.test.ts`
- `artifacts/api-server/src/routes/implementationASubscriptionWebhook.ts`

It produces:

```ts
export type WorkerPlanCode = "gate_only" | "full_worker";
export type WorkerSeatState = "active" | "paused" | "past_due" | "terminated";
export function createStripeSeatSubscription(
  input: CreateSeatBillingInput,
): Promise<SeatBillingResult>;
export function applyStripeSubscriptionEvent(
  input: VerifiedStripeEvent,
): Promise<OperationReceipt<WorkerSeat>>;
```

Use the Stripe SDK already present in the repository. Do not hardcode the unsettled per-employee price. An administrator-managed catalog stores the active amount, currency, provider price id, and effective date. The creation preview returns the exact plan, monthly amount, payor, renewal date, and resulting seat count before confirmation.

One Stripe subscription item represents one company-paid worker seat. Verify webhook signatures, deduplicate provider event ids, tolerate out-of-order events, and map paid, past-due, paused, and canceled states without trusting client input. The plan must test initial activation, renewal, cancel-at-period-end, grace period, pause, termination, reactivation, duplicate delivery, and out-of-order delivery.

Focused verification:

```powershell
pnpm --filter @workspace/api-server test -- worker-subscriptions.test.ts worker-subscription-billing.test.ts accountManagement.test.ts
```

## Correction 6: Exact retention worker boundary

Task 20 modifies `artifacts/api-server/src/work-hub/governance-retention-planner-runtime.ts`. Raw meeting media becomes eligible for deletion 30 days after creation. The planner must skip any media linked to an active legal, incident, dispute, or evidence-preservation hold. Transcript and summary records remain governed by their independent retention policy.

## Correction 7: Exact migration and deployment files

Task 22 uses:

- `lib/db/drizzle/chunk_410_implementation_a.sql`
- `artifacts/api-server/scripts/apply-implementation-a-migration.mjs`
- `artifacts/api-server/package.json`
- `.github/workflows/deploy-api.yml`
- `docs/database.md`

The migration runner must be safe to run twice and refuse any statement containing `DROP`, `TRUNCATE`, broad `DELETE`, or destructive table replacement. Production migration remains part of API deployment.

## Correction 8: Exact evaluation command

Task 13 uses:

```powershell
pnpm --filter @workspace/api-server run eval -- src/assistant/__evals__/implementation-a.eval.ts
```

## Correction 9: PowerShell-safe Gate path

Task 8 stages the mobile Gate file with quoting:

```powershell
git add -- 'artifacts/vndrly-mobile/app/(tabs)/gate.tsx'
```

## Correction 10: Full-ship TestFlight completion wording

Task 23 distinguishes submission from Apple processing. VNDRLY's full-ship obligation is satisfied only after the build is uploaded and submitted to TestFlight and the workflow reports success. Availability to testers must also be monitored and reported, but Apple processing delay is external state and does not justify rerunning an unchanged native build.

## Final acceptance checklis

Before declaring Plan A complete, the executor must be able to point to passing evidence for:

1. sponsor and cross-company isolation;
2. passwordless invitation token security and delivery states;
3. product-to-Ask-V capability parity;
4. schedule acknowledgement, vacancy, reminder, and no-show escalation;
5. asset custody conflict, provisional asset, hold, and merge history;
6. automatic Gate crossing drift/drive-by rejection and retrospective reconciliation;
7. active-shift location privacy, ETA freshness, and offline replay;
8. manual/degraded incident response and gated SafetyKit behavior;
9. chat, call, and meeting Ask V presence plus in-place participation authorization;
10. subscription preview, provider billing, account pause, termination, and reactivation;
11. operations-display authorization and read-only enforcement;
12. 30-day raw-media deletion and hold suspension;
13. English/Spanish and accessibility parity;
14. additive migration rehearsal and all mandatory repository gates;
15. live web, API, Supabase migration, mobile delivery decision, and TestFlight workflow evidence.
