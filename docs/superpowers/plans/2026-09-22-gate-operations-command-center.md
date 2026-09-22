# Gate Operations Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and full-ship the approved multi-person Gate operations, scheduling, coverage, reporting, reconciliation, Ask V, and iOS parity release through a successful TestFlight submission.

**Architecture:** Work Hub remains the schedule authority; additive Gate duty, work/travel, attendance, coverage-status, reconciliation, and report-delivery records capture actual operations. Web, iOS, and Ask V call shared permission-checked API services, while background workers evaluate coverage and deliver idempotent notifications. Existing Change Over history is preserved and adapted to a roster rather than destructively rewritten.

**Tech Stack:** PostgreSQL and Drizzle ORM, Express 5, TypeScript 5.9, React 19/Vite, Expo 54/React Native, TanStack Query, Vitest, Playwright, SendGrid, Expo Notifications.

**Spec:** `docs/superpowers/specs/2026-09-22-gate-operations-command-center-design.md`

## Global Constraints

- Use additive guarded migrations only; no DROP, TRUNCATE, destructive restore, force push, or drizzle push against production.
- Work Hub is the only schedule source; Gate records actual work, travel, duty, and handoff events.
- Ask V has no elevated authority and executes only through the same permission-checked services as UI clients.
- Explicit unambiguous commands authorize their exact action; Ask V asks at most one material clarification and never adds a redundant submit prompt.
- Live location is explicit, temporary, and limited to worker, active Gate supervisors, and authorized vendor admins.
- Preserve existing uncommitted user work and existing Gate handoff history.
- Web and iOS must expose equivalent authorized behavior; the release is incomplete until TestFlight submission is accepted for processing.

## Review Focus

- A late scheduled worker must remain an attendance exception when another worker restores coverage; Task 3 tests both states independently.
- Worker, site, gate, or assignment ambiguity must not start paid time or Gate duty; Tasks 2 and 9 test exact resolution and one-question recovery.
- A retry or worker restart must not duplicate alerts, duty sessions, reconciliations, or report sends; Tasks 2, 4, 5, and 6 test stable idempotency keys.
- Paused coverage must suppress staffing alerts without disabling authorized Gate work; Tasks 3 and 4 test that distinction.
- A recipient who loses access after a report email is sent must not open the report; Task 6 tests access again at link redemption.

---

### Task 1: Add the additive Gate operations schema and migration

**Files:**
- Modify: `lib/db/src/schema/workHubSchedule.ts`
- Modify: `lib/db/src/schema/gateChangeOver.ts`
- Modify: `lib/db/src/schema/workforceCoverage.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/src/schema/gateOperations.ts`
- Create: `lib/db/drizzle/gate_operations_command_center.sql`
- Create: `artifacts/api-server/src/services/gate-operations-migration.database.test.ts`

**Interfaces:**
- Produces: `gateDutySessionsTable`, `gateWorkSessionsTable`, `gateAttendanceExceptionsTable`, `gateCoverageStatusTable`, `gateVisitReconciliationsTable`, `gateReportDeliveriesTable`.
- Extends: `workHubShiftsTable` with nullable `siteLocationId`, `gateStationId`, `requiredStaffCount`, and `workStartPolicy`.

- [ ] **Step 1: Write the migration replay and compatibility test**

```ts
it("replays additively and preserves an existing active Gate shift", async () => {
  await applyGateOperationsMigration(pool);
  await applyGateOperationsMigration(pool);
  expect(await activeLegacyShiftCount(pool)).toBe(1);
  expect(await relationExists(pool, "gate_duty_sessions")).toBe(true);
});
```

- [ ] **Step 2: Run the focused database test and verify it fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/gate-operations-migration.database.test.ts`
Expected: FAIL because the new migration and tables do not exist.

- [ ] **Step 3: Add typed schema and a guarded SQL migration**

```ts
export type GateWorkStartPolicy = "on_site" | "paid_travel";
export type GateCoverageMode = "active" | "paused_until" | "paused_indefinitely" | "closed";
export type GateAttendanceDisposition = "no_show" | "excused" | "reassigned";
```

The SQL must use `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and idempotent indexes. Backfill each existing active `gate_shifts` row into one duty session using `ON CONFLICT DO NOTHING`; do not delete or rewrite the legacy row.

- [ ] **Step 4: Run schema and migration tests**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/gate-operations-migration.database.test.ts src/services/gate-change-over.database.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the schema slice**

```powershell
git add lib/db/src/schema lib/db/drizzle/gate_operations_command_center.sql artifacts/api-server/src/services/gate-operations-migration.database.test.ts
git commit -m "feat: add gate operations records"
```

### Task 2: Implement multi-person work and Gate duty sessions

**Files:**
- Create: `artifacts/api-server/src/services/gate-duty.ts`
- Create: `artifacts/api-server/src/services/gate-duty.test.ts`
- Modify: `artifacts/api-server/src/services/gate-change-over.ts`
- Modify: `artifacts/api-server/src/routes/gateChangeOver.ts`
- Modify: `artifacts/api-server/src/routes/gateChangeOver.test.ts`

**Interfaces:**
- Produces: `startWorkSession(input)`, `assumeGateDuty(input)`, `endGateDuty(input)`, `endWorkSession(input)`, `getGateRoster(stationId)`.
- Consumes: tables from Task 1 and current Gate membership authorization.

- [ ] **Step 1: Write failing service tests**

```ts
it("allows two workers to assume one station and ends only the caller", async () => {
  const bob = await assumeGateDuty(ctxFor(1), stationId, key("bob"));
  const chad = await assumeGateDuty(ctxFor(2), stationId, key("chad"));
  await endGateDuty(ctxFor(1), bob.id, "handoff complete");
  expect(await getGateRoster(stationId)).toMatchObject([{ id: chad.id, userId: 2 }]);
});
```

Add cases for retry idempotency, ambiguous/mismatched assignments, on-site combined work+duty start, paid-travel work without duty, and last-person handoff enforcement.

- [ ] **Step 2: Run focused tests and verify red**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/gate-duty.test.ts src/routes/gateChangeOver.test.ts`
Expected: FAIL because the roster service and endpoints do not exist.

- [ ] **Step 3: Implement transactions and endpoints**

```ts
type AssumeDutyInput = {
  userId: number; stationId: string; workHubShiftId?: string;
  source: "web" | "ios" | "askv"; idempotencyKey: string; at: Date;
};
```

Lock the station and matching assignment, reuse the prior result for the same idempotency key, and record actual actor identity. Adapt Change Over snapshot and handoff ownership to the roster without deleting legacy shifts.

- [ ] **Step 4: Run the focused duty and existing Change Over suites**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/gate-duty.test.ts src/services/gate-change-over.database.test.ts src/routes/gateChangeOver.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the duty slice**

```powershell
git add artifacts/api-server/src/services/gate-duty* artifacts/api-server/src/services/gate-change-over.ts artifacts/api-server/src/routes/gateChangeOver*
git commit -m "feat: support gate duty teams"
```

### Task 3: Connect Work Hub scheduling, staffing, travel, and attendance

**Files:**
- Modify: `artifacts/api-server/src/routes/workHubOperations.ts`
- Modify: `artifacts/api-server/src/routes/workHubScheduling.test.ts`
- Create: `artifacts/api-server/src/services/gate-attendance.ts`
- Create: `artifacts/api-server/src/services/gate-attendance.test.ts`
- Modify: `artifacts/vndrly/src/pages/work-hub.tsx`
- Create: `artifacts/vndrly/src/pages/work-hub.gate-scheduling.test.tsx`
- Modify: `artifacts/vndrly-mobile/app/work-hub/[module].tsx`
- Create: `artifacts/vndrly-mobile/app/work-hub/calendar.test.tsx`

**Interfaces:**
- Produces: Gate scheduling fields, `startPaidTravel`, `setTravelEta`, `recordTrackingException`, `resolveAttendanceException`.
- Consumes: Task 1 schema and Task 2 work/duty services.

- [ ] **Step 1: Add failing API and UI tests**

```ts
expect(createdShift).toMatchObject({
  siteLocationId: siteId, gateStationId: stationId,
  requiredStaffCount: 2, workStartPolicy: "paid_travel",
});
```

Test that travel starts paid time but not duty; on-site start creates both; GPS failure records an exception without rejecting the start; only supervisor/admin resolves attendance as no-show, excused, or reassigned.

- [ ] **Step 2: Run focused scheduling tests and verify red**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/workHubScheduling.test.ts src/services/gate-attendance.test.ts`
Expected: FAIL on missing Gate fields and services.

- [ ] **Step 3: Implement API fields, validation, and vendor-default selector**

```ts
const gateShiftInput = z.object({
  siteLocationId: z.number().int().positive(), gateStationId: z.string().uuid(),
  requiredStaffCount: z.number().int().min(1).max(20),
  workStartPolicy: z.enum(["on_site", "paid_travel"]),
});
```

Add branded selectors to web and iOS Work Hub forms and show the selected policy to assigned workers. Store ETA without retaining a permanent breadcrumb route.

- [ ] **Step 4: Run service, API, web, and mobile focused tests**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/workHubScheduling.test.ts src/services/gate-attendance.test.ts`
Run: `pnpm --filter @workspace/vndrly exec vitest run src/pages/work-hub.gate-scheduling.test.tsx`
Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run app/work-hub/calendar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit scheduling and attendance**

```powershell
git add artifacts/api-server/src/routes/workHubOperations.ts artifacts/api-server/src/routes/workHubScheduling.test.ts artifacts/api-server/src/services/gate-attendance* artifacts/vndrly/src/pages/work-hub* artifacts/vndrly-mobile/app/work-hub
git commit -m "feat: schedule staffed gate shifts"
```

### Task 4: Evaluate coverage status and deliver repeated alerts

**Files:**
- Modify: `artifacts/api-server/src/services/workforce-coverage.ts`
- Modify: `artifacts/api-server/src/services/workforce-coverage.test.ts`
- Create: `artifacts/api-server/src/services/gate-coverage-monitor.ts`
- Create: `artifacts/api-server/src/services/gate-coverage-monitor.test.ts`
- Modify: `artifacts/api-server/src/routes/implementationAWorkforce.ts`
- Modify: `artifacts/api-server/src/lib/sendgrid.ts`
- Modify: `artifacts/api-server/src/lib/sendgrid.test.ts`

**Interfaces:**
- Produces: `evaluateGateCoverage(at)`, `setGateCoverageStatus`, real `sendNotificationAlertEmail`.
- Consumes: Task 2 roster and Task 3 required staffing/attendance.

- [ ] **Step 1: Write time-controlled failing tests**

```ts
it("alerts after ten minutes, repeats every ten, and sends restoration", async () => {
  await evaluateGateCoverage(at("08:09")); expect(deliveries()).toHaveLength(0);
  await evaluateGateCoverage(at("08:10")); expect(deliveries("uncovered")).toHaveLength(3);
  await evaluateGateCoverage(at("08:20")); expect(deliveries("uncovered")).toHaveLength(6);
  await assumeRequiredStaff(); await evaluateGateCoverage(at("08:21"));
  expect(deliveries("restored")).toHaveLength(3);
});
```

Add cases for understaffed versus uncovered, pause-until auto-reactivation, paused Gate tools remaining operational, duplicate worker execution, and attendance remaining unresolved after coverage restoration.

- [ ] **Step 2: Run focused coverage and email tests and verify red**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/gate-coverage-monitor.test.ts src/lib/sendgrid.test.ts`
Expected: FAIL because the evaluator is absent and general alert email is still skipped.

- [ ] **Step 3: Implement evaluator, persisted delivery dedupe, and SendGrid alert mail**

Use a deterministic delivery key composed from coverage record, state, ten-minute reminder slot, channel, and recipient. Render escaped subject/body content and call the existing SendGrid transport. Production health must reject sandbox mode or missing authenticated sender configuration.

- [ ] **Step 4: Run coverage, notifications, and email suites**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/gate-coverage-monitor.test.ts src/services/workforce-coverage.test.ts src/routes/notifyUsers-comments-matrix.test.ts src/lib/sendgrid.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit coverage monitoring**

```powershell
git add artifacts/api-server/src/services/gate-coverage-monitor* artifacts/api-server/src/services/workforce-coverage* artifacts/api-server/src/routes/implementationAWorkforce.ts artifacts/api-server/src/lib/sendgrid*
git commit -m "feat: alert on gate coverage gaps"
```

### Task 5: Replace stale auto-checkout with audited reconciliation

**Files:**
- Modify: `artifacts/api-server/src/routes/visits.ts`
- Modify: `artifacts/api-server/src/routes/visits.test.ts`
- Create: `artifacts/api-server/src/services/gate-reconciliation.ts`
- Create: `artifacts/api-server/src/services/gate-reconciliation.test.ts`
- Modify: `artifacts/api-server/src/lib/stale-visit-sweeper.ts`

**Interfaces:**
- Produces: `listVisitsNeedingReview`, `reconcileVisit`, `reverseVisitReconciliation`.
- Removes behavior: automatic mutation of an expired open visit into checkout.

- [ ] **Step 1: Rewrite the stale sweep test before product code**

```ts
it("flags stale visits for review without inventing a checkout", async () => {
  await sweepStaleVisits();
  expect(await visit(id)).toMatchObject({ checkOutTime: null, needsReview: true });
});
```

Add tests requiring a reason, preventing cross-site access, making retry idempotent, and allowing reversal only for Gate supervisor/admin while preserving both audit events.

- [ ] **Step 2: Run the focused visit suites and verify red**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/visits.test.ts src/services/gate-reconciliation.test.ts`
Expected: FAIL because current sweep auto-checks out and reconciliation is absent.

- [ ] **Step 3: Implement review marking and reconciliation endpoints**

```ts
type ReconcileVisitInput = { visitId: number; reason: string; idempotencyKey: string };
```

Reconciliation changes occupancy through its explicit audit record, not a fabricated checkout timestamp. Reversal references the reconciliation it reverses.

- [ ] **Step 4: Run visit, public visit, and reconciliation tests**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/visits.test.ts src/services/gate-reconciliation.test.ts`
Run: `pnpm --filter @workspace/e2e exec playwright test tests/visit-public.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit reconciliation**

```powershell
git add artifacts/api-server/src/routes/visits* artifacts/api-server/src/services/gate-reconciliation* artifacts/api-server/src/lib/stale-visit-sweeper.ts lib/e2e/tests/visit-public.spec.ts
git commit -m "feat: reconcile stale gate visits"
```

### Task 6: Build unified Gate reports and secure email delivery

**Files:**
- Create: `artifacts/api-server/src/services/gate-reports.ts`
- Create: `artifacts/api-server/src/services/gate-reports.test.ts`
- Modify: `artifacts/api-server/src/routes/gateReport.ts`
- Create: `artifacts/api-server/src/routes/gateReport.test.ts`
- Modify: `artifacts/api-server/src/app.ts`
- Modify: `artifacts/vndrly/src/lib/gatekeeper-log-export.ts`
- Modify: `artifacts/vndrly/src/pages/gate-history.tsx`
- Modify: `artifacts/vndrly/src/pages/gate-change-over.tsx`

**Interfaces:**
- Produces: one filtered Gate report query contract; PDF/Excel/Word generation; expiring secure report link delivery and redemption.
- Consumes: current session/site permissions, Task 5 reconciliation state, SendGrid transport from Task 4.

- [ ] **Step 1: Write failing scope and redemption tests**

```ts
it("rechecks recipient access when a secure report link is opened", async () => {
  const link = await deliverReport(sender, eligibleRecipient, filters);
  await revokeSiteAccess(eligibleRecipient);
  await expect(openReport(link, eligibleRecipient)).rejects.toMatchObject({ status: 403 });
});
```

Cover full Midcon site scope, subcontractor company-only Gate History, explicit Shift Notes permission, multiple recipients, no free-text address, one-year range, and filter parity across screen/export/email.

- [ ] **Step 2: Run report tests and verify red**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/gate-reports.test.ts src/routes/gateReport.test.ts`
Expected: FAIL because shared server reports and delivery routes are absent.

- [ ] **Step 3: Implement shared query, formats, grants, and secure links**

```ts
type GateReportFilters = {
  siteId: number; stationId?: string; range: "current_shift" | "previous_shift" | "24h" | "7d" | "14d" | "30d" | "90d" | "1y";
  recordType: "all" | "check_ins" | "check_outs" | "visitors_on_site" | "employees_on_site" | "vehicles_on_site" | "pending" | "needs_review";
  search?: string;
};
```

Store a hashed random redemption token, filters, recipient, scope, expiry, and audit. Send only the secure sign-in link.

- [ ] **Step 4: Run server reports and existing client export tests**

Run: `pnpm --filter @workspace/api-server exec vitest run src/services/gate-reports.test.ts src/routes/gateReport.test.ts`
Run: `pnpm --filter @workspace/vndrly exec vitest run src/lib/gatekeeper-log-export.test.ts src/pages/gatekeeper.export-pills.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit reports**

```powershell
git add artifacts/api-server/src/services/gate-reports* artifacts/api-server/src/routes/gateReport* artifacts/api-server/src/app.ts artifacts/vndrly/src/lib/gatekeeper-log-export.ts
git commit -m "feat: deliver secure gate reports"
```

### Task 7: Complete Gate Dashboard, History, Shift Notes, and Gate Mode web UI

**Files:**
- Modify: `artifacts/vndrly/src/pages/gate-change-over.tsx`
- Modify: `artifacts/vndrly/src/pages/gate-change-over.test.tsx`
- Modify: `artifacts/vndrly/src/pages/gate-history.tsx`
- Modify: `artifacts/vndrly/src/pages/gate-history.plate-display.test.tsx`
- Modify: `artifacts/vndrly/src/pages/gatekeeper.tsx`
- Modify: `artifacts/vndrly/src/pages/gatekeeper.test.tsx`
- Modify: `artifacts/vndrly/src/components/gate-portal-layout.tsx`
- Modify: `artifacts/vndrly/src/components/gate-portal-layout.test.tsx`
- Modify: `artifacts/vndrly/src/App.tsx`
- Modify: `artifacts/vndrly/src/components/layout.tsx`

**Interfaces:**
- Consumes: Tasks 2, 4, 5, and 6 APIs.
- Produces: Gate Mode, roster/duty actions, interactive Dashboard metrics, unified branded History/Shift Notes filters and reports.

- [ ] **Step 1: Extend failing web screen tests**

Test Dashboard counter links to Current Shift/type; History defaults Current Shift and exposes every approved range/type; filters drive list/export/email; Needs Review reconciliation and elevated reversal; Gate Mode/Return to Admin; Shift Notes report order; amber sign-out timing; and scoped Check in visitor hover text.

```ts
fireEvent.click(screen.getByRole("button", { name: /check-in records/i }));
expect(location()).toContain("range=current_shift&type=check_ins");
```

- [ ] **Step 2: Run focused web tests and verify red**

Run: `pnpm --filter @workspace/vndrly exec vitest run src/pages/gate-change-over.test.tsx src/pages/gate-history.plate-display.test.tsx src/pages/gatekeeper.test.tsx src/components/gate-portal-layout.test.tsx`
Expected: FAIL on unimplemented UI and routing.

- [ ] **Step 3: Implement the web screens using shared branded controls**

Reuse existing `PngPillButton`, brand resolver, compact pill inputs/selects, standard header/back/icon pattern, and current query client. Preserve the user's existing local Dashboard edits and make all URL filters explicit and shareable.

- [ ] **Step 4: Run focused web tests and production build**

Run: `pnpm --filter @workspace/vndrly exec vitest run src/pages/gate-change-over.test.tsx src/pages/gate-history.plate-display.test.tsx src/pages/gatekeeper.test.tsx src/components/gate-portal-layout.test.tsx`
Run: `pnpm --filter @workspace/vndrly run build`
Expected: PASS.

- [ ] **Step 5: Commit Gate web UI**

```powershell
git add artifacts/vndrly/src/pages/gate-* artifacts/vndrly/src/pages/gatekeeper* artifacts/vndrly/src/components/gate-portal-layout* artifacts/vndrly/src/components/layout.tsx artifacts/vndrly/src/App.tsx
git commit -m "feat: complete gate operations web UI"
```

### Task 8: Synchronize Ask V panel controls and speech waveforms

**Files:**
- Modify: `artifacts/vndrly/src/components/assistant-panel.tsx`
- Modify: `artifacts/vndrly/src/components/askv-status-indicator.tsx`
- Modify: `artifacts/vndrly/src/components/askv-status-indicator.test.tsx`
- Modify: `artifacts/vndrly/src/components/field-ops-portal-shell.tsx`
- Modify: `artifacts/vndrly/src/components/field-ops-portal-shell.test.tsx`
- Modify: `artifacts/vndrly/src/hooks/use-askv-realtime.ts`
- Create: `artifacts/vndrly/src/components/askv-voice-waveform.tsx`
- Create: `artifacts/vndrly/src/components/askv-voice-waveform.test.tsx`

**Interfaces:**
- Produces: shared Ask V panel/mute state and `voiceActivity: "idle" | "user_speaking" | "assistant_speaking"`.
- Consumes: existing realtime listening/thinking/speaking state.

- [ ] **Step 1: Write failing synchronization and accessibility tests**

```ts
fireEvent.click(screen.getByTestId("gate-askv-mute"));
expect(screen.getByRole("dialog", { name: /ask v/i })).toBeVisible();
expect(screen.getByTestId("top-askv-status")).toHaveAccessibleName("Mute Ask V");
```

Test both controls update together, already-open click toggles mute, waveform animates only for speech, and reduced-motion removes animation.

- [ ] **Step 2: Run focused component tests and verify red**

Run: `pnpm --filter @workspace/vndrly exec vitest run src/components/askv-status-indicator.test.tsx src/components/field-ops-portal-shell.test.tsx src/components/askv-voice-waveform.test.tsx`
Expected: FAIL.

- [ ] **Step 3: Hoist panel state and expose trusted speech events**

Use one provider or store for open/focus/mute and render both waveform placements from the same activity state. Listening and thinking remain still; only actual user speech and assistant audio animate.

- [ ] **Step 4: Run focused Ask V UI tests**

Run: `pnpm --filter @workspace/vndrly exec vitest run src/components/askv-status-indicator.test.tsx src/components/field-ops-portal-shell.test.tsx src/components/askv-voice-waveform.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit Ask V controls**

```powershell
git add artifacts/vndrly/src/components/assistant-panel.tsx artifacts/vndrly/src/components/askv-* artifacts/vndrly/src/components/field-ops-portal-shell* artifacts/vndrly/src/hooks/use-askv-realtime.ts
git commit -m "feat: synchronize Ask V voice controls"
```

### Task 9: Expand the Ask V Gate toolbox and language contract

**Files:**
- Modify: `artifacts/api-server/src/assistant/tools.ts`
- Modify: `artifacts/api-server/src/assistant/tool-packs.ts`
- Modify: `artifacts/api-server/src/assistant/natural-voice-write-tools.ts`
- Modify: `artifacts/api-server/src/assistant/natural-voice-write-tools.test.ts`
- Modify: `artifacts/api-server/src/assistant/continuous-work-session.ts`
- Modify: `artifacts/api-server/src/assistant/continuous-work-session.test.ts`
- Modify: `artifacts/api-server/src/assistant/capability-parity.ts`
- Modify: `artifacts/api-server/src/assistant/prompts/system.ts`

**Interfaces:**
- Produces: permission-scoped tools for all services from Tasks 2 through 6 and deterministic Gate intent mappings.
- Consumes: signed-in role/context, user utterance confirmation evidence, trusted device location, and idempotency key.

- [ ] **Step 1: Write failing toolbox and ordinary-language tests**

```ts
it.each([
  ["Morning V, start my day", "start_paid_travel"],
  ["I'm on site, start my Midcon shift", "assume_gate_shift"],
  ["pause Main Gate until October 15 because drilling stopped", "set_gate_coverage_status"],
  ["email last Thursday's gate log to my supervisor", "deliver_gate_report"],
])("maps %s to %s", async (utterance, tool) => expect(await resolve(utterance)).toUse(tool));
```

Add tests for permissions, one missing-detail question, explicit command as confirmation, concise success, cancellation, retry idempotency, restricted recipients, reversal authority, and page-to-tool parity.

- [ ] **Step 2: Run focused assistant tests and verify red**

Run: `pnpm --filter @workspace/api-server exec vitest run src/assistant/natural-voice-write-tools.test.ts src/assistant/continuous-work-session.test.ts`
Expected: FAIL on missing tools and intents.

- [ ] **Step 3: Add tool definitions and runtimes over shared services**

Do not duplicate authorization or mutation logic in the model runtime. Bind every mutating tool to the exact user utterance, action fingerprint, current organization/site, and idempotency key. Suppress model narration while tools run.

- [ ] **Step 4: Run assistant, confirmation, and capability parity suites**

Run: `pnpm --filter @workspace/api-server exec vitest run src/assistant/natural-voice-write-tools.test.ts src/assistant/continuous-work-session.test.ts src/assistant/capability-parity.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit Ask V tools**

```powershell
git add artifacts/api-server/src/assistant
git commit -m "feat: give Ask V complete gate operations tools"
```

### Task 10: Implement complete iOS parity

**Files:**
- Modify: `artifacts/vndrly-mobile/components/GateChangeOver.tsx`
- Modify: `artifacts/vndrly-mobile/components/GateChangeOver.test.tsx`
- Modify: `artifacts/vndrly-mobile/app/(tabs)/gate.tsx`
- Modify: `artifacts/vndrly-mobile/lib/app-navigation.ts`
- Modify: `artifacts/vndrly-mobile/lib/app-navigation.test.ts`
- Create: `artifacts/vndrly-mobile/components/GateHistory.tsx`
- Create: `artifacts/vndrly-mobile/components/GateHistory.test.tsx`
- Create: `artifacts/vndrly-mobile/components/GateDutyCard.tsx`
- Create: `artifacts/vndrly-mobile/components/GateDutyCard.test.tsx`
- Modify: `artifacts/vndrly-mobile/lib/locales/en.json`
- Modify: `artifacts/vndrly-mobile/lib/locales/es.json`

**Interfaces:**
- Consumes: the same APIs, permissions, and URL/filter semantics as web.
- Produces: iOS Gate dashboard, duty/travel/attendance, History, Shift Notes reports, reconciliation, Gate Mode, and Ask V action parity.

- [ ] **Step 1: Write failing mobile screen and navigation tests**

Test Dashboard default, Work Hub/Gate/History/Shift Notes order, Assume Shift and individual sign-off, paid travel versus on-site start, Current Shift History, reports, Needs Review, Gate Mode return, and concurrent roster display.

- [ ] **Step 2: Run focused mobile tests and verify red**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run components/GateChangeOver.test.tsx components/GateHistory.test.tsx components/GateDutyCard.test.tsx lib/app-navigation.test.ts`
Expected: FAIL.

- [ ] **Step 3: Implement native screens with existing shared components**

Use Expo Router, safe-area-aware scroll containers, current brand components, and native accessibility labels. Do not make client-side authorization decisions or queue offline mutations.

- [ ] **Step 4: Run focused mobile tests, locale parity, and mobile typecheck**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run components/GateChangeOver.test.tsx components/GateHistory.test.tsx components/GateDutyCard.test.tsx lib/app-navigation.test.ts`
Run: `pnpm lint:i18n`
Run: `pnpm --filter @workspace/vndrly-mobile run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit iOS parity**

```powershell
git add artifacts/vndrly-mobile
git commit -m "feat: complete iOS gate operations parity"
```

### Task 11: Integrate, review, and verify the exact release tree

**Files:**
- Modify: `lib/e2e/tests/gate-change-over.spec.ts`
- Create: `lib/e2e/tests/gate-operations.spec.ts`
- Modify: `docs/ios-askv-parity-backlog.md`
- Modify: all files required to fix findings without reducing test scope.

**Interfaces:**
- Consumes: all prior tasks.
- Produces: exact verified tree eligible for release.

- [ ] **Step 1: Add cross-surface browser scenarios**

Cover two simultaneous workers, coverage gap and restoration, admin Gate Mode, Dashboard-to-History filtering, reconciliation/reversal, secure report link access, and concise Ask V commands.

- [ ] **Step 2: Run fast gates and focused end-to-end tests**

Run: `pnpm lint:i18n`
Run: `pnpm run typecheck`
Run: `pnpm --filter @workspace/e2e exec playwright test tests/gate-change-over.spec.ts tests/gate-operations.spec.ts`
Expected: PASS.

- [ ] **Step 3: Run all mandatory repository gates**

Run: `pnpm run test:libs`
Run: `pnpm run test:web`
Run: `pnpm run test:mobile`
Run: `pnpm run test:api`
Run: `pnpm run test:e2e`
Expected: PASS without excluding or weakening unrelated tests.

- [ ] **Step 4: Run production builds and communication smoke**

Run: `pnpm --filter @workspace/vndrly run build`
Run: `pnpm --filter @workspace/api-server run build`
Run: `pnpm --filter @workspace/vndrly-mobile run build`
Run: `pnpm run smoke:communications`
Expected: PASS, including SendGrid configuration readiness without sending Gate personal data to an unauthorized address.

- [ ] **Step 5: Review the complete diff and fix every validated finding**

Run: `git diff --check`
Run: `git status --short`
Expected: only intended release files; no generated static build or secret material.

- [ ] **Step 6: Commit the verified integration**

```powershell
git add --all
git commit -m "feat: ship gate operations command center"
```

### Task 12: Full ship through successful TestFlight submission

**Files:**
- Read: `docs/release-fast-path.md`
- Modify only when a demonstrated release failure requires a source fix.

**Interfaces:**
- Consumes: exact verified commit from Task 11.
- Produces: updated main, live web/API/migrations, production OTA, and submitted TestFlight build.

- [ ] **Step 1: Confirm remote main parent and publish the branch non-force**

Run the repository's configured publication path, verify current remote main is an ancestor, push the exact commit, and advance main without rewriting history.

- [ ] **Step 2: Monitor web, API/migration, and OTA workflows concurrently**

Verify the Publish workflow, API Deploy workflow with guarded migration, production iOS OTA, public Gate route, API health, and communications health. If a workflow fails, retrieve its exact logs, fix the root cause, rerun focused verification, and retry under the standing authorization.

- [ ] **Step 3: Dispatch and monitor the native TestFlight workflow**

Run the production TestFlight workflow for the exact release commit. Stay on it through build and submission failures; do not substitute an OTA for the native submission.

- [ ] **Step 4: Record terminal release evidence**

Record the commit, main advancement, workflow results, production migration result, public web/API verification, OTA update group, TestFlight build/submission status, and commit-to-live elapsed time. Completion requires Apple to accept the TestFlight submission for processing; App Store release remains out of scope.
