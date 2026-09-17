# Ask V Minimal Scheduling Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Let Ask V resolve crews, check real participant availability, suggest the earliest valid meeting times, and create a minimally specified meeting after one confirmation, while keeping the server contract reusable by a later iOS client.

**Architecture:** Add one privacy-safe scheduling availability module shared by the availability endpoint and the meeting-create transaction. Expose it through a read-only Ask V tool, then update Ask V guidance so omitted optional fields are defaulted rather than questioned. Existing web and future iOS clients both call the same server-side tools and permissions.

**Tech Stack:** TypeScript, Express 5, Drizzle ORM, Zod, Vitest, PostgreSQL advisory locks.

**Constraints:** No database migration. Tasks do not block time. Travel buffers remain zero unless a real configured source exists. Approved time off is included only if an existing authoritative record is found; no synthetic availability source will be invented. This release publishes web and any required API changes, but does not run iOS OTA or TestFlight.

---

### Task 1: Shared participant-availability policy

**Files:**
- Create: `artifacts/api-server/src/work-hub/meeting-availability.ts`
- Test: `artifacts/api-server/src/work-hub/meeting-availability.test.ts`
- Reference: `artifacts/api-server/src/work-hub/scheduling-policy.ts`
- Reference: `lib/db/src/schema/workHubSchedule.ts`
- Reference: `lib/db/src/schema/workHubMeetings.ts`

1. Write failing unit tests for overlap behavior, meetings and assigned shifts as hard conflicts, tasks as non-blocking, privacy-safe conflict shapes, and earliest 15-minute candidate slots.
2. Run the focused test and confirm it fails because the module does not exist.
3. Implement the smallest pure slot finder plus a Drizzle query that returns only user, kind, start, and end for meetings and assigned shifts.
4. Re-run the focused test and confirm it passes.

### Task 2: Read-only Ask V availability tool

**Files:**
- Modify: `artifacts/api-server/src/assistant/work-hub-tools.ts`
- Modify: `artifacts/api-server/src/assistant/work-hub-tool-runtime.ts`
- Modify: `artifacts/api-server/src/assistant/work-hub-toolbox.test.ts`
- Modify: `artifacts/api-server/src/assistant/work-hub-tool-runtime.test.ts`

1. Add failing toolbox and runtime tests for `find_work_hub_meeting_times`.
2. Run the two focused tests and confirm the missing tool/route failures.
3. Add the read-only scheduling tool contract and map it to `POST /work-hub/scheduling/availability-check`.
4. Re-run the tests and confirm they pass.

### Task 3: Availability endpoint

**Files:**
- Modify: `artifacts/api-server/src/routes/workHubScheduling.ts`
- Test: `artifacts/api-server/src/routes/workHubScheduling.test.ts`

1. Add failing route tests covering tenant membership, requested-slot availability, privacy-safe conflicts, and ordered alternatives.
2. Run the focused route test and confirm failure.
3. Implement the authenticated endpoint using the shared availability module, with a 30-minute default duration, bounded result limit, and creator-provided timezone echoed for display.
4. Re-run the route tests and confirm they pass.

### Task 4: Transactional create-time recheck

**Files:**
- Modify: `artifacts/api-server/src/routes/workHubOperations.ts`
- Test: `artifacts/api-server/src/routes/workHubOperations.test.ts` or the nearest existing meeting-create test file

1. Add a failing test showing a meeting cannot be created over an assigned shift or another meeting after participant locks are acquired.
2. Run the focused test and confirm the current route incorrectly creates the overlap.
3. Reuse the shared availability query inside the existing transaction after advisory locks and before inserts. Return a structured 409 with privacy-safe conflicts and fresh alternatives.
4. Re-run the focused test and confirm no meeting is inserted on conflict.

### Task 5: Minimal-input and single-confirmation Ask V behavior

**Files:**
- Modify: the existing assistant system-guidance source under `artifacts/api-server/src/routes/assistant.ts` or its referenced prompt module
- Modify: `artifacts/api-server/src/assistant/work-hub-tools.ts`
- Test: the nearest existing assistant prompt/tool-policy test

1. Add a failing contract test for concise scheduling guidance: resolve crews using existing crew tools, default optional title and 30-minute duration, use creator timezone without asking, call the availability tool, disclose only that a participant is busy, offer earliest alternatives, and ask one final confirmation before writing.
2. Run the focused test and confirm the guidance is absent.
3. Add the minimal scheduling guidance and make the meeting write tool accept server-safe defaults for omitted optional fields while retaining required timestamps, participants, and timezone context.
4. Re-run the focused test and confirm it passes.

### Task 6: Verification and web/API release

**Files:**
- Update if needed: `docs/plans/2026-09-17-ask-v-minimal-scheduling-design.md`
- Update if needed: the saved iOS parity backlog/documentation already used by this project

1. Run focused availability, scheduling-route, toolbox, runtime, meeting-create, and assistant-policy tests.
2. Run API type-check and API tests. Reuse the already-green unchanged web build evidence unless shared code changes require rebuilding web.
3. Review the exact diff for privacy leaks, tenant isolation, confirmation boundaries, and unrelated changes.
4. Commit the backend package with the already-committed Calendar UI package, push the branch, advance `main` non-force, and publish the web/API paths required by the changed files.
5. Verify the public web page and API health endpoint. Do not trigger iOS OTA or TestFlight for this explicitly web/API-only release.
