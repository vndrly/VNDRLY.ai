# VNDRLY Multi-Device Work Hub Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let one VNDRLY user participate in one meeting and use Ask V across phone, tablet, and desktop with independent screens, synchronized work, one safe audio owner, learned failover, and host moderation.

**Architecture:** Add an organization-scoped device coordinator backed by additive Postgres tables and the existing Work Hub event stream. Track meeting presence and signaling per device while presenting one participant per user, fence audio with a renewable generation lease, and route Ask V context and confirmations through canonical server state. Web and iOS clients share contracts but retain independent navigation and device-local file bytes.

**Tech Stack:** Node.js 24, TypeScript 5.9, Express 5, PostgreSQL, Drizzle ORM, Zod, React 19, React Query, Expo/React Native, native iOS Work Hub meeting module, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-12-vndrly-multi-device-work-hub-design.md`

## Global Constraints

- Preserve every existing organization, user, ticket, meeting, call, file, and audit record.
- Migrations are guarded and additive only: `CREATE TABLE IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`, and additive indexes/constraints; never drop, truncate, reset, reseed, or restore over data.
- Device identity never grants business authority; every request rechecks the current session, membership, role, organization, and resource access.
- One user may have several device connections but exactly one transmit-audio lease per meeting or call.
- Audio never moves merely because another screen becomes active.
- Automatic failover may unmute only a remembered, pre-authorized, permission-granted backup after a three-second warning.
- Hosts and assigned co-hosts may impose mute; no actor may remotely unmute an attendee.
- Raw audio and local attachment bytes are never copied into cross-device coordination records.
- Keep older clients compatible and preserve polling as a fallback.
- English and Spanish strings, accessibility semantics, reduced motion, keyboard behavior, and Dynamic Type are required.
- The Exxon-to-Remington demo-data project is out of scope.
- A full ship updates commit, remote `main`, web, API and migrations, Supabase-backed production, OTA when compatible, and TestFlight; native changes require TestFlight.

---

### Task 1: Add the durable device coordination schema and guarded migration

**Files:**
- Create: `lib/db/src/schema/workHubDevices.ts`
- Modify: `lib/db/src/schema/index.ts`
- Create: `lib/db/drizzle/chunk_410_work_hub_devices.sql`
- Create: `artifacts/api-server/scripts/apply-work-hub-devices-migration.mjs`
- Modify: `artifacts/api-server/package.json`
- Create: `scripts/tests/work-hub-devices-migration.test.mjs`

**Interfaces:**
- Produces: `workHubDevicesTable`, `workHubDeviceConnectionsTable`, `workHubWorkspaceSessionsTable`, `workHubAudioLeasesTable`, `workHubDevicePreferencesTable`, `workHubUserEventsTable`, and `workHubMeetingSpeakRequestsTable`.
- The tables use opaque UUIDs, explicit `ownerOrgType` and `ownerOrgId`, bounded timestamps, and foreign keys to users and meeting occurrences.

- [ ] **Step 1: Write the failing migration safety test**

```js
test("device migration is additive and idempotent", async () => {
  const sql = await readFile("lib/db/drizzle/chunk_410_work_hub_devices.sql", "utf8");
  assert.doesNotMatch(sql, /\b(?:DROP|TRUNCATE|DELETE|UPDATE)\b/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS work_hub_devices/i);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS work_hub_audio_leases/i);
});
```

- [ ] **Step 2: Run the migration test and verify it fails**

Run: `node --test scripts/tests/work-hub-devices-migration.test.mjs`  
Expected: FAIL because the migration does not exist.

- [ ] **Step 3: Define focused Drizzle tables and guarded SQL**

```ts
export const workHubDevicesTable = pgTable("work_hub_devices", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  ownerOrgType: text("owner_org_type").notNull(), ownerOrgId: integer("owner_org_id").notNull(),
  friendlyName: text("friendly_name").notNull(), deviceClass: text("device_class").notNull(),
  capabilities: jsonb("capabilities").$type<DeviceCapabilities>().notNull().default({}),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, t => ({ userOrgIdx: index("work_hub_devices_user_org_idx").on(t.userId, t.ownerOrgType, t.ownerOrgId) }));
```

Define connection rows with `deviceId`, `connectionId`, foreground, permission and current-surface fields; workspace sessions with active occurrence and Ask V conversation; audio leases with occurrence, holder device, generation, expiry and failover state; per-user ranked preferences; durable user events with monotonic `bigserial` sequence and bounded payload; and speak requests with pending/resolved state.

- [ ] **Step 4: Add the guarded migration wrapper and package command**

The wrapper must accept only `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, reject destructive keywords, apply statements sequentially, and print a single success line.

Run: `pnpm --dir artifacts/api-server migrate:work-hub-devices` only against the isolated test database during development.

- [ ] **Step 5: Verify schema, migration, and type exports**

Run: `node --test scripts/tests/work-hub-devices-migration.test.mjs`  
Run: `pnpm --filter @workspace/db run check-schema`  
Run: `pnpm --filter @workspace/db run typecheck`  
Expected: all PASS against the isolated database.

- [ ] **Step 6: Commit the schema slice**

```bash
git add lib/db/src/schema/workHubDevices.ts lib/db/src/schema/index.ts lib/db/drizzle/chunk_410_work_hub_devices.sql artifacts/api-server/scripts/apply-work-hub-devices-migration.mjs artifacts/api-server/package.json scripts/tests/work-hub-devices-migration.test.mjs
git commit -m "feat: add Work Hub device coordination schema"
```

### Task 2: Build the organization-scoped device coordinator and API

**Files:**
- Create: `artifacts/api-server/src/work-hub/device-coordinator.ts`
- Create: `artifacts/api-server/src/work-hub/device-coordinator.test.ts`
- Create: `artifacts/api-server/src/routes/workHubDevices.ts`
- Create: `artifacts/api-server/src/routes/workHubDevices.test.ts`
- Modify: `artifacts/api-server/src/routes/index.ts`
- Modify: `artifacts/api-server/src/work-hub/events.ts`
- Modify: `artifacts/api-server/src/routes/workHubEvents.ts`

**Interfaces:**
- Produces: `DeviceCapabilities`, `DeviceSurface`, `registerDevice`, `heartbeatDevice`, `revokeDevice`, `eligibleAudioDevices`, `publishUserEvent`, and `eventsAfter`.
- HTTP: `POST /api/work-hub/devices/register`, `POST /:deviceId/heartbeat`, `GET /api/work-hub/devices`, `DELETE /:deviceId`, and cursor-aware `GET /api/work-hub/events`.

- [ ] **Step 1: Write failing coordinator tests**

```ts
it("cannot heartbeat a device through another organization session", async () => {
  await expect(heartbeatDevice(otherOrgActor, device.id, payload)).rejects.toMatchObject({ code: "not_found" });
});

it("expires stale surface context without revoking the device", async () => {
  expect(await activeSurface(actor, device.id, now + SURFACE_TTL_MS + 1)).toBeNull();
});
```

- [ ] **Step 2: Run the focused tests and verify red boundaries**

Run: `pnpm --filter @workspace/api-server exec vitest run src/work-hub/device-coordinator.test.ts src/routes/workHubDevices.test.ts`  
Expected: FAIL because coordinator and routes do not exist.

- [ ] **Step 3: Implement server-owned registration and heartbeat**

```ts
export type DeviceSurface = { path: string; entityType: string | null; entityId: string | null; updatedAt: number };
export async function heartbeatDevice(actor: Actor, deviceId: string, input: HeartbeatInput) {
  const device = await requireOwnedDevice(actor, deviceId);
  return upsertConnection({ device, connectionId: input.connectionId, foreground: input.foreground,
    microphonePermission: input.microphonePermission, surface: compactSurface(input.surface) });
}
```

Return not-found semantics for foreign users or organizations. Bound friendly names and context strings. Clear old-organization connections and pending confirmations when the active membership changes.

- [ ] **Step 4: Make user events durable with live fan-out and gap recovery**

Persist event type plus minimal invalidation metadata, then fan out through the existing in-process bus. `Last-Event-ID` returns durable events after the cursor; an expired cursor emits `gap: true` and clients refetch canonical data.

- [ ] **Step 5: Verify authorization, expiry, cursor, and payload limits**

Run: `pnpm --filter @workspace/api-server exec vitest run src/work-hub/device-coordinator.test.ts src/routes/workHubDevices.test.ts src/routes/workHubEvents.test.ts`  
Expected: PASS, including wrong-user, wrong-org, revoked-device, stale-session, oversized-payload, reconnect, and gap cases.

- [ ] **Step 6: Commit the coordinator slice**

```bash
git add artifacts/api-server/src/work-hub/device-coordinator.ts artifacts/api-server/src/work-hub/device-coordinator.test.ts artifacts/api-server/src/routes/workHubDevices.ts artifacts/api-server/src/routes/workHubDevices.test.ts artifacts/api-server/src/routes/index.ts artifacts/api-server/src/work-hub/events.ts artifacts/api-server/src/routes/workHubEvents.ts
git commit -m "feat: coordinate Work Hub devices and live events"
```

### Task 3: Convert meeting presence and signaling to per-device connections

**Files:**
- Modify: `artifacts/api-server/src/work-hub/meeting-runtime.ts`
- Modify: `artifacts/api-server/src/work-hub/meeting-runtime.test.ts`
- Modify: `artifacts/api-server/src/routes/workHubMeetings.ts`
- Modify: `artifacts/api-server/src/routes/workHubMeetings.test.ts`
- Modify: `artifacts/vndrly/src/hooks/use-meeting-audio.ts`
- Modify: `artifacts/vndrly/src/components/meeting-workspace.tsx`
- Modify: `artifacts/vndrly-mobile/lib/use-meeting-workspace.ts`
- Modify: `artifacts/vndrly-mobile/components/WorkHubAudioRoom.tsx`

**Interfaces:**
- Replaces user-only runtime entries with `MeetingDevicePresence { userId, deviceId, connectionId, joinedAt, seenAt, speaking }`.
- Signaling includes `fromDeviceId` and `toDeviceId`; participant summaries remain user-level.

- [ ] **Step 1: Write failing aggregation and targeted-signal tests**

```ts
it("keeps a user present when one of two devices leaves", () => {
  const next = removeDevicePresence(runtimeWith(phone, desktop), phone.connectionId);
  expect(presentUserIds(next)).toEqual([userId]);
});

it("delivers an offer only to the addressed device", () => {
  expect(signalsForConnection(runtime, desktop.connectionId, 0)).toEqual([desktopOffer]);
});
```

- [ ] **Step 2: Prove the existing user-only runtime fails**

Run: `pnpm --filter @workspace/api-server exec vitest run src/work-hub/meeting-runtime.test.ts src/routes/workHubMeetings.test.ts`  
Expected: new tests FAIL because leave and signals are keyed by user.

- [ ] **Step 3: Implement compatibility-aware per-device runtime helpers**

Read old runtime entries as a synthetic legacy connection. Write new `connections` state, aggregate earliest join and current audio-owner speaking state, and delete only the leaving connection. Keep bounded signal count and byte budgets.

- [ ] **Step 4: Require device identity on new join, presence, leave, and signal calls**

Validate that device and connection belong to the authenticated actor and active organization. Return device-targeted peer lists. Keep legacy clients functional through a scoped synthetic device until rollout completes.

- [ ] **Step 5: Update web and mobile clients to send device and connection identity**

Each mounted meeting room owns one connection identifier and uses it for join, heartbeat, signals, and leave. Unmounting one client never leaves another.

- [ ] **Step 6: Run API, web, and mobile meeting suites**

Run: `pnpm --filter @workspace/api-server exec vitest run src/work-hub/meeting-runtime.test.ts src/routes/workHubMeetings.test.ts`  
Run: `pnpm --filter @workspace/vndrly exec vitest run src/components/meeting-workspace.test.tsx`  
Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run components/WorkHubAudioRoom.test.tsx lib/use-meeting-workspace.test.ts`  
Expected: PASS for two-device presence, targeted signaling, legacy compatibility, and cleanup.

- [ ] **Step 7: Commit the meeting connection slice**

```bash
git add artifacts/api-server/src/work-hub/meeting-runtime.ts artifacts/api-server/src/work-hub/meeting-runtime.test.ts artifacts/api-server/src/routes/workHubMeetings.ts artifacts/api-server/src/routes/workHubMeetings.test.ts artifacts/vndrly/src/hooks/use-meeting-audio.ts artifacts/vndrly/src/components/meeting-workspace.tsx artifacts/vndrly-mobile/lib/use-meeting-workspace.ts artifacts/vndrly-mobile/components/WorkHubAudioRoom.tsx
git commit -m "feat: track meeting presence per device"
```

### Task 4: Add host-enforced mute and request-to-speak routing

**Files:**
- Modify: `lib/db/src/schema/workHubMeetings.ts`
- Modify: `lib/db/drizzle/chunk_410_work_hub_devices.sql`
- Modify: `artifacts/api-server/src/routes/workHubMeetings.ts`
- Create: `artifacts/api-server/src/work-hub/meeting-moderation.ts`
- Create: `artifacts/api-server/src/work-hub/meeting-moderation.test.ts`
- Modify: `artifacts/vndrly/src/components/meeting-workspace.tsx`
- Modify: `artifacts/vndrly-mobile/components/meeting-workspace.tsx`
- Modify: web and mobile English/Spanish locale files

**Interfaces:**
- Adds participant fields `hostMutedAt`, `hostMutedById`, and `hostMuteGeneration`.
- HTTP: `POST /:occurrenceId/participants/:userId/host-mute`, `DELETE .../host-mute`, and `POST /:occurrenceId/request-to-speak`.

- [ ] **Step 1: Write failing moderation authorization tests**

```ts
it("blocks every device lease while a participant is host-muted", async () => {
  await hostMute(host, attendeeId);
  await expect(acquireAudioLease(attendeePhone)).rejects.toMatchObject({ code: "meeting.host_muted" });
});

it("does not let an unassigned organization admin release host mute", async () => {
  await expect(releaseHostMute(adminAttendee, attendeeId)).rejects.toMatchObject({ code: "forbidden" });
});
```

- [ ] **Step 2: Run focused tests and verify failure**

Run: `pnpm --filter @workspace/api-server exec vitest run src/work-hub/meeting-moderation.test.ts`  
Expected: FAIL because moderation state and routes do not exist.

- [ ] **Step 3: Implement durable moderation and notification priority**

Host and co-host may impose or release mute. Request routing selects present host, then present co-hosts; a present same-organization admin receives notification-only fallback and no release authority.

- [ ] **Step 4: Add accessible controls and announcements**

Show `Muted by host`, disable self-unmute, expose `Request to speak`, announce state changes, and keep buttons usable with keyboard, screen reader, and Dynamic Type.

- [ ] **Step 5: Verify API, web, mobile, and locale behavior**

Run focused moderation suites, then `pnpm lint:i18n`.  
Expected: PASS for host, co-host, admin fallback, reconnect, new-device join, request resolution, and remote-unmute prohibition.

- [ ] **Step 6: Commit the moderation slice**

```bash
git add lib/db/src/schema/workHubMeetings.ts lib/db/drizzle/chunk_410_work_hub_devices.sql artifacts/api-server/src/routes/workHubMeetings.ts artifacts/api-server/src/work-hub/meeting-moderation.ts artifacts/api-server/src/work-hub/meeting-moderation.test.ts artifacts/vndrly/src/components/meeting-workspace.tsx artifacts/vndrly-mobile/components/meeting-workspace.tsx artifacts/vndrly/src/lib/locales artifacts/vndrly-mobile/lib/locales
git commit -m "feat: add cross-device meeting moderation"
```

### Task 5: Implement audio leases, explicit handoff, learned backup, and failover

**Files:**
- Create: `artifacts/api-server/src/work-hub/audio-lease.ts`
- Create: `artifacts/api-server/src/work-hub/audio-lease.test.ts`
- Modify: `artifacts/api-server/src/routes/workHubDevices.ts`
- Modify: `artifacts/api-server/src/routes/workHubMeetings.ts`
- Modify: `artifacts/vndrly/src/hooks/use-meeting-audio.ts`
- Create: `artifacts/vndrly/src/hooks/use-work-hub-device-session.ts`
- Modify: `artifacts/vndrly-mobile/components/WorkHubAudioRoom.tsx`
- Create: `artifacts/vndrly-mobile/lib/work-hub-device-session.ts`
- Modify: `artifacts/vndrly-mobile/modules/askv-wake/ios/WorkHubMeetingModule.swift`

**Interfaces:**
- Produces `acquireAudioLease`, `renewAudioLease`, `offerHandoff`, `acceptHandoff`, `cancelHandoff`, `selectFailoverCandidate`, and generation-fenced capture callbacks.
- HTTP endpoints operate on meeting occurrence plus source and destination device.

- [ ] **Step 1: Write failing lease-race and eligibility tests**

```ts
it("never gives two devices a valid transmit generation", async () => {
  const phone = await acquireAudioLease(phoneActor);
  const desktop = await acceptHandoff(desktopActor, phone.generation);
  expect(await validateLease(phone.token, phone.generation)).toBe(false);
  expect(await validateLease(desktop.token, desktop.generation)).toBe(true);
});

it("excludes a backup without prior microphone permission", () => {
  expect(selectFailoverCandidate([unpermittedDesktop], preferences)).toBeNull();
});
```

- [ ] **Step 2: Prove the tests fail against current audio ownership**

Run: focused API audio-lease test.  
Expected: FAIL because no lease or device eligibility exists.

- [ ] **Step 3: Implement transactional lease and handoff state machine**

Lock by occurrence and user, issue hashed lease tokens, increment generation before activation, and make accept idempotent. Destination reservation must precede source release; failed activation either restores a renewable source lease or lands muted.

- [ ] **Step 4: Implement learned preference without hidden activation**

Record successful accepted handoffs. Rank repeated source-to-destination patterns, expose settings to view/reorder/clear, and require explicit `automaticBackupAuthorized` plus granted microphone permission before failover.

- [ ] **Step 5: Implement warning and automatic backup activation**

On confirmed source loss, wait the bounded disconnect grace, publish `audio.failover_pending`, show a three-second countdown with cancel/mute, then activate the eligible backup. A returning source becomes companion-only.

- [ ] **Step 6: Fence web and native capture callbacks**

Every emitted frame carries lease generation. Web and native modules discard frames when local generation no longer equals the server-approved capture epoch. Never bypass browser or iOS mic permission.

- [ ] **Step 7: Verify races and platform lifecycle**

Run API lease tests, web audio tests, mobile audio tests, native static contract tests, background/foreground tests, permission-denied tests, and hardware-route renegotiation tests.  
Expected: PASS with no dual transmit, stale callback, silent unauthorized activation, or source reclaim.

- [ ] **Step 8: Commit the audio ownership slice**

```bash
git add artifacts/api-server/src/work-hub/audio-lease.ts artifacts/api-server/src/work-hub/audio-lease.test.ts artifacts/api-server/src/routes/workHubDevices.ts artifacts/api-server/src/routes/workHubMeetings.ts artifacts/vndrly/src/hooks/use-meeting-audio.ts artifacts/vndrly/src/hooks/use-work-hub-device-session.ts artifacts/vndrly-mobile/components/WorkHubAudioRoom.tsx artifacts/vndrly-mobile/lib/work-hub-device-session.ts artifacts/vndrly-mobile/modules/askv-wake/ios/WorkHubMeetingModule.swift
git commit -m "feat: add safe cross-device audio handoff"
```

### Task 6: Mirror Ask V state and route authorized cross-device context

**Files:**
- Create: `artifacts/api-server/src/assistant/device-context.ts`
- Create: `artifacts/api-server/src/assistant/device-context.test.ts`
- Modify: `artifacts/api-server/src/routes/assistant.ts`
- Modify: `artifacts/api-server/src/routes/assistantRealtime.ts`
- Modify: `artifacts/api-server/src/assistant/askv-pending-confirmation.ts`
- Modify: `artifacts/api-server/src/assistant/askv-idempotency.ts`
- Modify: `artifacts/vndrly/src/hooks/use-assistant.tsx`
- Modify: `artifacts/vndrly/src/hooks/use-askv-voice-session.tsx`
- Modify: `artifacts/vndrly-mobile/hooks/use-assistant.ts`
- Modify: `artifacts/vndrly-mobile/hooks/use-askv-voice-session.tsx`

**Interfaces:**
- Produces `resolveAuthorizedDeviceContext(session, conversationId, request)` and durable Ask V invalidation events.
- Confirmation identity becomes conversation plus pending action fingerprint, not a device-local session alone.

- [ ] **Step 1: Write failing mirror, ambiguity, and first-confirmation tests**

```ts
it("uses an authorized desktop ticket from phone voice without moving audio", async () => {
  expect(await resolveAuthorizedDeviceContext(phoneSession, conversationId, { reference: "this ticket" }))
    .toMatchObject({ deviceId: desktop.id, entityType: "ticket", entityId: "42" });
});

it("executes the first valid cross-device confirmation once", async () => {
  const results = await Promise.all([confirm(phone), confirm(desktop)]);
  expect(results.filter(row => row.executed)).toHaveLength(1);
});
```

- [ ] **Step 2: Run focused Ask V tests and verify failure**

Run: API device-context, realtime, pending-confirmation, and idempotency tests.  
Expected: new cross-device cases FAIL.

- [ ] **Step 3: Resolve context independently from audio**

Prefer an explicitly named record or device, then the fresh foreground surface whose authorized entity matches the request. When several candidates remain, return a short disambiguation result instead of guessing.

- [ ] **Step 4: Mirror conversation and confirmation events**

Publish minimal conversation, message, pending-confirmation, progress, result, and expiry events to the user's active organization devices. Clients refetch canonical conversation data and preserve local input.

- [ ] **Step 5: Make confirmation settlement atomic and device-neutral**

Use the existing idempotency executor with conversation/action fingerprint and row locking. The first valid response settles; later responses return the completed result without replaying the tool.

- [ ] **Step 6: Verify role, organization, stale-context, and parity behavior**

Run the full focused Ask V voice/tool matrix on API, web, and mobile.  
Expected: PASS for text/voice parity, role denial, wrong-org invisibility, context expiry, ambiguous targets, double confirmation, and organization switch.

- [ ] **Step 7: Commit the Ask V slice**

```bash
git add artifacts/api-server/src/assistant/device-context.ts artifacts/api-server/src/assistant/device-context.test.ts artifacts/api-server/src/routes/assistant.ts artifacts/api-server/src/routes/assistantRealtime.ts artifacts/api-server/src/assistant/askv-pending-confirmation.ts artifacts/api-server/src/assistant/askv-idempotency.ts artifacts/vndrly/src/hooks/use-assistant.tsx artifacts/vndrly/src/hooks/use-askv-voice-session.tsx artifacts/vndrly-mobile/hooks/use-assistant.ts artifacts/vndrly-mobile/hooks/use-askv-voice-session.tsx
git commit -m "feat: synchronize Ask V across devices"
```

### Task 7: Add persistent meeting companion UI and cross-device file sharing

**Files:**
- Create: `artifacts/vndrly/src/components/work-hub/meeting-companion-bar.tsx`
- Create: `artifacts/vndrly/src/components/work-hub/meeting-companion-bar.test.tsx`
- Modify: `artifacts/vndrly/src/pages/work-hub.tsx`
- Modify: `artifacts/vndrly/src/components/work-hub/files.tsx`
- Modify: `artifacts/vndrly/src/components/work-hub/files-upload.test.tsx`
- Create: `artifacts/vndrly-mobile/components/MeetingCompanionBar.tsx`
- Modify: `artifacts/vndrly-mobile/components/meeting-workspace.tsx`
- Modify: relevant mobile file upload component and tests

**Interfaces:**
- Companion bar consumes active workspace session and audio lease state.
- Upload UI accepts `defaultDestination?: { type: "meeting"; occurrenceId: string }` and a stable operation ID.

- [ ] **Step 1: Write failing independent-screen and upload-destination tests**

```tsx
it("keeps the meeting bar while the desktop opens a ticket", async () => {
  renderAt("/tickets/42", activeMeetingState);
  expect(screen.getByRole("status", { name: /meeting active/i })).toBeVisible();
  expect(location.pathname).toBe("/tickets/42");
});

it("shows the active meeting as a changeable upload destination", () => {
  expect(screen.getByText("Sharing to: Weekly operations")).toBeVisible();
  expect(screen.getByRole("button", { name: "Change destination" })).toBeEnabled();
});
```

- [ ] **Step 2: Verify the current UI fails the new tests**

Run focused web and mobile component tests.  
Expected: FAIL because persistent companion and default destination are absent.

- [ ] **Step 3: Implement independent companion presentation**

Show meeting title/status, audio device, mute or host-mute state, handoff offer, failover countdown, and return action. Never force navigation when remote devices change surface.

- [ ] **Step 4: Implement meeting-aware upload staging**

Preselect the active meeting, visibly show the destination, allow authorized changes, retain local bytes only on the selecting device, and broadcast progress/state without file bytes.

- [ ] **Step 5: Verify accessibility, responsiveness, and reconnect**

Run component tests for desktop, tablet, iPhone sizes, keyboard, screen reader names, Dynamic Type, reduced motion, retry, and event-stream fallback.

- [ ] **Step 6: Commit the companion UI slice**

```bash
git add artifacts/vndrly/src/components/work-hub/meeting-companion-bar.tsx artifacts/vndrly/src/components/work-hub/meeting-companion-bar.test.tsx artifacts/vndrly/src/pages/work-hub.tsx artifacts/vndrly/src/components/work-hub/files.tsx artifacts/vndrly/src/components/work-hub/files-upload.test.tsx artifacts/vndrly-mobile/components/MeetingCompanionBar.tsx artifacts/vndrly-mobile/components/meeting-workspace.tsx artifacts/vndrly-mobile
git commit -m "feat: add multi-device meeting companion"
```

### Task 8: Deduplicate calls and notifications across devices

**Files:**
- Modify: `artifacts/api-server/src/routes/workHubCalls.ts`
- Modify: `artifacts/api-server/src/routes/workHubCalls.test.ts`
- Modify: `artifacts/vndrly/src/components/work-hub/calls.tsx`
- Modify: `artifacts/vndrly-mobile/components/WorkHubCalls.tsx`
- Modify: relevant notifications routes and clients

**Interfaces:**
- Call acceptance includes answering device and creates or transfers the audio lease atomically.
- Call/notification transitions publish user events consumed on all devices.

- [ ] **Step 1: Write failing two-device answer and acknowledgement tests**

```ts
it("selects one answering device and cancels every other ring", async () => {
  const [phone, desktop] = await Promise.all([answer(callId, phoneId), answer(callId, desktopId)]);
  expect([phone, desktop].filter(row => row.selectedAudioOwner)).toHaveLength(1);
});
```

- [ ] **Step 2: Prove existing user-only call state fails**

Run focused call and notification tests.  
Expected: FAIL because calls do not identify the answering endpoint.

- [ ] **Step 3: Settle call transitions atomically with device-aware events**

Lock the call, accept the first valid device, create its audio lease, and return the same canonical active call to later accepts. Broadcast answer, decline, end, missed, voicemail, and read acknowledgement.

- [ ] **Step 4: Update clients and verify ringing cancellation**

Every client stops ringing immediately on the canonical event. Availability remains user-level; endpoint eligibility remains device-level.

- [ ] **Step 5: Run call, voicemail, notification, and meeting bridge tests**

Expected: PASS for simultaneous answer, stale client, revoked device, notification dedupe, and wrong-org denial.

- [ ] **Step 6: Commit the call slice**

```bash
git add artifacts/api-server/src/routes/workHubCalls.ts artifacts/api-server/src/routes/workHubCalls.test.ts artifacts/vndrly/src/components/work-hub/calls.tsx artifacts/vndrly-mobile/components/WorkHubCalls.tsx artifacts/api-server/src/routes/notifications.ts artifacts/vndrly/src/components/notifications-bell.tsx artifacts/vndrly-mobile
git commit -m "feat: coordinate calls across devices"
```

### Task 9: Add device settings, conflict UX, audit metadata, and complete localization

**Files:**
- Create: `artifacts/vndrly/src/components/work-hub/device-settings.tsx`
- Create: `artifacts/vndrly-mobile/components/WorkHubDeviceSettings.tsx`
- Modify: Work Hub administration/settings surfaces
- Modify: versioned Work Hub mutation routes touched by this feature
- Modify: `artifacts/api-server/src/work-hub/audit.ts`
- Modify: web and mobile English/Spanish locale files
- Add focused API, web, and mobile tests

**Interfaces:**
- Settings expose friendly name, current audio owner, backup order, automatic-backup authorization, forget/revoke, and clear-learning actions.
- Conflict response: `{ code: "version_conflict", current: AuthorizedResource, attemptedVersion: number }`.

- [ ] **Step 1: Write failing settings, conflict, and protected-audit tests**

Cover self-only device details, same-company admin revocation, cross-company not-found, reorder/clear, stale version, unsent-input preservation, and protected device audit fields.

- [ ] **Step 2: Implement settings and conflict presentation**

Use existing branded card and pill components. Preserve the user's draft on conflict and offer review/retry against the canonical version; never silently overwrite.

- [ ] **Step 3: Add audit metadata without exposing it to ordinary attendees**

Record source device, target surface, confirmation device, audio owner, handoff/failover, host mute, mute release, revocation, and organization switch in protected audit metadata.

- [ ] **Step 4: Complete locale and accessibility coverage**

Run `pnpm lint:i18n`; verify English/Spanish labels, live announcements, focus order, keyboard operation, reduced motion, color-independent state, and Dynamic Type.

- [ ] **Step 5: Run focused tests and commit**

```bash
git add artifacts/vndrly/src/components/work-hub/device-settings.tsx artifacts/vndrly-mobile/components/WorkHubDeviceSettings.tsx artifacts/api-server/src/work-hub/audit.ts artifacts/vndrly/src/lib/locales artifacts/vndrly-mobile/lib/locales
git commit -m "feat: finish multi-device settings and recovery"
```

### Task 10: Run exact-tree validation, multi-device acceptance, review, and full ship

**Files:**
- Create: `docs/release-evidence/2026-09-12-multi-device-work-hub.md`
- Modify only demonstrated failures found by validation or review.

**Interfaces:**
- Consumes every prior task's exact committed tree.
- Produces final release evidence with commit, migration, workflows, public checks, OTA decision, TestFlight submission, and device-only evidence.

- [ ] **Step 1: Run fast contract gates**

Run: `pnpm lint:i18n`  
Run: `pnpm run typecheck`  
Expected: PASS.

- [ ] **Step 2: Run focused cross-device suites**

Run all new API, web, mobile, migration, meeting, Ask V, audio, call, upload, moderation, and accessibility tests.  
Expected: PASS with no retries hiding a failure.

- [ ] **Step 3: Run mandatory aggregate gates**

Run: `pnpm run test:web`  
Run: `pnpm run test:api`  
Run: `pnpm test`  
Expected: every mandatory gate PASS against the isolated test database.

- [ ] **Step 4: Perform hands-on multi-device acceptance**

Verify real iPhone plus desktop and iPhone plus tablet: AirPods phone audio with desktop ticket work; phone receipt upload into meeting Shared; independent navigation; Ask V cross-device context; confirmation from either device; explicit handoff; learned preference; permission denial; network/battery loss failover with warning; source return; host mute; request to speak; call answer dedupe; and organization switch isolation.

- [ ] **Step 5: Run independent correctness and security review**

Review the immutable exact diff for authorization bypass, device impersonation, cross-org events, duplicate execution, lease races, remote-unmute risk, unbounded state, sensitive event payloads, migration safety, and backward compatibility. Fix each confirmed finding with a failing test, rerun focused gates, and re-review the corrected diff.

- [ ] **Step 6: Record exact release evidence**

Document the final commit, test totals, intentional skips, migration dry run, hands-on matrix, reviewer findings, and any physical-device limitation. Do not call the release complete with missing native evidence.

- [ ] **Step 7: Commit final verified changes and advance remote main non-force**

Confirm the current remote main parent, commit only intended files, push the working branch, and advance `main` without force. Reuse exact-tree test evidence when no source changed after validation.

- [ ] **Step 8: Start and monitor all release tracks concurrently**

Monitor `.github/workflows/publish.yml`, `.github/workflows/deploy-api.yml` including `migrate:work-hub-devices`, `.github/workflows/mobile-ota.yml` when compatible, and `.github/workflows/mobile-testflight.yml`. Native audio changes make TestFlight mandatory even if OTA also publishes.

- [ ] **Step 9: Verify production**

Verify the live site and Work Hub, `/api/healthz`, production device registration and event isolation, additive migration result, upload destination, Ask V sync, call/meeting behavior, OTA update group decision, and App Store Connect TestFlight submission.

- [ ] **Step 10: Publish the final handoff**

Report the exact commit, workflow outcomes, public verification, migration result, OTA status, TestFlight status, elapsed commit-to-live time, test evidence, and any remaining user-only hands-on check. The Remington conversion remains deferred.
