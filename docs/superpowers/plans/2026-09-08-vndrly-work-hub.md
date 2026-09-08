# VNDRLY Work Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship one native web-and-iOS VNDRLY Work Hub release with tenant-safe collaboration, work coordination, audio meetings, optional read-only Microsoft calendar sync, and the approved adjacent AskV/Gate/homepage checklist.

**Architecture:** Add a first-party Work Hub domain to the existing Express/Drizzle monorepo, with all access mediated by one context-capability service and all mutations using durable idempotency and version checks. Web and Expo clients consume generated contracts, the current notification/SSE/push/storage/AskV foundations, and provider-neutral audio/calendar adapters. Internal milestones stay behind server flags until one integrated release is verified.

**Tech Stack:** Node.js 24, TypeScript 5.9, Express 5, PostgreSQL/Supabase, Drizzle ORM, Zod/OpenAPI/Orval, React 19/Vite/Wouter/TanStack Query, Expo 54/React Native 0.81/Expo Router, Supabase Storage, SSE, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-08-vndrly-work-hub-design.md`

## Global Constraints

- Planning does not approve an audio, recording, or transcription provider; select one only through Task 12's decision gate before installing a package or configuring an account.
- Microsoft 365 is optional and read-only for one selected Outlook/shared/company calendar; VNDRLY schedules remain authoritative.
- Every tenant-owned read, mutation, event, search result, notification, file download, export, connector callback, and AskV source must pass the shared context-capability service.
- Every client mutation requires a UUID idempotency key; versioned updates require the expected server version.
- iOS must durably queue supported writes/uploads, bind them to user and organization, retry with backoff, and prevent duplicates.
- All schema changes are additive and guarded: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, idempotent indexes, and read-only prechecks before constraints. Never drop, truncate, wipe, overwrite, force-push, or restore over live data.
- Existing ticket/Hotlist comment endpoints and ticket-scoped PTT clips remain canonical and are projected into Work Hub; do not destructively migrate them.
- New customer strings must ship in web and mobile English/Spanish locales and pass `pnpm lint:i18n`.
- Work Hub, audio meetings, optional connector, and adjacent checklist are one final release; internal milestones are not independently marketed or generally enabled.

## File map

- `lib/db/src/schema/workHub*.ts`: focused Drizzle tables grouped by collaboration, work, scheduling, meetings, connectors, and governance.
- `lib/api-zod/src/work-hub/*.ts`: handwritten command, query, event, error, provider, and connector contracts.
- `artifacts/api-server/src/work-hub/*.ts`: authorization, commands, queries, events, notifications, offline reconciliation, search, audit, retention, exports, and adapters.
- `artifacts/api-server/src/routes/workHub*.ts`: validation-only Express route adapters.
- `artifacts/vndrly/src/features/work-hub/`: web routes, panels, hooks, and capability-driven UI.
- `artifacts/vndrly-mobile/features/work-hub/`: mobile hooks, sync/upload queues, view models, and shared adaptive UI.
- `artifacts/vndrly-mobile/app/work-hub/`: Expo Router screens.
- `lib/e2e/tests/work-hub*.spec.ts`: integrated role, isolation, offline, notification, search, and release flows.

---

### Task 1: Feature flags, shared contracts, and stable codes

**Files:**
- Create: `lib/api-zod/src/work-hub/common.ts`
- Create: `lib/api-zod/src/work-hub/commands.ts`
- Create: `lib/api-zod/src/work-hub/events.ts`
- Create: `lib/api-zod/src/work-hub/providers.ts`
- Create: `lib/api-zod/src/work-hub/index.ts`
- Create: `lib/api-zod/src/work-hub/common.test.ts`
- Modify: `lib/api-zod/src/index.ts`
- Modify: `lib/db/src/schema/platformSettings.ts`
- Create: `lib/db/drizzle/chunk_394_work_hub_flags.sql`
- Create: `artifacts/api-server/scripts/apply-work-hub-flags-migration.mjs`
- Modify: `artifacts/api-server/package.json`

**Interfaces:**
- Produces: `WorkHubOwner`, `WorkHubContextRef`, `WorkHubCapability`, `WorkHubCommandEnvelope<T>`, `WorkHubCommandResult<T>`, `WorkHubEventEnvelope`, `RealtimeAudioProvider`, `TranscriptionProvider`, `CalendarConnector`, and stable `work_hub.*` error codes.
- Produces: platform flags `workHubEnabled`, `workHubMeetingRecordingEnabled`, `workHubMicrosoft365Enabled`, `workHubExportsEnabled` with false defaults.

- [ ] **Step 1: Write contract tests that reject invalid owner/context pairs and non-UUID operation ids**

```ts
import { describe, expect, it } from "vitest";
import { workHubCommandEnvelopeSchema } from "./commands";

describe("work hub command envelope", () => {
  it("requires a UUID operation id and explicit tenant owner", () => {
    expect(workHubCommandEnvelopeSchema.safeParse({ operationId: "1" }).success).toBe(false);
    expect(workHubCommandEnvelopeSchema.safeParse({
      operationId: "60fb5c6d-4164-4b3f-baa1-1d7095426633",
      owner: { type: "vendor", id: 12 },
      context: { kind: "ticket", id: 481 },
      expectedVersion: 1,
      payloadVersion: 1,
      payload: {},
    }).success).toBe(true);
  });
});
```

- [ ] **Step 2: Run `pnpm --filter @workspace/api-zod test` and verify the new import fails**

- [ ] **Step 3: Implement the exact shared schemas/interfaces and export them from `lib/api-zod/src/index.ts`**

```ts
export const workHubOwnerSchema = z.object({
  type: z.enum(["vendor", "partner"]),
  id: z.number().int().positive(),
});
export const workHubContextRefSchema = z.object({
  kind: z.enum(["organization", "ticket", "site", "crew", "gate"]),
  id: z.union([z.number().int().positive(), z.string().min(1).max(160)]),
});
export const workHubCommandEnvelopeSchema = z.object({
  operationId: z.string().uuid(),
  owner: workHubOwnerSchema,
  context: workHubContextRefSchema,
  expectedVersion: z.number().int().nonnegative().nullable(),
  payloadVersion: z.literal(1),
  payload: z.unknown(),
});
```

- [ ] **Step 4: Add false-default platform columns and guarded migration/apply script following the existing `apply-askv-greeting-migration.mjs` pattern**

- [ ] **Step 5: Run the contract test, `pnpm lint:i18n`, and `pnpm run typecheck`**

- [ ] **Step 6: Commit `feat(work-hub): define flags and shared contracts`**

### Task 2: Additive core collaboration schema

**Files:**
- Create: `lib/db/src/schema/workHubChannels.ts`
- Create: `lib/db/src/schema/workHubMessages.ts`
- Create: `lib/db/src/schema/workHubFiles.ts`
- Create: `lib/db/src/schema/workHubNotes.ts`
- Create: `lib/db/src/schema/workHubOperations.ts`
- Create: `lib/db/src/schema/workHubGovernance.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/drizzle/chunk_395_work_hub_core.sql`
- Create: `artifacts/api-server/scripts/apply-work-hub-core-migration.mjs`
- Modify: `artifacts/api-server/package.json`
- Create: `artifacts/api-server/src/work-hub/schema-invariants.test.ts`

**Interfaces:**
- Consumes: Task 1 owner/context enum values.
- Produces: core tables named exactly as the spec's collaboration/governance list and unique operation key `(user_id, command_kind, operation_id)`.

- [ ] **Step 1: Write database invariant tests for duplicate context channels, duplicate operations, and append-only message/note versions**

```ts
it("rejects a second channel for the same owner and context", async () => {
  await insertChannel(owner, context);
  await expect(insertChannel(owner, context)).rejects.toMatchObject({ code: "23505" });
});
```

- [ ] **Step 2: Run the isolated API test file and confirm missing-table failure**

- [ ] **Step 3: Define Drizzle tables with UUID public ids, owner columns, foreign keys, version columns, timestamps, soft-delete metadata, and indexes for channel/message/read/search hot paths**

- [ ] **Step 4: Write `chunk_395_work_hub_core.sql` using only guarded additive statements and make its apply script record the migration checksum**

- [ ] **Step 5: Run the migration twice against the isolated test database; verify the second run makes no changes and all invariant tests pass**

- [ ] **Step 6: Commit `feat(work-hub): add collaboration data model`**

### Task 3: Central context authorization and audit

**Files:**
- Create: `artifacts/api-server/src/work-hub/context-access.ts`
- Create: `artifacts/api-server/src/work-hub/context-access.test.ts`
- Create: `artifacts/api-server/src/work-hub/audit.ts`
- Create: `artifacts/api-server/src/work-hub/audit.test.ts`
- Create: `artifacts/api-server/src/work-hub/feature-access.ts`

**Interfaces:**
- Consumes: existing session, `user_org_memberships`, ticket/site/crew/gate relationship rules, and Task 2 governance tables.
- Produces: `resolveWorkHubAccess(session, subject): Promise<WorkHubAccess>` and `requireWorkHubCapability(access, capability): void`.

- [ ] **Step 1: Write a two-vendor/two-partner authorization matrix including shared ticket/site access, vendor-private organization/crew access, gate-company site scope, revoked membership, and cross-tenant ids**

```ts
expect(await resolveWorkHubAccess(vendorAAdmin, vendorAChannel)).toContain("channel.manage");
expect(await resolveWorkHubAccess(partnerShared, sharedTicketChannel)).toContain("channel.read");
await expect(resolveWorkHubAccess(vendorBAdmin, vendorAChannel)).rejects.toMatchObject({
  status: 404,
  code: "work_hub.not_found",
});
```

- [ ] **Step 2: Run the matrix and confirm failures before the service exists**

- [ ] **Step 3: Implement owner/context resolution and return an immutable capability set; keep SQL owner predicates inside this module**

```ts
export type WorkHubAccess = Readonly<{
  owner: WorkHubOwner;
  context: WorkHubContextRef;
  capabilities: ReadonlySet<WorkHubCapability>;
  visibilityRevision: string;
}>;
```

- [ ] **Step 4: Implement `appendWorkHubAudit` with actor, effective org, action, subject/version, source, operation id, and redacted metadata**

- [ ] **Step 5: Run the unit matrix and isolated API tests**

- [ ] **Step 6: Commit `feat(work-hub): enforce contextual tenant access`**

### Task 4: Idempotent commands, channels, messages, reactions, unread, and legacy projection

**Files:**
- Create: `artifacts/api-server/src/work-hub/commands.ts`
- Create: `artifacts/api-server/src/work-hub/queries.ts`
- Create: `artifacts/api-server/src/work-hub/legacy-comments.ts`
- Create: `artifacts/api-server/src/work-hub/events.ts`
- Create: `artifacts/api-server/src/routes/workHubChannels.ts`
- Create: `artifacts/api-server/src/routes/workHubEvents.ts`
- Create: `artifacts/api-server/src/routes/workHubChannels.test.ts`
- Create: `artifacts/api-server/src/routes/workHubEvents.test.ts`
- Modify: `artifacts/api-server/src/app.ts`
- Modify: OpenAPI route/schema source used by Orval
- Regenerate: `lib/api-client-react/src/generated/api.ts`
- Regenerate: `lib/api-client-react/src/generated/api.schemas.ts`

**Interfaces:**
- Consumes: Tasks 1-3 contracts, capabilities, audit, and operations table.
- Produces: `executeWorkHubCommand`, channel/message APIs, cursor pagination, per-user read cursors, and `publishWorkHubEvent`.

- [ ] **Step 1: Write API tests for channel list/create, threaded message create/edit/delete, mention validation, reaction toggle, read cursor, idempotent replay, version conflict, legacy ticket comment projection, SSE gap, and cross-tenant denial**

- [ ] **Step 2: Run the focused tests and verify routes return 404 before registration**

- [ ] **Step 3: Implement an operation transaction that locks/inserts the operation key, applies one mutation, appends audit, stores canonical JSON result, and replays it unchanged**

```ts
export async function executeWorkHubCommand<T>(
  actor: WorkHubActor,
  kind: string,
  envelope: WorkHubCommandEnvelope<unknown>,
  apply: (tx: WorkHubTx) => Promise<T>,
): Promise<WorkHubCommandResult<T>>;
```

- [ ] **Step 4: Implement list/mutation routes as schema parsing plus calls to access/command/query services; never add route-local tenant predicates**

- [ ] **Step 5: Project existing ticket and Hotlist comments into context feeds with source ids and read-only adapter metadata while preserving all legacy endpoints**

- [ ] **Step 6: Add user-scoped SSE envelopes with sequence/gap hello behavior matching current notification SSE**

- [ ] **Step 7: Update OpenAPI, regenerate clients, and run focused API tests plus `pnpm run typecheck`**

- [ ] **Step 8: Commit `feat(work-hub): add contextual messaging APIs`**

### Task 5: Private files, durable voice notes, and versioned notes

**Files:**
- Create: `artifacts/api-server/src/work-hub/files.ts`
- Create: `artifacts/api-server/src/work-hub/notes.ts`
- Create: `artifacts/api-server/src/routes/workHubFiles.ts`
- Create: `artifacts/api-server/src/routes/workHubNotes.ts`
- Create: `artifacts/api-server/src/routes/workHubFiles.test.ts`
- Create: `artifacts/api-server/src/routes/workHubNotes.test.ts`
- Modify: `artifacts/api-server/src/routes/storage.ts`
- Modify: `artifacts/api-server/src/lib/ticket-attachment-access.ts`
- Create: `artifacts/api-server/src/work-hub/orphan-upload-worker.ts`
- Modify: OpenAPI source and regenerate API clients

**Interfaces:**
- Produces: reserve/finalize/download/delete file APIs and `updateWorkHubNote(noteId, expectedVersion, patch)`.
- Consumes: Task 3 capabilities and Task 4 command/audit/event pipeline.

- [ ] **Step 1: Write tests for checksum-bound finalize, replay, unauthorized signed URL request, expired reservation cleanup, durable voice metadata, note edit versioning, and `409 work_hub.version_conflict`**

- [ ] **Step 2: Run tests and verify missing handlers**

- [ ] **Step 3: Implement upload reservation/finalization using the existing Supabase Storage client and context authorization; persist only private storage keys**

- [ ] **Step 4: Accept voice-note metadata `{ durationMs, container, codec, waveform: number[] }`, cap waveform length, and attach only finalized file ids to messages**

- [ ] **Step 5: Implement append-only note versions and compare-and-swap version updates**

- [ ] **Step 6: Run focused tests, storage tests, and typecheck**

- [ ] **Step 7: Commit `feat(work-hub): add files voice notes and notes`**

### Task 6: Notifications, deep links, and personal Home query

**Files:**
- Create: `artifacts/api-server/src/work-hub/notifications.ts`
- Create: `artifacts/api-server/src/work-hub/home.ts`
- Create: `artifacts/api-server/src/routes/workHubHome.ts`
- Create: `artifacts/api-server/src/routes/workHubHome.test.ts`
- Modify: `lib/db/src/schema/notifications.ts`
- Create: `lib/db/drizzle/chunk_396_work_hub_notification_preferences.sql`
- Modify: `artifacts/api-server/src/routes/notifications.ts`
- Modify: `artifacts/api-server/src/lib/push-fanout.ts`
- Modify: `artifacts/vndrly-mobile/lib/pushDeepLinks.ts`
- Modify: `artifacts/vndrly-mobile/lib/notification-navigation.ts`
- Modify: `artifacts/vndrly-mobile/app/_layout.tsx`
- Modify: `artifacts/vndrly/src/lib/notifications-api.ts`

**Interfaces:**
- Produces: category preferences for messages/tasks/announcements/schedule/meetings; canonical web/mobile links; `getWorkHubHome(actor, cursor)`.
- Consumes: existing `notifyUsers`, notification SSE, email digest, Expo push, and Task 4 events.

- [ ] **Step 1: Write notification tests for mention/assignment immediate delivery, routine reply digest eligibility, urgent policy, dedupe, synchronized read state, revoked deep link, and Home permission filtering**

- [ ] **Step 2: Run tests and confirm new categories/preferences fail schema validation**

- [ ] **Step 3: Add guarded preference columns and map Work Hub events into existing notification rows with deterministic dedupe keys**

- [ ] **Step 4: Implement Home as a cursor-paginated union of authorized unread, task, schedule, acknowledgement/approval, file/note, and meeting catch-up cards**

- [ ] **Step 5: Extend web/mobile deep-link resolvers and mark read only after the destination resolves successfully**

- [ ] **Step 6: Run notification, push/deep-link, Home, migration-rerun, and typecheck tests**

- [ ] **Step 7: Commit `feat(work-hub): integrate home and notifications`**

### Task 7: Web communication experience

**Files:**
- Create: `artifacts/vndrly/src/features/work-hub/work-hub-shell.tsx`
- Create: `artifacts/vndrly/src/features/work-hub/home-page.tsx`
- Create: `artifacts/vndrly/src/features/work-hub/channel-page.tsx`
- Create: `artifacts/vndrly/src/features/work-hub/message-thread.tsx`
- Create: `artifacts/vndrly/src/features/work-hub/composer.tsx`
- Create: `artifacts/vndrly/src/features/work-hub/note-editor.tsx`
- Create: `artifacts/vndrly/src/features/work-hub/work-hub.test.tsx`
- Modify: `artifacts/vndrly/src/App.tsx`
- Modify: `artifacts/vndrly/src/components/layout.tsx`
- Modify: web `en.json` and `es.json`

**Interfaces:**
- Consumes: generated APIs from Tasks 4-6 and current brand/TogglePill/ImagePill/notification primitives.
- Produces: `/work-hub`, `/work-hub/channels/:id`, and context-tab navigation.

- [ ] **Step 1: Write component tests for vendor admin, partner parity, field-user restrictions, unread/mention, thread/reaction, queued upload display, voice note playback, note conflict, access revocation, and responsive list/detail layouts**

- [ ] **Step 2: Run web tests and confirm lazy routes/components are absent**

- [ ] **Step 3: Build the shell and pages using capability props to hide/disable actions; use existing branded component doctrine instead of new button gradients**

- [ ] **Step 4: Add explicit loading, empty, submitting, retrying, conflict, unavailable, and offline copy in both locales**

- [ ] **Step 5: Run focused web tests, locale lint, and typecheck**

- [ ] **Step 6: Commit `feat(work-hub): add web communication experience`**

### Task 8: Durable iOS sync/upload queue and communication experience

**Files:**
- Create: `artifacts/vndrly-mobile/features/work-hub/sync/types.ts`
- Create: `artifacts/vndrly-mobile/features/work-hub/sync/store.ts`
- Create: `artifacts/vndrly-mobile/features/work-hub/sync/runner.ts`
- Create: `artifacts/vndrly-mobile/features/work-hub/sync/upload-runner.ts`
- Create: `artifacts/vndrly-mobile/features/work-hub/sync/runner.test.ts`
- Create: `artifacts/vndrly-mobile/features/work-hub/home-screen.tsx`
- Create: `artifacts/vndrly-mobile/features/work-hub/channel-screen.tsx`
- Create: `artifacts/vndrly-mobile/app/work-hub/index.tsx`
- Create: `artifacts/vndrly-mobile/app/work-hub/channel/[id].tsx`
- Modify: `artifacts/vndrly-mobile/app/(tabs)/_layout.tsx`
- Modify: mobile `en.json` and `es.json`

**Interfaces:**
- Produces: `enqueueWorkHubCommand`, `enqueueWorkHubUpload`, `runWorkHubSync`, and Expo routes.
- Consumes: Tasks 4-6 generated APIs and current auth/org-switch lifecycle.

- [ ] **Step 1: Write queue tests for restart persistence, upload dependency ordering, exponential backoff with jitter, `Retry-After`, duplicate replay, optimistic replacement, org switch pause, 409 conflict, 403/404 cache purge, and permanent failure**

```ts
export type QueuedWorkHubCommand = {
  operationId: string;
  userId: number;
  ownerKey: `vendor:${number}` | `partner:${number}`;
  kind: string;
  payloadVersion: 1;
  expectedVersion: number | null;
  dependencyIds: string[];
  retryCount: number;
  nextAttemptAt: string;
};
```

- [ ] **Step 2: Run mobile tests and verify missing queue modules**

- [ ] **Step 3: Persist a bounded per-user queue in AsyncStorage, validate the active user/org before each send, and serialize per subject while allowing unrelated uploads to progress**

- [ ] **Step 4: Implement screens with optimistic items keyed by operation id and current iPhone/iPad adaptive navigation conventions**

- [ ] **Step 5: Test foreground/background, manual retry, airplane-mode simulation, app restart, locale parity, and typecheck**

- [ ] **Step 6: Commit `feat(work-hub): add durable mobile collaboration`**

### Task 9: Tasks, checklists, forms, acknowledgements, approvals, and announcements

**Files:**
- Create: `lib/db/src/schema/workHubTasks.ts`
- Create: `lib/db/src/schema/workHubForms.ts`
- Create: `lib/db/src/schema/workHubAnnouncements.ts`
- Create: `lib/db/drizzle/chunk_397_work_hub_work_management.sql`
- Create: `artifacts/api-server/src/work-hub/work-management.ts`
- Create: `artifacts/api-server/src/routes/workHubWork.ts`
- Create: `artifacts/api-server/src/routes/workHubWork.test.ts`
- Create: `artifacts/vndrly/src/features/work-hub/work-page.tsx`
- Create: `artifacts/vndrly-mobile/features/work-hub/work-screen.tsx`
- Modify: OpenAPI source, generated clients, routes, and both locale pairs

**Interfaces:**
- Produces: versioned template/instance/submission APIs, task/approval lifecycle, recipient-snapshotted announcements, and recurrence expansion.
- Consumes: Tasks 3-6 policy, commands, audit, notification, Home, files, and events.

- [ ] **Step 1: Write tests for assignee visibility, template version snapshots, immutable form correction chain, constrained recurrence/timezone, exact-version acknowledgement, ordered/parallel approval, recipient snapshot, urgent/required announcement, and cross-tenant denial**

- [ ] **Step 2: Run focused API tests and verify missing tables/routes**

- [ ] **Step 3: Add guarded tables/migration and implement lifecycle transition maps with stable error codes**

```ts
const TASK_TRANSITIONS = {
  open: ["in_progress", "completed", "cancelled"],
  in_progress: ["open", "completed", "cancelled"],
  completed: ["open"],
  cancelled: ["open"],
} as const;
```

- [ ] **Step 4: Implement server-generated recurrence instances, immutable submission versions, approval steps, recipient snapshots, audits, notifications, and Home cards**

- [ ] **Step 5: Build web/mobile Tasks and required-actions views with offline-supported mutations**

- [ ] **Step 6: Run migration rerun, API/web/mobile tests, locale lint, and typecheck**

- [ ] **Step 7: Commit `feat(work-hub): add coordinated work workflows`**

### Task 10: Shifts, availability, conflicts, and unified calendar

**Files:**
- Create: `lib/db/src/schema/workHubSchedule.ts`
- Create: `lib/db/drizzle/chunk_398_work_hub_schedule.sql`
- Create: `artifacts/api-server/src/work-hub/shift-policy.ts`
- Create: `artifacts/api-server/src/work-hub/calendar.ts`
- Create: `artifacts/api-server/src/routes/workHubSchedule.ts`
- Create: `artifacts/api-server/src/routes/workHubSchedule.test.ts`
- Create: `artifacts/vndrly/src/features/work-hub/calendar-page.tsx`
- Create: `artifacts/vndrly-mobile/features/work-hub/calendar-screen.tsx`
- Modify: `artifacts/api-server/src/routes/ticketSchedule.ts`
- Modify: existing ICS route implementation
- Modify: OpenAPI/generated clients/locales

**Interfaces:**
- Produces: availability/shift/open-shift/claim/swap APIs, `evaluateShiftConflicts`, and unified `CalendarItem` with source/authority.
- Consumes: current ticket scheduling, certification warnings, foreman schedule, Task 9 due/recurrence items.

- [ ] **Step 1: Write tests for overlap, rest window, inactive employee, qualification warning/block, authorized override audit, open-shift claim race, swap approval, timezone/DST recurrence, source labels, and read-only external placeholder items**

- [ ] **Step 2: Run tests and confirm missing schedule domain**

- [ ] **Step 3: Add guarded schedule tables and implement deterministic warning codes/severity by composing existing certification and ticket-schedule checks**

- [ ] **Step 4: Implement a merged calendar query that delegates edits to the owning domain and extend ICS output with accessible VNDRLY Work Hub items**

- [ ] **Step 5: Build web/mobile calendar, availability, open-shift, and swap flows; queue supported mobile requests**

- [ ] **Step 6: Run focused tests, schedule regression tests, locale lint, and typecheck**

- [ ] **Step 7: Commit `feat(work-hub): add shifts and unified calendar`**

### Task 11: Permission-aware search and AskV confirmation flows

**Files:**
- Create: `lib/db/src/schema/workHubSearchDocuments.ts`
- Create: `lib/db/drizzle/chunk_399_work_hub_search.sql`
- Create: `artifacts/api-server/src/work-hub/search.ts`
- Create: `artifacts/api-server/src/work-hub/search-index-worker.ts`
- Create: `artifacts/api-server/src/routes/workHubSearch.ts`
- Create: `artifacts/api-server/src/routes/workHubSearch.test.ts`
- Create: `artifacts/api-server/src/assistant/work-hub-tools.ts`
- Create: `artifacts/api-server/src/assistant/work-hub-tools.test.ts`
- Create: `artifacts/vndrly/src/features/work-hub/search-page.tsx`
- Create: `artifacts/vndrly-mobile/features/work-hub/search-screen.tsx`

**Interfaces:**
- Produces: filtered search/index/hydration and AskV read/suggest/confirm tools with source links.
- Consumes: Task 3 visibility revision, Tasks 4-10 domain data, and existing AskV pending confirmation/action audit.

- [ ] **Step 1: Write tests for query filters, snippet authorization, revoked membership, stale index hydration rejection, transcript policy, source deep links, draft-only AskV mutations, and human confirmation audit**

- [ ] **Step 2: Run tests and verify no Work Hub tool is registered**

- [ ] **Step 3: Add the tenant/context-scoped search projection and worker; re-authorize every hydrated result and omit unauthorized snippets**

- [ ] **Step 4: Register AskV read tools and suggestion tools; route confirmation through existing pending-confirmation plus Work Hub idempotent command**

- [ ] **Step 5: Build web/mobile search screens and source-link navigation**

- [ ] **Step 6: Run search, assistant, deep-link, isolation, and typecheck tests**

- [ ] **Step 7: Commit `feat(work-hub): add secure search and AskV actions`**

### Task 12: Audio provider decision gate and adapter contract tests

**Files:**
- Create: `docs/decisions/work-hub-audio-provider.md`
- Create: `artifacts/api-server/src/work-hub/audio/provider.ts`
- Create: `artifacts/api-server/src/work-hub/audio/provider-contract.test.ts`
- Create: `artifacts/vndrly-mobile/features/work-hub/meetings/audio-adapter.ts`
- Create: `artifacts/vndrly/src/features/work-hub/meetings/audio-adapter.ts`

**Interfaces:**
- Consumes: Task 1 provider contracts.
- Produces: an approved decision record and one adapter implementation only after approval; clients receive VNDRLY join leases, never provider credentials.

- [ ] **Step 1: Build a weighted decision record scoring web/React Native proof, room controls, signed webhooks/replay, recording/transcript APIs, timestamp/speaker data, deletion/export, service limits, regional/data terms, accessibility, observability, cost, and exit path**

- [ ] **Step 2: Run throwaway proofs against at least two viable providers on web and physical iPhone/iPad; record measured join latency, interruption behavior, audio-route switching, and artifact timing without committing credentials or proof code**

- [ ] **Step 3: Stop for explicit provider approval; do not install a package, create production resources, or continue to provider-specific implementation until the decision record is approved**

- [ ] **Step 4: After approval, add the minimum provider dependencies and implement the server/web/iOS adapters behind configuration with a disabled fake adapter for tests**

- [ ] **Step 5: Run a shared adapter contract suite covering token isolation, room end, recording commands, webhook verification/replay, transcript job status/cancel, error normalization, and provider outage**

- [ ] **Step 6: Commit `docs(work-hub): record audio provider decision`, then `feat(work-hub): add approved audio adapters` as separate reviewable commits**

### Task 13: Meeting lifecycle, consent, artifacts, and catch-up

**Files:**
- Create: `lib/db/src/schema/workHubMeetings.ts`
- Create: `lib/db/drizzle/chunk_400_work_hub_meetings.sql`
- Create: `artifacts/api-server/src/work-hub/meetings.ts`
- Create: `artifacts/api-server/src/work-hub/meeting-artifacts.ts`
- Create: `artifacts/api-server/src/routes/workHubMeetings.ts`
- Create: `artifacts/api-server/src/routes/workHubMeetings.test.ts`
- Create: `artifacts/vndrly/src/features/work-hub/meetings/meeting-page.tsx`
- Create: `artifacts/vndrly/src/features/work-hub/meetings/catch-up-page.tsx`
- Create: `artifacts/vndrly-mobile/features/work-hub/meetings/meeting-screen.tsx`
- Create: `artifacts/vndrly-mobile/features/work-hub/meetings/catch-up-screen.tsx`
- Modify: OpenAPI/generated clients/locales

**Interfaces:**
- Consumes: approved Task 12 adapters, Task 3 capabilities, Task 6 notifications, Task 9 tasks, and Task 11 AskV confirmation.
- Produces: immediate/scheduled/recurring meeting APIs, room roles, chat/hand raise, RSVP/reminders, attendance, consent, artifacts, and catch-up.

- [ ] **Step 1: Write lifecycle tests for roles, token issuance, mute/hand events, RSVP/reminder, recurrence, join/leave attendance intervals, host end, and context access**

- [ ] **Step 2: Write consent/artifact tests for capture-off default, policy version display, non-consent behavior, start/stop audit, signed webhook replay, timestamped transcript, playback links, download policy, retention state, and provider outage**

- [ ] **Step 3: Add guarded meeting tables and implement VNDRLY meeting state independent of provider room state**

- [ ] **Step 4: Implement join leases, provider event conversion, consent gate, recording/transcription orchestration, agenda/notes, attendance, and catch-up query**

- [ ] **Step 5: Generate AskV recap/decisions/suggested tasks from authorized artifacts; make each suggested task a confirmation card with timestamp/source links**

- [ ] **Step 6: Build accessible web/iOS lobby, audio room, and catch-up views; test microphone permission, speaker route, interruptions, background/foreground, active speaker, and screen-reader labels on physical devices**

- [ ] **Step 7: Run migration rerun, provider contract, API/web/mobile, locale, and typecheck gates**

- [ ] **Step 8: Commit `feat(work-hub): add audio meetings and catch-up`**

### Task 14: Optional Microsoft 365 read-only calendar connector

**Files:**
- Create: `lib/db/src/schema/workHubCalendarConnectors.ts`
- Create: `lib/db/drizzle/chunk_401_work_hub_calendar_connectors.sql`
- Create: `artifacts/api-server/src/work-hub/connectors/calendar-connector.ts`
- Create: `artifacts/api-server/src/work-hub/connectors/microsoft-365.ts`
- Create: `artifacts/api-server/src/work-hub/connectors/calendar-sync-worker.ts`
- Create: `artifacts/api-server/src/routes/workHubConnectors.ts`
- Create: `artifacts/api-server/src/routes/workHubConnectors.test.ts`
- Create: `artifacts/vndrly/src/features/work-hub/admin/microsoft-365-connect.tsx`
- Create: `artifacts/vndrly-mobile/features/work-hub/admin/microsoft-365-connect-screen.tsx`

**Interfaces:**
- Produces: encrypted connection metadata, calendar selection, cursor sync, revoke/health, and external calendar items.
- Consumes: Task 1 `CalendarConnector`, Task 3 `connector.manage`, and Task 10 calendar merge.

- [ ] **Step 1: Write connector contract/API tests for admin-only connect, state/PKCE validation, encrypted token handling, calendar selection, delta cursor, update/cancel, throttling/backoff, revoke, disconnect retention, and native calendar availability during outage**

- [ ] **Step 2: Run tests and verify disabled flag returns opaque 404**

- [ ] **Step 3: Add guarded connector tables and implement only the `calendar.read` capability; reserve but do not expose task/file capabilities**

- [ ] **Step 4: Implement OAuth callback, encrypted refresh storage, selected-calendar sync, external event normalization, and health/revoke worker behavior**

- [ ] **Step 5: Add admin UX and `Microsoft 365 · External` read-only event treatment on web/iOS**

- [ ] **Step 6: Run connector, calendar, security, locale, and typecheck tests**

- [ ] **Step 7: Commit `feat(work-hub): add optional Microsoft calendar sync`**

### Task 15: Retention, legal hold, exports, and observability

**Files:**
- Create: `artifacts/api-server/src/work-hub/retention.ts`
- Create: `artifacts/api-server/src/work-hub/exports.ts`
- Create: `artifacts/api-server/src/work-hub/metrics.ts`
- Create: `artifacts/api-server/src/routes/workHubGovernance.ts`
- Create: `artifacts/api-server/src/routes/workHubGovernance.test.ts`
- Create: `artifacts/vndrly/src/features/work-hub/admin/governance-page.tsx`
- Create: `artifacts/vndrly-mobile/features/work-hub/admin/governance-screen.tsx`
- Modify: worker scheduler registration
- Modify: deployment observability configuration/docs

**Interfaces:**
- Consumes: governance tables and all Work Hub subjects.
- Produces: `evaluateRetentionCandidate`, asynchronous authorized exports, legal hold controls, and redacted metrics.

- [ ] **Step 1: Write tests for policy minimum, legal hold, referenced-byte protection, two-stage purge, export scope/watermark/expiration, request-and-download reauthorization, audit immutability, and secret/body redaction**

- [ ] **Step 2: Run tests and verify no governance endpoints exist**

- [ ] **Step 3: Implement dry-run-first retention jobs that record policy/version/cutoff/counts before metadata or byte deletion and retry partial storage failures safely**

- [ ] **Step 4: Implement private expiring exports for channel/work/calendar/gate/meeting formats and audit request, generation, download, expiry, and failure**

- [ ] **Step 5: Emit the spec-defined command/SSE/queue/notification/search/meeting/connector/retention/export/isolation metrics without content or secrets; configure alerts for stale queues, stuck artifacts, auth failures, backlog, and isolation invariants**

- [ ] **Step 6: Run governance, storage, audit, security, and typecheck tests**

- [ ] **Step 7: Commit `feat(work-hub): add governance exports and telemetry`**

### Task 16: Adjacent AskV, Gate, gate-records, and commercial homepage checklist

**Files:**
- Modify: `artifacts/vndrly/src/components/askv-status-indicator.tsx`
- Modify: corresponding AskV status tests
- Modify: `artifacts/vndrly/src/pages/gate-log.tsx`
- Modify: `artifacts/vndrly/src/pages/gate-log.test.tsx`
- Modify: mobile Gate screen/tests
- Modify: existing public homepage/login routing components and tests
- Modify: both web/mobile locale pairs

**Interfaces:**
- Consumes: current AskV state, brand resolver, TogglePill/ImagePill, Gate History, gate authorization/report endpoints, and public authentication routes.
- Produces: no Work Hub service imports; these are adjacent release deliverables.

- [ ] **Step 1: Write failing visual/state tests that distinguish AskV listening waveform from processing dots and expose accessible state labels**

- [ ] **Step 2: Write Gate tests for brand-resolved quick-action/duration controls, consolidated selected-location content, fixed-height `On Site Now`, current occupants, independently scrollable recent activity, and preserved Gate History link**

- [ ] **Step 3: Write API/web tests proving gate-company vendor-admin search/export is limited to authorized sites and audited**

- [ ] **Step 4: Write public-route tests for unauthenticated commercial content, sign-in/demo actions, legal/support links, and absence of production-data bypass/test-drive calls**

- [ ] **Step 5: Implement the four surfaces using existing components/services and no Work Hub internals**

- [ ] **Step 6: Run focused web/mobile/API tests, locale lint, and typecheck**

- [ ] **Step 7: Commit `feat: complete Work Hub adjacent release checklist`**

### Task 17: Integrated isolation, offline, accessibility, and performance verification

**Files:**
- Create: `lib/e2e/tests/work-hub-isolation.spec.ts`
- Create: `lib/e2e/tests/work-hub-offline.spec.ts`
- Create: `lib/e2e/tests/work-hub-meetings.spec.ts`
- Create: `lib/e2e/tests/work-hub-release.spec.ts`
- Create: `artifacts/api-server/src/routes/work-hub-load.test.ts`
- Update: `docs/communications-launch-readiness.md`

**Interfaces:**
- Consumes: all prior tasks.
- Produces: release evidence for the exact integrated tree.

- [ ] **Step 1: Add end-to-end fixtures with two vendors, two partners, shared/unshared sites and tickets, gate scope, revoked memberships, and distinct users**

- [ ] **Step 2: Automate vendor-admin creation through partner participation and field offline reconciliation; assert vendor-private objects never appear across API, UI, SSE, push/deep link, search, export, file, transcript, or AskV surfaces**

- [ ] **Step 3: Automate one audio meeting from schedule through consent, attendance, chat/hand raise, transcript/playback catch-up, confirmed task, and policy-controlled export using the test adapter**

- [ ] **Step 4: Verify iPhone/iPad/web responsive layouts, keyboard/screen-reader semantics, reduced motion, dynamic text, audio interruptions, queue recovery after restart, and English/Spanish parity**

- [ ] **Step 5: Load-test representative Home/channel pagination, notification fan-out, SSE reconnect, search indexing, exports, and provider limits; store thresholds and results in launch readiness**

- [ ] **Step 6: Run `pnpm lint:i18n`, `pnpm run typecheck`, `pnpm run test:web`, `pnpm run test:mobile`, `pnpm run test:api`, and `pnpm test`; fix failures and rerun only affected gates until the exact tree is green**

- [ ] **Step 7: Commit `test(work-hub): verify integrated release behavior`**

### Task 18: Production-safe migration rehearsal and one final release

**Files:**
- Modify: `.github/workflows/deploy-api.yml` to run every new guarded `migrate:work-hub-*` script in order
- Modify: `.github/workflows/publish.yml` only if Work Hub build/runtime needs require it
- Modify: `.github/workflows/mobile-ota.yml` and `.github/workflows/mobile-testflight.yml` only for demonstrated native/runtime needs
- Update: `docs/release-fast-path.md` with Work Hub verification endpoints/checks
- Create: `docs/work-hub-release-evidence.md`

**Interfaces:**
- Consumes: exact green tree and all feature/policy flags.
- Produces: one integrated disabled-by-default production deployment and controlled enablement evidence.

- [ ] **Step 1: Rehearse every additive migration twice against a production-like copy, recording duration, row counts, locks, checksum, second-run no-op behavior, and read-only prechecks; stop if any statement is destructive**

- [ ] **Step 2: Rehearse flag-off deployment, worker idle behavior, connector/provider outage degradation, rollback-by-flag, and storage orphan cleanup**

- [ ] **Step 3: Review the audio provider decision/security/data-processing record, Microsoft OAuth scopes/token handling, retention/legal hold, export policy, tenant-isolation evidence, App Store microphone/recording disclosures, and support runbooks**

- [ ] **Step 4: Prepare the one release commit/PR without unrelated working-tree files; require all mandatory validation checks on the exact commit**

- [ ] **Step 5: Under an explicit full-ship command, advance `main` non-force and monitor web Publish, API Deploy plus guarded migrations, Supabase storage changes if present, iOS OTA, and TestFlight concurrently according to `docs/release-fast-path.md`**

- [ ] **Step 6: Verify `https://vndrly.ai`, authenticated Work Hub flag-off/allowlisted flows, `https://vndrly.ai/api/healthz`, migration records, notification/SSE delivery, Expo update group, and TestFlight submission; record elapsed commit-to-live time**

- [ ] **Step 7: Enable staff/test organizations, observe the defined alerts and metrics, then enable the approved organization cohort and general availability only after acceptance criteria pass**

- [ ] **Step 8: Complete `docs/work-hub-release-evidence.md` with commit, workflows, migration/storage results, public/API/mobile verification, provider/connector status, TestFlight status, flags, known limitations, and rollback controls**

- [ ] **Step 9: Commit `docs(work-hub): record integrated release evidence`**

## Final acceptance checklist

- [ ] All 15 acceptance criteria in the design specification map to passing automated or recorded physical-device checks.
- [ ] Vendor-admin-first workflows and partner parity are verified; cross-tenant identifiers fail on every boundary.
- [ ] Offline queued writes/uploads reconcile without duplicates after restart, retry, conflict, org switch, and access revocation.
- [ ] Audio meetings are fully VNDRLY-authenticated and policy-controlled; provider choice has an approved decision record.
- [ ] Microsoft synchronization remains optional/read-only and native schedules work during disconnection/outage.
- [ ] Adjacent AskV/Gate/gate-records/commercial-homepage checks pass without Work Hub coupling.
- [ ] Migrations are additive, guarded, rerunnable, and included in API deploy; no destructive database operation appears in the release.
- [ ] Required validation gates are green on the exact release commit.
- [ ] Web, API, Supabase changes, iOS OTA, and TestFlight are verified as one final release under explicit shipping authorization.
