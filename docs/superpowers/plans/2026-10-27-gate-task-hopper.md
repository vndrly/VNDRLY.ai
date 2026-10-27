# Gate Task Hopper Implementation Plan

> Execute inline using executing-plans. Preserve the existing local compact-handoff changes. Do not deploy without a deploy request.

**Goal:** Replace live carry-forward actions with vendor-owned unassigned tasks, completable by any gatekeeper on that vendor's active paid shift, independently of watch custody or individual gate/site assignments.

**Architecture:** Reuse Work Hub tasks and task events as the single record. Add nullable gate-hopper metadata through a guarded additive migration; preserve existing handoff snapshots and source action history. Use the canonical Workday clock to authorize completion in the same transaction as the task update. Calendar entries project completed tasks rather than creating duplicate events.

**Spec:** Agreed in this conversation: newest-first hopper; create at a vendor gate/site; Dashboard and Work Hub category; complete with person/time/note and calendar link; admin assign or remove with retained history; existing open actions imported once. Vendor-wide access, not a personal gate assignment. Only one worker need hold the watch during overlapping shifts.

**Global constraints:** No new dependencies, destructive schema/data operations, credential changes, watch/shift/sign-in side effects, or mobile release work. Existing completed history stays intact. Existing task behavior outside hopper tasks remains intact.

**Review focus:** Cross-vendor reads/writes; clock ending concurrently with completion; duplicate requests and concurrent assignment/completion; ambiguous legacy ownership; completed tasks appearing on the correct employee/date without changing existing due dates.

## Task 1 — Canonical task service and migration
- [ ] Add gate-hopper metadata to `lib/db/src/schema/workHubWork.ts` and a guarded additive migration under `artifacts/api-server/scripts/`; wire its package command and API deployment migration step.
- [ ] Implement `services/gate-task-hopper.ts` and `routes/gateTaskHopper.ts`: verified vendor/manager access, vendor-contractor gates, create/list/read, versioned assign/complete/clear, retained task-event receipts, and oldest-source/newest-display legacy import with unambiguous company attribution only.
- [ ] Export a verified active-clock assertion from `services/workday.ts`, sharing its transaction locks with shift ending.
- [ ] Test authorization, overlap, replay, concurrency, retained history, and migration safety against an isolated test database.

## Task 2 — Handoff and existing task integration
- [ ] Integrate hopper records into live snapshot items while preserving immutable saved handoffs and legacy endpoint compatibility.
- [ ] Keep generic task mutations from bypassing hopper permissions and completion notes.
- [ ] Exclude active unassigned hopper tasks from ordinary assigned-task status counts; include completions for their actual completing worker.

## Task 3 — Web views and calendar
- [ ] Build shared `gate-task-hopper.tsx` controls and client types for create, newest-first lists, completion note, task detail, admin assign and clear/delete.
- [ ] Use them inside the handoff card, Tasks module, and collapsible Dashboard/Work Hub Unassigned Tasks category; retain saved snapshot facts and notes.
- [ ] Project completion time, worker, gate/site and note into the existing Task calendar category with exact-task links; preserve ordinary task scheduling.
- [ ] Verify focused UI workflows, exact-task links, category counts, and mobile layout.

## Task 4 — Verification and handoff
- [ ] Batch affected web/API tests and locale/type checks; fix regressions within this feature.
- [ ] Review the complete diff for authorization boundaries and retained records. Record verified results and any environment limitations. No production publication is included in this request.
