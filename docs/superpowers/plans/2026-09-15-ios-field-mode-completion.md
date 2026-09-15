# iOS Field Mode Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox syntax for tracking.

**Goal:** Complete the approved iOS Field Mode, Gate, trip-loop, live-sync, privacy, and Ask V behavior and submit the verified release to TestFlight.

**Architecture:** Extend Implementation A. A pure mobile policy reducer decides effects, one app coordinator executes them, the API preserves active trips across hauling loops and exposes explicit completion, and scoped Gate events invalidate authoritative queries.

**Tech Stack:** Expo/React Native, TypeScript, React Query, Express, Drizzle/PostgreSQL, Zod, Vitest, Playwright, EAS Update, EAS Build, App Store Connect.

**Spec:** docs/superpowers/specs/2026-09-15-ios-field-mode-completion-design.md

## Global Constraints

- Preserve AskVVoiceProvider as the only microphone and conversation owner.
- Add no external dependency.
- Use guarded additive database changes only.
- Never collect location outside active work.
- Keep mutations idempotent, scoped, audited, and version protected.
- Keep English and Spanish locale keys paired.
- Start every production behavior with a failing test.
- Completion requires successful TestFlight submission.

---

### Task 1: Hauling-loop trip lifecycle

**Files:** artifacts/api-server/src/services/field-trips.ts and tests; artifacts/api-server/src/routes/implementationATrips.ts and tests; lib/api-zod/src/implementation-a/trips.ts; Implementation A schema and guarded migration.

**Produces:** completeTrip input with tripId, expectedVersion, actorUserId, reason, and needsSupervisorConfirmation; POST /api/implementation-a/trips/:tripId/complete; exit no longer completes tracking.

- [ ] Add failing service tests for exit preserving the trip, repeated re-entry, explicit completion, idempotency, and stale-version conflict.
- [ ] Run and confirm expected failures.
- [ ] Add the minimum lifecycle and additive completion metadata.
- [ ] Add failing route tests for driver self-completion, authorized supervisor completion, and organization/site scope.
- [ ] Add the Zod contract and completion route.
- [ ] Run focused service and route tests.
- [ ] Commit the verified trip slice.

### Task 2: Deterministic iOS Field Mode policy

**Files:** create artifacts/vndrly-mobile/lib/field-mode-policy.ts and test; modify active-shift-tracking.ts and test.

**Produces:** evaluateFieldMode(snapshot, event) returning a new snapshot and effects: start, announce_ready, arrival, departure, prompt_end_work, prompt_extended_stop, stop_tracking, and supervisor_exception.

- [ ] Add failing tests for scheduled arrival, hauling loops, shift end, unassigned departure, 15-minute no-answer, 45-minute offsite stop, escalation, and no prompt while on site.
- [ ] Confirm failures because the policy is absent.
- [ ] Implement the immutable reducer without UI, network, Expo, or timers.
- [ ] Integrate active-shift state and run focused tests.
- [ ] Commit the verified policy slice.

### Task 3: App-level coordinator

**Files:** create hooks/use-field-mode.ts and test; create components/FieldModeStatus.tsx and test; modify app/_layout.tsx, liveLocationReporter.ts, and paired locales.

**Produces:** one authenticated coordinator beside AskVVoiceProvider.

- [ ] Add failing hook tests for consented work-only startup, once-only effects, foreground safety, and stop-before-escalation.
- [ ] Implement injected clock, location, notification, and transport adapters.
- [ ] Add failing UI tests for visible work tracking and manual end work.
- [ ] Implement accessible status and paired locale copy.
- [ ] Mount the coordinator once and rerun focused tests.
- [ ] Commit the verified coordinator slice.

### Task 4: Live Gate invalidation

**Files:** create API gate-events module and tests; modify gatekeeper routes; create native gate-events adapter and tests; modify Gate screen and tests.

**Produces:** role- and site-scoped sequence events that invalidate Gate active/recent queries, plus reconnect and foreground fallback.

- [ ] Add failing server tests for same-site delivery, cross-site filtering, reconnect gaps, and authorization.
- [ ] Implement the minimal scoped event publisher using existing event-bus patterns.
- [ ] Add failing native tests for delivery, gap refresh, cancellation, and fallback.
- [ ] Implement the dependency-free adapter.
- [ ] Add a failing Gate screen test for remote refresh within two seconds and selected-site scope.
- [ ] Connect query invalidation and run focused API/mobile tests.
- [ ] Commit the verified live-Gate slice.

### Task 5: Ask V Gate ownership and input recovery

**Files:** Ask V provider/session tests; Gate screen/tests; gate-voice-entry and tests; askv-client-tools and tests.

**Produces:** one audio owner and structured Gate draft recovery for missing name, short plate, missing jurisdiction, history match, and camera offer.

- [ ] Retain and run the shipped global Ask V tests.
- [ ] Add failing tests proving Gate push-to-talk cannot compete with global Ask V.
- [ ] Add failing parser tests for each incomplete-input case.
- [ ] Implement audio arbitration and structured recovery.
- [ ] Connect Ask V intents to the Gate draft without navigation or session replacement.
- [ ] Run all focused Ask V and Gate tests.
- [ ] Commit the verified voice slice.

### Task 6: Supervisor exceptions and privacy stop

**Files:** operations-health service/tests; workforce route/tests; field-mode hook/tests; mobile OperationsHealth component.

**Produces:** one deduplicated exception per unresolved work event; system faults enter health while user corrections do not.

- [ ] Add failing tests for unresolved Gate, end-work, extended-stop, and deduplicated supervisor delivery.
- [ ] Add failing tests separating input recovery from system failure.
- [ ] Implement existing notification escalation integration.
- [ ] Prove location stops before unattended escalation.
- [ ] Run focused API and mobile tests.
- [ ] Commit the verified exception/privacy slice.

### Task 7: Full verification and unattended release

- [ ] Run locale parity, typecheck, and the complete web/mobile/API/browser suite.
- [ ] Review the exact diff and exclude unrelated local files.
- [ ] Commit and push the verified tree; advance main without force after checking its remote parent.
- [ ] Run Publish, API Deploy, Mobile OTA, and Mobile TestFlight together.
- [ ] Verify the live site, Gate, API health, and Expo production update.
- [ ] Verify the new iOS build is successfully submitted to TestFlight.
- [ ] Report commit, workflows, public checks, TestFlight status, and commit-to-live time.
