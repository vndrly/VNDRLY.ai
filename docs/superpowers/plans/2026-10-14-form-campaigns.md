# Form Campaigns Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. One fresh whole-feature review follows implementation; no implementer subagents.

**Goal:** Add company-scoped policy acknowledgement and poll campaigns with time horizons, response receipts, durable reminders, daily owner briefings and iOS/web/AskV parity.

**Architecture:** Extend existing form templates with versioned campaign configuration/state, reuse per-employee instance snapshots and immutable submissions, and add a focused campaign service/router. A clock-injected worker claims scheduled actions under a campaign lock and queues notifications through the existing durable notification table. Native and web clients share contracts and permission-scoped result projections.

**Tech Stack:** Existing TypeScript, Express, Drizzle/PostgreSQL, Zod, React Native/Expo, React, existing notification and command services. No new external dependencies.

**Spec:** ../specs/2026-10-14-form-campaigns-design.md (approved by user)

## Global Constraints
- Work in C:/Users/JohnElerick/.codex/worktrees/vndrly-ios-web-preview; preserve existing uncommitted Meetings, task completion and assignment fixes.
- No shared database reset, destructive migration, credential changes or actual employee notification during testing.
- MidCon security-policy draft stays unpublished until actual policy text/attachment is supplied. No invented policy or employee receipts.
- Acknowledgement deadline defaults to 30 elapsed days after publication; poll defaults to 24 elapsed hours. Persist server-calculated UTC deadline and IANA timezone.
- Daily briefing is optional; default 08:00 local company time, America/Chicago for MidCon. Respect preferences and quiet hours.
- Named acknowledgement is mandatory; poll named/anonymous, single/multiple choices, vote edits and result timing are independent configuration choices.
- Existing installed-plugin identity and grants remain unchanged. Local code does not imply installed/public plugin availability or native-device verification.
- Isolated database integration is an acknowledged blocker. Do not use the destructive root API test wrapper; continue safe tests and report transaction/e2e verification gaps.

## Review Focus
- An ordinary form submission endpoint must not bypass campaign deadline, choices, acknowledgement or anonymity rules.
- A lost response, worker restart or concurrent publication must not duplicate assignments, votes, notifications or briefings.
- Anonymous answers must never leak through existing admin/search/export/assistant surfaces; own-response receipt remains available only to its employee.
- Removed/suspended membership, sign-out and organization switching must invalidate drafts, private results and pending writes.
- Daylight-saving transitions, exact close instant and absent push delivery must produce honest canonical states.

## File Map and Shared Interfaces
Create `lib/api-zod/src/form-campaigns.ts`: config, command payloads, employee receipt and owner/aggregate result schemas. Export through `lib/api-zod/src/index.ts`.

Create `artifacts/api-server/src/work-hub/form-campaign-policy.ts`: pure configuration/deadline/response/result-visibility rules with injected clock. `campaignCanSubmit(config,state,now)` and `validateCampaignResponse(config,values)` have no database side effects.

Create `artifacts/api-server/src/work-hub/form-campaign-service.ts`: current signed actor checks, draft/publish/assign/submit/manage commands, receipts, progress and results. Reuse command idempotency and audit but bind fingerprint to actor, campaign, effective payload and expected version.

Create `artifacts/api-server/src/routes/workHubFormCampaigns.ts`: authenticated no-store HTTP adapter for shared contracts; register in routes/index.ts.

Create `artifacts/api-server/src/work-hub/form-campaign-worker.ts`: due-work claiming and scheduled execution, recoverable notification queueing, audience expansion and local-date briefing dedupe. Start/stop through src/index.ts.

Create native components under `artifacts/vndrly-mobile/components/work-hub/`: `FormCampaignEditor.tsx`, `FormCampaignList.tsx`, `FormCampaignResponse.tsx`, `FormCampaignProgress.tsx`. Focused hook `lib/use-form-campaigns.ts` owns account-scoped reads and exact retry identity. Routes `app/work-hub/form/[instanceId].tsx` and `app/work-hub/campaign/[campaignId].tsx` open employee/owner surfaces.

Create corresponding web components under `artifacts/vndrly/src/components/work-hub/form-campaigns/` and integrate pages/work-hub.tsx/App.tsx. Use current branded components and shared modal chrome.

## Task 1: Contracts, pure rules and additive persistence
**Files:** Create shared contracts and policy module/tests; modify lib/db/src/schema/workHubWork.ts; add lib/db/drizzle/chunk_417_form_campaigns.sql and artifacts/api-server/scripts/apply-form-campaigns-migration.mjs; update api-server/package.json/deploy-api.yml.

**Persistence:** Add nullable JSONB campaignConfig/campaignState fields on form templates and nullable campaignVersion integer on instances. Keep existing snapshots/submission tables. NULL denotes ordinary forms and preserves their behavior. Campaign state includes draft/published/closed/paused, publishedAt/deadline, stateVersion and durable schedule receipts/next work times. Existing template row lock serializes audience assignments; checking existing template-version/user instances under that lock prevents duplicates without destructive schema work.

**Contracts:** Config has kind, content/policyVersion, choices/selection limit, anonymity, allowVoteChanges, resultsTiming, audience mode/member IDs, rollingAudience, duration, timezone, reminder cadence, briefing time/channel, escalation user/delay. Reject acknowledgement anonymity, empty policy publication, duplicate choice IDs, unknown timezone, invalid selection limits and incompatible settings. Defaults are explicit.
- [ ] Write failing tests for 30-day/24-hour defaults, exact poll close, allowed late acknowledgement, explicit true acknowledgement, selection validation and visibility rules.
- [ ] Run focused tests, observe RED, implement minimum schema/policy, rerun GREEN.
- [ ] Inspect migration: ADD COLUMN IF NOT EXISTS only. Never apply to shared database during local implementation.
- [ ] Build DB/API-Zod declarations and run API/mobile/web contract typechecks. Record evidence and scoped commit.

## Task 2: Draft, publication and authorized audience
**Files:** Create service/router plus service/route tests; modify routes/index.ts and existing work-hub command helpers only if required for exact fingerprints.

**Endpoints:** GET/POST `/work-hub/form-campaigns`; GET/PATCH `/:campaignId`; POST `/:campaignId/publish`; POST `/:campaignId/pause`. Commands use standard owner/context/payloadVersion/operationId/expectedVersion envelope. Actor comes from signed session. Draft write returns command receipt; publish receipt includes audience counts, canonical deadline and notificationState=queued, never delivered.

**Audience:** Administrator/owner authorization and current company membership are reread at write time. All-active snapshot and selected audience derive only eligible company users; rolling expansion stops at deadline. Removed users remain historical/excluded, not completed. Escalation recipient must be a current authorized same-company supervisor/admin.
- [ ] RED tests for wrong-company owner/recipient, suspended user, stale signed session, empty policy publish, duplicate publish, operation-ID reuse with a different campaign/payload and concurrent roster expansion.
- [ ] Implement transaction with template row lock, deterministic audience derivation, exact snapshot instances, audit and durable invite queue. No real publishing in tests.
- [ ] Read back canonical campaign/instances/operation receipt in isolated fixtures; document unavailable real DB race verification.
- [ ] GREEN focused tests and typechecks; scoped commit/ledger.

## Task 3: Employee submission and private result projections
**Files:** Extend campaign service/router; modify routes/workHubOperations.ts form submit, required-actions/admin/search projections; inspect/modify applicable form export services and assistant raw-form reads. Create response/projection regression tests.

**Endpoints:** GET `/work-hub/form-campaigns/instances/:instanceId`; POST `.../:instanceId/respond`; GET `/:campaignId/progress`; GET `/:campaignId/results`. Exact employee links use `/work-hub/form/:instanceId`; owner links use `/work-hub/campaign/:campaignId`.

**Submission:** Lock campaign and instance; validate current assigned employee, current membership/session, expected version, immutable policy snapshot and server deadline inside persistence transaction. Reuse immutable submission history for allowed edits; receipt includes policy/instance version, submittedAt and late flag. Anonymous poll answers are anonymous to other users/owners through supported interfaces, not cryptographically anonymous against database operators. Progress exposes turnout, not individual anonymous answers.
- [ ] RED tests for foreign employee, deadline bypass through old /forms/:id/submit, explicit acknowledgement false, malformed choices, edit forbidden, duplicate retry, exact-close race and stale account publication.
- [ ] Implement shared submission path; old endpoint delegates campaign instances to it rather than bypassing rules. Keep ordinary form behavior.
- [ ] RED then GREEN tests for anonymous leaks through admin, search, export and assistant projections, early results, own-response access and late acknowledgement.
- [ ] Record policy revision as new campaign/version; never overwrite old policy receipts.
- [ ] Focused route/export/access tests and typechecks; scoped commit/ledger.

## Task 4: Recoverable schedules, reminders and briefings
**Files:** Worker/tests, services/notification-delivery.ts recipient revalidation extension and tests, lib/notification-destination.ts and deep-link authorization tests, src/index.ts.

**Interface:** `runFormCampaignWork(now:Date, dependencies)` processes bounded batches. Dependencies provide clock, repository, audience and notification queue; production uses DB implementation. Worker claims template row with SKIP LOCKED, calculates due occurrence IDs and writes receipt/next work time atomically with queued notice. Durable inbox survives push failure. Delivery rechecks current membership, campaign/instance visibility and current preferences.
- [ ] RED tests advance injected clock through 30 days, 24 hours, exact close, daily local briefing, DST change, reminder due, response suppression, overdue escalation, pause and process restart.
- [ ] Implement invitation, nonresponder reminder, stored owner briefing snapshots, close/final results and optional escalation with occurrence-specific notification dedupe. Never infer delivery from queue status.
- [ ] Test rolling membership before deadline and exclusion after removal; denominator accounting shows excluded recipients separately.
- [ ] Test simultaneous worker claims, crash/retry receipts and push failure persistence; distinguish mocked tests from DB concurrency proof.
- [ ] GREEN tests/types, scoped commit/ledger; no real messages or production worker enablement locally.

## Task 5: iOS and web campaign workflows
**Files:** Native/web components/hook/routes named above; existing TaskAssignment.tsx, app/work-hub/[module].tsx, app/work-hub/record.tsx, home Tasks & Forms/My Work surfaces, pushDeepLinks.ts and login return handling. EN/ES locale files in both artifacts.
- [ ] RED screen tests for acknowledgement editor review, poll A/B/C/D defaults, 30-day/24-hour deadline display, selectable audience, rolling option and expandable reminder/briefing settings.
- [ ] Implement draft/review/publish UI; publish requires actual content and exact review. MidCon security draft has an explicit missing-policy state and no notifications.
- [ ] Implement assigned campaign list, direct employee form route, required acknowledgement, single/multiple choice vote, countdown, saved receipt and allowed vote edit. Opening a page does not acknowledge.
- [ ] Implement owner progress/results/briefings with named receipt vs anonymous aggregate boundary, overdue and excluded counts. No misleading percentages when audience changes.
- [ ] Test account change during reads/writes, double tap, lost response/frozen original retry, server conflict, offline poll submitted after close and readonly expired poll. Failed/queued/saved states must be distinct.
- [ ] Register HTTPS web and native push routes with exact UUID validation and login destination preservation. Test routing; do not claim actual native push delivery without devices.
- [ ] Run affected mobile/web tests, both typechecks and locale parity; scoped commit/ledger.

## Task 6: AskV/MCP/plugin parity and synthetic draft
**Files:** assistant/work-hub-tools.ts, work-hub-tool-runtime.ts, capability-parity.ts, chatgpt-workspace.ts and tests; routes/assistantConnection.ts; integrations/chatgpt-plugin manifests/skills/references; docs campaign usage.
- [ ] RED tool tests for campaign list/detail, progress/results, draft/create/publish, self-response, pause/manage and exact receipt behavior. Keep existing required confirmations for assistant writes.
- [ ] Delegate to same server contracts. Owner brief displays authorized counts; anonymous results stay aggregated. Model cannot manufacture acknowledgement on behalf of employees or bypass deadlines/permissions.
- [ ] Add human-clickable form/campaign links and correct queued delivery labels to embedded views; preserve plugin identity/accounts/grants.
- [ ] Prepare a synthetic or local unpublished MidCon security draft example, clearly missing actual policy content; no company database write or employee notification without publication content.
- [ ] Validate package metadata/tool parity/types and focused tests; record candidate vs installed/public status.

## Task 7: Final review and verification
- [ ] Obtain one fresh whole-feature review under executing-plans and fix important findings with regression tests. No repeated design approval during execution.
- [ ] Run exact-tree typechecks, affected API tests, mobile/web suites, locale parity, package validation and git diff --check. Run transaction/e2e only if a safe empty isolated DB exists; otherwise report accepted blocker.
- [ ] Inspect staged scope; preserve previous uncommitted user changes and unrelated scripts. Record commits, passed/failed checks, product gaps and environment blockers.
- [ ] Verify real-device push/login/native forms only if a supported runner/device exists. Production/native/plugin release lanes remain separate and unverified until performed.
- [ ] Handoff actual implemented capabilities, draft-content requirement and remaining isolated DB/device/deployment evidence. Do not call a draft a published policy campaign.

## Execution Choice
Recommended: direct implementation in this session with executing-plans; maintain a ledger at docs/superpowers/plans/2026-10-14-form-campaigns-ledger.md and keep progress updates. This plan requires approval before product implementation under the brainstorming workflow. No new dependency or destructive operation is proposed.
