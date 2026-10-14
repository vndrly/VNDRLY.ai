# Live Company Meetings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Native execution in this session is recommended; one fresh reviewer checks the completed change.

**Goal:** Start company meetings immediately, discover live rooms, invite members and admit requests through consistent app, notification and assistant surfaces.

**Architecture:** Extend the existing meeting/participant records with additive admission fields. A focused live-meeting service owns discovery and transactional commands; existing room routes consume its admission guard. Notification and assistant adapters consume the same service, preserving existing device leases and command audit/idempotency.

**Tech Stack:** Existing TypeScript, Express, Drizzle/Postgres, React Native/Expo, web React, notification service and AskV/MCP registry. No new external dependencies.

**Spec:** `../specs/2026-10-14-live-meetings-design.md` (approved; commit `1d73dfbe`).

## Global Constraints

- Company-only discovery and admission require current non-suspended membership; links convey no access grant.
- New admission choices are `company_open` and `host_approval`, defaulting to host approval. Null fields preserve legacy participant-only meetings.
- Admission is independent of optional attendance confirmation, default off; no individual recording-permission prompts or manufactured consent records.
- Default planned duration is 60 minutes, overnight rollover is allowed, and planned end never disconnects a live room.
- Existing native voice/device-lease protections and unfinished internal transcription changes remain intact. No external speech fallback.
- Only guarded `ADD COLUMN IF NOT EXISTS` migrations; no shared database reset, credential change, new provider or automatic production publication.
- Canonical mobile meeting destination is `/work-hub/meeting/:occurrenceId`. Validate identifiers and ownership on all entry paths.
- Live polling is 5 seconds while foregrounded, paused in background and refreshed immediately on return.
- No video or Codex audio/video bridge is claimed. Assistant parity provides authorized reads, commands and human-clickable room links.

## Review Focus

- Pending users must be denied every room-data and signaling endpoint, including chat, transcript, files and capture, not only Join.
- Ending a meeting, switching admission mode or revoking membership during concurrent admission cannot grant stale access.
- Cold-start push/login and wrong-company links preserve the intended destination without silently changing company context.
- Lost responses/retries cannot create duplicate meetings, join requests, decisions or invitations.
- Push failures and dismissed popups cannot erase pending requests or prevent inbox visibility; owner authority is rechecked on decisions.

## Shared contracts

Create `artifacts/api-server/src/work-hub/live-meetings.ts` exporting:

- `listLiveMeetings(actor): Promise<LiveMeetingSummary[]>` — current owner's live rooms and caller's admission state, no protected room data.
- `startLiveMeeting(actor, envelope): Promise<LiveMeetingReceipt>` — title, agenda, admissionMode, participantUserIds; server-owned start and planned end.
- `requestMeetingAdmission(actor, occurrenceId, envelope): Promise<AdmissionReceipt>`.
- `decideMeetingAdmission(actor, occurrenceId, targetUserId, envelope): Promise<AdmissionReceipt>` — decision admit/decline and expected version.
- `inviteLiveMeetingMembers(actor, occurrenceId, envelope): Promise<LiveMeetingReceipt>`.
- `changeMeetingAdmission(actor, occurrenceId, envelope): Promise<LiveMeetingReceipt>`.
- `requireRoomAdmission(reader, actor, occurrenceId): Promise<void>` — current membership, nonremoved admitted participant and room state; legacy null behavior retained.

Actor uses the existing validated session type; envelopes use existing Work Hub command owner/context/operationId/version schema. Summary contains occurrenceId, title, agenda, host display name, startedAt, plannedEndsAt, connectedCount, admissionMode, ownAdmissionState, requestedAt and canManage. AdmissionReceipt contains occurrenceId, targetUserId, admissionState, requestedAt, decidedAt, decidedById and version. LiveMeetingReceipt contains canonical summary and notification delivery state (`queued`, never assumed delivered). Share response schemas through `lib/api-zod` rather than separate mobile/web interpretations.

### Task 1: Admission schema, policy and migration

**Files:** Modify `lib/db/src/schema/workHubMeetings.ts`; create `lib/db/drizzle/chunk_416_live_meeting_admission.sql`, `artifacts/api-server/scripts/apply-live-meeting-admission-migration.mjs`, `artifacts/api-server/src/work-hub/meeting-admission-policy.ts` and `.test.ts`; modify API package scripts and `.github/workflows/deploy-api.yml`.

**Produces:** `meetingAdmissionDecision(input): {discover:boolean;enter:boolean;request:boolean;manage:boolean}` with explicit current membership, actor/owner, meeting status/mode, participant state/removal and target state inputs. DB fields exactly match spec: meeting admissionMode; participant admissionState, admissionRequestedAt, admissionDecidedAt, admissionDecidedById. All nullable for legacy compatibility.

- [ ] Write failing policy tests for legacy invited, open current member, approval pending/admitted/declined, outsider, suspended/revoked member, removed participant, host and current company admin. Assert pending cannot enter and session admin label alone cannot manage.
- [ ] Run direct API vitest for `meeting-admission-policy.test.ts`; confirm expected missing-policy failure.
- [ ] Implement pure policy and additive schema/migration runner using the existing guarded migration convention; register migration in API deployment.
- [ ] Run policy tests, inspect SQL for additive-only operations, and rebuild DB declarations. Do not apply against shared DB during this task.
- [ ] Commit only Task 1 files after passing checks.

### Task 2: Transactional live commands and room guard

**Files:** Create `artifacts/api-server/src/work-hub/live-meetings.ts`, `live-meetings.test.ts`, `artifacts/api-server/src/routes/workHubLiveMeetings.ts` and route tests; modify `routes/index.ts`, `routes/workHubMeetings.ts`, `routes/workHubOperations.ts`; create shared `lib/api-zod/src/live-meetings.ts` and export it through its existing index.

**Consumes/produces:** Policy from Task 1; exports all Shared contracts. Routes under `/api/work-hub/live-meetings`: GET listing, POST start; `/:occurrenceId` GET lobby, POST request-admission, POST admission/:userId, POST invitations, PATCH admission-mode. Writes consume command envelope; returned receipts validate against shared schemas.

- [ ] Write failing service/route tests: start retry returns same occurrence; owner admitted, invitees pending for approval; duplicate request remains one row; open join creates admitted participant; removed member cannot reopen access; unauthenticated/wrong-company discovery fails; concurrent admit/end and conflicting decisions produce canonical guarded result. Cover revoked host authority and mode changes preserving existing admissions.
- [ ] Run new focused API tests and confirm missing-contract failures.
- [ ] Implement commands using existing executeWorkHubCommand and narrow row locking. Owner/current admin checks and target membership checks occur inside the transaction. Planned end is start+60 minutes; status/start reflect live activity immediately.
- [ ] Add shared admission guard to existing room context. Audit endpoints outside that context and guard every protected room/chat/transcript/file/signaling/capture read and write. Admission-only lobby routes authorize current company membership without requiring a participant first.
- [ ] Extend scheduled create payload with admissionMode and persist pending/admitted states consistently while preserving legacy records and attendance-confirmation behavior.
- [ ] Run focused route/service tests and typecheck. Use a newly created empty isolated test database for transaction tests; never invoke the wrapper that resets shared data. Test real locks/idempotent canonical readback in that isolated database.
- [ ] Commit Task 2 files only.

### Task 3: Durable notifications and meeting destinations

**Files:** Create `artifacts/api-server/src/work-hub/live-meeting-notifications.ts` and `.test.ts`; modify existing notification delivery adapters only where required; modify `artifacts/vndrly-mobile/lib/pushDeepLinks.ts`, its `lib/__tests__/pushDeepLinks.test.ts`, `notification-destination.ts`, `notification-deep-links.ts` and associated tests; modify login/universal-link resolver at the existing routing boundary as required.

**Produces:** `queueLiveMeetingNotification(event)` where event is invitation/request/granted/declined/ended with occurrence/org/recipient identifiers and dedupe identity. Destination resolver returns validated canonical mobile route or access/error state, preserving intended route across login.

- [ ] Write failing tests for duplicate notification intent, failed push preserving inbox/retry, target current membership, exact occurrence route, malformed identifier, unsupported URL, foreground/background/cold-start taps and wrong-company links.
- [ ] Run focused API/mobile destination tests and confirm failures.
- [ ] Connect committed service events to existing durable notification delivery/dedupe instead of detached best-effort push. Existing user/device preferences remain respected; queued and delivered are separate states.
- [ ] Normalize in-app, push, universal and copied HTTPS links to one meeting identifier. Login resumes that room; wrong context never silently switches or redirects to unrelated operations.
- [ ] Run destination and notification tests, typechecks, and a synthetic inbox canonical readback. Real native push tap remains a separately evidenced device check.
- [ ] Commit Task 3 files only.

### Task 4: Mobile Meetings, live lobby and host controls

**Files:** Modify `artifacts/vndrly-mobile/app/(tabs)/work-hub.tsx`, its `app/__tests__/work-hub-home-cards.test.tsx`, `components/WorkHubMeetings.tsx`, `MeetingScheduling.tsx`, `app/work-hub/[module].tsx`, `app/work-hub/meeting/[occurrenceId].tsx`; create `components/MeetingStartNow.tsx`, `MeetingAdmissionLobby.tsx`, `MeetingWaitingRoom.tsx` and their meaningful flow tests; update en/es locales.

**Consumes:** Task 2 schemas/receipts and Task 3 routing. Start now and host decisions use captured auth scope, stable command identity across retry, canonical readback and existing API abstraction.

- [ ] Read the existing room route `app/work-hub/meeting/[occurrenceId].tsx` and record its integration boundaries in the execution ledger; preserve existing room media and company-policy work.
- [ ] Write failing UI tests for exactly Chats/Calls/Meetings; start popup default host approval and optional description; Live now action per admission state; pending member stays in lobby; admin/owner can admit; dismissal preserves waiting count; end/revocation makes actions unavailable; company switch clears private room/request state.
- [ ] Run focused tests; confirm failures describe missing behavior.
- [ ] Build responsive Live now/Upcoming/History and start popup using current branded components, compact buttons and 2px search. Remove duplicate company chat row and rename Invitations to Meetings.
- [ ] Add room header Invite/Copy link and host waiting-room popup/side panel. Poll live state every 5 seconds foreground only; dedupe request popups and retain pending panel independent of notification read status.
- [ ] Extend scheduler admission choice while retaining description/date/time/default duration/overnight and optional attendance confirmation. Admission UI contains no recording opt-out prompt.
- [ ] Run mobile tests/typecheck/locale parity. Verify phone and iPad browser UI with synthetic data without sending real invitations. Save screenshots of the final page and waiting-room states.
- [ ] Commit Task 4 files only.

### Task 5: Web and AskV/plugin parity

**Files:** Modify `artifacts/vndrly/src/pages/work-hub.tsx`, `src/lib/work-hub-client.ts` and their meeting/client tests; modify `artifacts/api-server/src/assistant/work-hub-tools.ts`, `work-hub-tool-runtime.ts`, `work-hub-toolbox.test.ts`, `work-hub-tool-runtime.test.ts`, `capability-parity.ts` and tests; modify `assistant/chatgpt-workspace.ts`, `chatgpt-operations-workspace.ts` and workspace tests plus `routes/assistantConnection.ts` for matching MCP exposure; modify `integrations/chatgpt-plugin/skills/vndrly-work-hub/SKILL.md`, `references/operations.md` and `plugin.json`.

**Produces:** Tools `list_live_meetings`, `get_live_meeting`, `start_live_meeting`, `request_meeting_admission`, `decide_meeting_admission`, `invite_live_meeting_members`, `change_meeting_admission`; all delegate to Task 2 shared contracts under validated caller context. Register existing canonical plugin prefixes through the current tool registry, without duplicate implementations.

- [ ] Read the listed web and embedded workspace adapters and record their integration boundaries in the ledger. Read brand doctrine before adding web actions.
- [ ] Write failing web/assistant tests for employee read/request, owner/admin decisions, denied outsider/host-revoked context, confirmation-bound command writes, stable retry and canonical readback. Tool results distinguish pending/admitted/ended and queued delivery.
- [ ] Run focused tests and confirm expected failures.
- [ ] Add web lobby/host controls matching mobile semantics and link routes; add tools and permission-scoped embedded controls using shared service, existing confirmation/idempotency/audit and capability-parity conventions.
- [ ] Update plugin documentation/package metadata for the new tools and human-clickable room links. Do not claim Codex audio/video joining or deliver task messages/system notifications.
- [ ] Run focused web/assistant/registry tests, typechecks and plugin package validation; verify one synthetic authorized read and harmless request with canonical readback in isolated test context.
- [ ] Commit Task 5 files only; installation/publication waits for an authorized release command.

### Task 6: Final verification and handoff

- [ ] Run required repository validation for the exact final tree: typecheck, web tests, locale parity, mobile tests, API integration and e2e. API tests must use a fresh empty isolated database without a reset/wipe; diagnose environmental inability explicitly rather than run on shared data.
- [ ] Run synthetic two-member scenarios: open join, request/admit, request/decline, removed member, host revocation, end/admit race, failed push and login link restoration. Capture canonical records, not only UI success.
- [ ] Obtain one fresh whole-change review under executing-plans skill and fix findings in one pass with covering regression tests. Maintain a concise task/review ledger alongside this plan.
- [ ] Inspect diffs for unintended unrelated changes and run `git diff --check`. Preserve existing transcription work and report its remaining native/runtime blockers separately.
- [ ] Verify native push foreground/background/cold start and two-device audio only if a supported native runner/device is available. Otherwise report those as unverified; never infer native success from web tests.
- [ ] Handoff implemented surfaces, tests/evidence, exact commits and actual remaining blockers. No production migration/deployment or App Store submission is implied by this local implementation plan.
