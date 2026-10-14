# Work Hub Library, Bundles, Training and Onboarding Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement directly in this session, task-by-task. One fresh whole-feature reviewer at the end; no implementer agents.

**Goal:** Give company administrators a versioned content library, reusable onboarding bundles, group/individual distribution and employee training checklists with optional scored quizzes.

**Architecture:** Add guarded metadata columns to existing form templates/instances, retain immutable content/assignment snapshots, reuse campaign commands and notification scheduling. Focused library, assignment, onboarding and training services share current membership authority and exact operation receipts. Employees and administrators receive separate safe projections.

**Tech Stack:** Existing TypeScript, Zod, Drizzle/Postgres, Express, React Native/Expo, React, existing object store and notification queue. No new dependencies.

**Spec:** ../specs/2026-10-14-work-hub-library-onboarding-design.md. Base spec approved; user-requested Training extension awaits written review together with this plan before implementation.

## Global constraints
- Reuse C:/Users/JohnElerick/.codex/worktrees/vndrly-ios-web-preview; preserve unrelated Meetings/Fleet/Chat changes and scripts.
- No shared Supabase reset, DROP/TRUNCATE, reseeding, credential rotation or real employee notification during tests.
- Actual MidCon policies/training remain unpublished until supplied; never invent employee achievements.
- Defaults: policy deadline 720 elapsed hours from employee assignment; polls retain original closing instant; required-before-work off; new-hire auto-enrollment targets memberships created after rule activation.
- Published content and bundles are immutable versions. Archive, close poll and cancel assignments are distinct audited actions.
- Named policies/forms/training; anonymous polls remain aggregate-only. Answer keys never enter employee snapshots or public reads.
- Preserve EN/ES runtime translation correctness, branded two-pixel cards/pills and visible option tracks.
- Isolated database integration blocker is already accepted; no reset wrapper against shared data. Distinguish local tests, native devices, production migration/deployment and installed plugin status.

## Review focus
- Overlapping bundles, repeated first entry and lost assignment responses must not duplicate obligations or consume quiz attempts.
- A new hire after the original policy deadline gets a fresh relative deadline; a closed poll is omitted and reported, never reopened.
- Quiz answer keys cannot leak through legacy template/instance/search/export/assistant APIs or error details.
- Account/group membership changes revoke access and prevent stale reads, writes, push delivery and cross-company assignments.
- Optional required work gates must be server-enforced across Field/Fleet/Gate/assistant routes while leaving safety and essential communications accessible.

## File responsibilities and shared interfaces
- `lib/api-zod/src/work-hub-library.ts`: LibraryMetadata, BundleDefinition, AssignmentMetadata, training author/private versus employee/public schemas and command/read contracts; export in index.ts.
- `lib/db/src/schema/workHubWork.ts`: nullable template libraryMetadata/bundleDefinition and instance assignmentMetadata columns. `lib/db/drizzle/chunk_418_work_hub_library.sql`: ADD COLUMN IF NOT EXISTS only. `artifacts/api-server/scripts/apply-work-hub-library-migration.mjs`: guarded runner, migrate:work-hub-library package/deploy entry.
- `artifacts/api-server/src/work-hub/library-policy.ts`: pure version/archive/field validation and content projection.
- `library-service.ts`: current-company content CRUD/revision/publication/archive and library discovery; existing ordinary forms adapt as legacy entries.
- `library-audience.ts`: authorized company groups/crews/current member expansion with deduplicated preview.
- `library-assignments.ts`: reviewed single/bundle assignment, exact pinned versions, deadlines, existing completion reuse/explicit renewal, cancellation and owner/employee progress.
- `training-policy.ts`: pure grading and completion requirements. `training-service.ts`: own progress, immutable quiz attempts/receipts and protected answer-key reads.
- `onboarding-service.ts`: current membership ensure, rule activation/cutoff, presentation decisions and refresher claims. `onboarding-worker.ts`: bounded recovery scan and schedules, no credential assumptions.
- `required-work-guard.ts`: shared authoritative start-work gate/exemption checks, used by existing Field/Fleet/Gate mutation boundaries.
- `artifacts/api-server/src/routes/workHubLibrary.ts`: authenticated no-store adapter; register in routes/index.ts.
- Native `components/work-hub/library/`: LibraryWorkspace, LibraryEditor, BundleEditor, AssignmentReview, EmployeeChecklist, TrainingResponse, OwnerAssignments. `lib/use-work-hub-library.ts`: reuse safe campaign read/retry patterns, exact record and context guards. Routes `app/work-hub/library/[itemId].tsx`, `bundle/[bundleId].tsx`, `checklist/[assignmentId].tsx`, `training/[instanceId].tsx`.
- Web `src/components/work-hub/library/`: matching focused components/hook; pages/work-hub.tsx and App.tsx integrate routes/tabs.
- Shared owner/employee contracts feed assistant work-hub-tools/runtime, capability-parity, chatgpt-workspace, plugin skills/manifests and docs.

## Task 1: Contracts, persistence and content rules
**Interfaces:** library metadata `{kind,seriesId,contentVersion,state,publishedAt,archivedAt}`; bundle pinned entry references `{templateId,contentVersion,dueHours,presentation,requiredBeforeWork}`; assignment metadata includes bundle/version/membership/generation/renewal/cancel/presentation/receipt origin. Training separates private answer keys from employee lesson/question snapshots.
- [ ] Write failing pure tests for published immutability, archived distribution, unique field/question/option IDs, invalid correct selections, date/number/choice required validation and relative policy versus absolute poll deadlines.
- [ ] Run focused vitest RED, implement contracts/library-policy/training-policy minimum and rerun GREEN. Grading uses exact multiple-answer sets and unrounded pass ratio.
- [ ] Add nullable guarded metadata columns and runner; inspect SQL for additive-only statements. Do not apply locally to shared Supabase.
- [ ] Build DB/API-Zod declarations; check API/mobile/web contracts and commit scoped files.

## Task 2: Company library and versioned authoring
**Endpoints:** GET/POST `/work-hub/library`; GET/PATCH `/:itemId`; POST `/:itemId/revise`, `/publish`, `/archive`; GET `/work-hub/library/options`. Standard owner/context/operationId/payloadVersion/expectedVersion envelopes.
- [ ] RED tests for wrong-company/current-session rejection, draft edit, immutable publication, duplicate/revision receipts and source attachment authorization.
- [ ] Implement draft create/update, private admin author read, safe employee published preview, new immutable revision and archive. Reuse private attachment snapshot integrity; no raw object locators in public projections.
- [ ] Adapt ordinary forms into library discovery without changing prior submission behavior. New internal bundles/training records are fenced from raw legacy admin/required-actions/search/export endpoints.
- [ ] Test training answer-key exclusion from every supported employee read/assistant/export path, including malformed IDs and archived dependencies. Run GREEN/types and commit.

## Task 3: Bundles and reviewed individual/group assignments
**Endpoints:** GET/POST `/work-hub/bundles`; GET/PATCH `/:bundleId`; POST `/publish`, `/archive`; POST `/work-hub/library/assignment-preview`, `/assign`; GET `/work-hub/library/assignments`; POST `/assignments/:assignmentId/cancel`. Preview returns eligible IDs/counts, existing obligations/completions, omitted expired items, versions and prospective deadlines; reviewed confirmation binds its fingerprint.
- [ ] RED tests for group/individual overlap, foreign group member, suspended user, changed roster between preview/assign, existing completion reuse, explicit renewal and conflicting retries.
- [ ] Resolve eligible recipients from existing authorized company groups/crews and memberships. Snapshot audience at assignment; no implicit future enrollment from group membership unless onboarding configured.
- [ ] Lock bundle/content and assignment origin; create employee obligations with pinned safe snapshots and deterministic idempotency. Reuse campaign dissemination for cohort-specific policy/form deadlines without modifying old campaign deadlines. Closed polls are omitted with canonical reason.
- [ ] Named policy/form/training assignments are independent of anonymous poll response projections. Reviewed cancel preserves receipts/history and does not complete obligations.
- [ ] Verify pure/mock dedupe and routing, document unavailable DB concurrent proof, GREEN/types and scoped commit.

## Task 4: Employee checklist, training progress and scored attempts
**Endpoints:** GET `/work-hub/library/to-complete`; GET `/training/instances/:instanceId`; PATCH `/progress`; POST `/attempt`; POST `/complete`; GET owner assignment detail/attempts; POST admin `/attempt-reset` with explicit reason.
- [ ] RED tests for own-instance authorization, missing checkoff, quiz required despite checkoffs, exact pass threshold, multiple-answer scoring, retry limit and same-operation replay without consuming attempts.
- [ ] Store progress separately from completion in assignment metadata; immutable attempt history includes exact version, answers, grade and receipt. Assignment row lock serializes updates/submission; final acknowledgement only on explicit employee action.
- [ ] Completed/Passed is emitted only when configured requirements are met. Employee views show score/status, remaining retries and receipts; private answer keys stay withheld during retries. Admin reset/exemption is audited and never fabricates passing.
- [ ] Revalidate account/path identity before displaying data or applying returned receipts; test A-to-B navigation and account switching during read/write.
- [ ] GREEN policy/service adapter tests and types; commit.

## Task 5: New-hire rules, first entry and recoverable schedules
**Endpoints:** POST `/bundles/:bundleId/onboarding-rule` (review enable/disable/target/cutoff); POST `/work-hub/library/entry` (current authenticated company only); POST `/checklists/:assignmentId/presented`. Never require unauthenticated access.
- [ ] RED tests for post-activation memberships only, explicit existing-employee distribution, duplicate entry/worker restart, rejoining membership, archived dependencies and expired polls.
- [ ] `ensureOnboarding(actor, now)` completes idempotent due assignment before first-entry checklist. A bounded SKIP LOCKED worker catches newly created memberships and configured refreshers; deterministic occurrence IDs prevent duplicate obligations after restart.
- [ ] First-entry/next-login/immediate presentation comes from canonical pending state; safety or essential deep links remain accessible and preserve intended destination. Mark presented only after actual display, not push queueing.
- [ ] Reuse durable queue for invitations, nonresponder reminders, owner daily briefs and escalation. Recheck current membership/preferences before sending. Refresher completion retains earlier training receipts and creates a distinct new obligation.
- [ ] Test time advance/removal/exclusions/quiet hours/recovery in safe mocks; record DB/device limits, GREEN/types and commit.

## Task 6: Optional authoritative requirements before work
**Interfaces:** `assertRequiredWorkClear(tx, actor, owner, now)` returns authorized pending reasons or throws structured `work_hub.required_completion`; `recordRequiredWorkExemption(actor, assignmentId, reason, envelope)` produces audited receipt.
- [ ] Inventory and test actual Field ticket start/check-in, Fleet run start and Gate duty-start services, including their assistant routes. Tests must cover lower-level service bypass, not only UI buttons.
- [ ] Add shared guard inside each persistence boundary after actor/company checks, so stale helper results cannot permit start. Do not gate login, reading forms, reporting safety, emergency communications or admin remediation.
- [ ] RED required-versus-optional, current content version, cancelled/excluded, stale membership and exemption tests; implement then GREEN. Exemption preserves who/why and never creates an employee acknowledgement.
- [ ] Document unsupported start boundary as an actual gap until wired; do not claim enforcement from a client redirect. Typecheck and commit.

## Task 7: Work Hub native/web screens and navigation
- [ ] RED screen tests for To Complete/Library/Bundles/Assignments tabs, filters, published revision/archive actions, form field builder, training checkoffs/questions and bundle composition.
- [ ] Build focused branded components with two-pixel cards, shared pills/modals and tracked switches. Add searchable individual/group selection and review of actual current counts/versions/deadlines. iPad/web details sit beside list; phones use focused detail routes.
- [ ] Employee quiz supports saved progress, explicit submission, score/retry state and receipt; loading, failed, queued, uncertain and complete remain distinct. Lost result retries frozen operation, never silently creates another assignment/attempt.
- [ ] Integrate first-entry/next-login presentation in native login/_layout and web authenticated navigation, preserving essential/deep-link routes. Live foreground refresh shows online assignments; push routes validate exact IDs after login and company checks.
- [ ] Add EN/ES keys; test actual initialized i18n and locale parity, not mocked key rendering. Verify visible preview state without publishing company content. Run targeted/full appropriate suites/types, commit.

## Task 8: AskV/plugin parity, review and release handoff
- [ ] RED tool tests for library/bundle/assignment discovery, safe training read, draft/revise/publish/assign/archive/cancel/onboarding management, own progress/quiz submit and current exact versions. Retain standard confirmation-bound writes.
- [ ] Add safe embedded Library/Bundle/Checklist/Training/Owner progress views with exact human links and response receipts. Never manufacture employee completions, quiz answers or answer keys; assistant bypasses share server work guards.
- [ ] Update existing-identity plugin manifests/guidance and validate package. Record local candidate versus installed/submitted/approved/public status honestly.
- [ ] Obtain one fresh whole-feature review; fix important findings once with meaningful regression checks. Preserve unrelated worktree changes in scoped commits.
- [ ] Run final declarations, API/mobile/web types, affected safe tests, locale checks, package validation and diff check. Run integration/native proof only with an available safe isolated DB/device; report accepted blockers explicitly.
- [ ] Document real policy/training publication requirements and migration/deployment/device/plugin release evidence. No real bulk notification or company policy publication during implementation. Full ship, if requested, follows all eight standing release tracks and does not call local work deployed.

## Execution handoff
Recommended: direct implementation in this session using executing-plans. Tasks share contracts and authorization boundaries, so one implementer plus one fresh final reviewer avoids parallel conflicting changes. Review the Training spec extension and this concrete plan before implementation. Base library/onboarding design approval remains preserved; do not ask the same scope questions again.
