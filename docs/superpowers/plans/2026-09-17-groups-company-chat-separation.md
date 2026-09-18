# Groups and Company Chat Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the combined Crews & Channels workspace with a focused Groups page and a company-named Chat page that starts idempotent group chats or relationship-scoped person invitations.

**Architecture:** Keep the existing Work Hub crew, channel, membership, message, and invitation tables as the persistence model. Extract relationship-scoped directory authorization into one API service, add one idempotent group-chat command, and split the current conditional `CollaborationWorkspace` UI into `GroupsWorkspace` and `CompanyChatWorkspace` while sharing conversation primitives.

**Tech Stack:** React 19, TypeScript 5.9, TanStack Query, Express 5, Drizzle ORM, PostgreSQL, Zod 4, Vitest, Testing Library, pnpm.

**Spec:** `docs/superpowers/specs/2026-09-17-groups-company-chat-separation-design.md`

## Global Constraints

- User-facing `crew` becomes `group` and user-facing `channel` becomes `conversation` or `chat` on these two pages; backend table and route names remain unchanged where practical.
- `/work-hub/channels` becomes the Groups page and contains no conversation UI.
- `/work-hub/chat` is the only conversation workspace and is titled `{active organization name} Chat`.
- Group and person selection is mutually exclusive and selection alone never performs a mutation.
- Group membership is snapshotted only when Start Chat is clicked; later group changes never silently alter chat membership.
- Directory results are limited to same-organization users, approved partner/vendor relationships, and already-authorized shared peers.
- Directory responses never expose email, even when search matched an email.
- Cross-organization mutations revalidate relationship eligibility and require recipient acceptance.
- Existing conversations, messages, audit records, and deep links must remain usable.
- No destructive database migration, reset, truncate, force push, or new external dependency.
- Mobile and TestFlight presentation changes are outside this implementation.

---

### Task 1: Relationship-Scoped Work Hub Directory

**Files:**
- Create: `artifacts/api-server/src/work-hub/people-directory.ts`
- Create: `artifacts/api-server/src/work-hub/people-directory.test.ts`
- Modify: `artifacts/api-server/src/routes/workHubCollaboration.ts:468-520`
- Modify: `artifacts/api-server/src/routes/workHubCollaboration.test.ts`

**Interfaces:**
- Consumes: `SessionPayload`, `partnerVendorRelationshipsTable`, `ACTIVE_APPROVAL_STATUSES`, `userOrgMembershipsTable`, `usersTable`, `vendorsTable`, `partnersTable`, and existing shared-channel membership.
- Produces:
  - `type WorkHubDirectoryActor = SessionPayload & { userId: number }`
  - `type WorkHubDirectoryPerson = { id: number; displayName: string; organizationName: string; organizationType: "vendor" | "partner"; role: string; sameCompany: boolean }`
  - `listEligibleWorkHubPeople(actor: WorkHubDirectoryActor, search: string): Promise<WorkHubDirectoryPerson[]>`
  - `resolveWorkHubInviteEligibility(actor: WorkHubDirectoryActor, recipientUserId: number): Promise<{ sameCompany: boolean; relationshipScoped: boolean }>`

- [ ] **Step 1: Write failing directory service tests**

Create fixtures for a MidCon user, a MidCon peer, a Flywheel partner user under an approved relationship, a Warwick partner user under an approved relationship, an unrelated partner user, a pending relationship user, a revoked relationship user, a suspended user, and an existing authorized shared-chat peer. Assert:

```ts
const results = await listEligibleWorkHubPeople(midConActor, "");
expect(results.map((person) => person.displayName)).toEqual(
  expect.arrayContaining(["MidCon Peer", "Flywheel User", "Warwick User", "Existing Shared Peer"]),
);
expect(results.map((person) => person.displayName)).not.toEqual(
  expect.arrayContaining(["Unrelated User", "Pending User", "Revoked User", "Suspended User"]),
);
expect(results[0]).not.toHaveProperty("email");
```

Add a search case proving a user can be found by exact email while the response still omits email, and a partner-actor case proving the relationship direction is symmetric.

- [ ] **Step 2: Run the service test and verify red**

Run:

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/api-server exec vitest run src/work-hub/people-directory.test.ts
```

Expected: FAIL because `people-directory.ts` and its exports do not exist.

- [ ] **Step 3: Implement the directory policy service**

Implement `listEligibleWorkHubPeople` so it:

1. resolves the actor’s active vendor or partner organization;
2. loads only `approved` rows from `partner_vendor_relationships`;
3. builds allowed organization scopes from the actor’s organization plus approved counterparts;
4. unions existing channel peers already visible to the actor;
5. joins active, non-suspended users through `user_org_memberships`;
6. searches `displayName` and `email` server-side;
7. limits results to 50 and excludes the actor;
8. returns only the `WorkHubDirectoryPerson` fields.

Implement `resolveWorkHubInviteEligibility` using the same scope derivation. It must throw `new WorkHubAccessError("forbidden")` for an unrelated, inactive, suspended, or missing recipient.

- [ ] **Step 4: Route `GET /work-hub/people` through the service**

Replace the inline company/peer query with:

```ts
const search = z.string().trim().max(100).parse(req.query.search ?? "");
return res.json(
  await listEligibleWorkHubPeople(
    res.locals.collaborationActor as Actor,
    search,
  ),
);
```

Update invitation authorization in `POST /work-hub/chats` and `POST /work-hub/channels/:channelId/invitations` to call `resolveWorkHubInviteEligibility` instead of maintaining separate same-org/peer checks.

- [ ] **Step 5: Add route-level privacy tests**

In `workHubCollaboration.test.ts`, assert HTTP responses include organization and role labels, exclude `email`, exclude unrelated relationships, and return 403 when a relationship becomes revoked after search but before invite.

- [ ] **Step 6: Run focused API tests and verify green**

Run:

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/api-server exec vitest run src/work-hub/people-directory.test.ts src/routes/workHubCollaboration.test.ts
```

Expected: PASS.

- [ ] **Step 7: Commit the directory boundary**

```powershell
git add artifacts/api-server/src/work-hub/people-directory.ts artifacts/api-server/src/work-hub/people-directory.test.ts artifacts/api-server/src/routes/workHubCollaboration.ts artifacts/api-server/src/routes/workHubCollaboration.test.ts
git commit -m "Scope Work Hub people to active relationships"
```

---

### Task 2: Idempotent Group Chat Command

**Files:**
- Modify: `artifacts/api-server/src/routes/workHubCollaboration.ts`
- Modify: `artifacts/api-server/src/routes/workHubCollaboration.test.ts`

**Interfaces:**
- Consumes: existing `crewAccess(actor, crewId)`, `workHubCrewsTable`, `workHubCrewMembersTable`, `workHubChannelsTable`, `workHubCollaborationChannelsTable`, `workHubChannelMembersTable`, and operation UUID validation.
- Produces: `POST /work-hub/chats/groups` with body `{ crewId: string; operationId: string }` and response `{ channel: WorkHubChannel; reopened: boolean }`.

- [ ] **Step 1: Write failing group-chat route tests**

Add tests that:

```ts
const first = await request(app)
  .post("/work-hub/chats/groups")
  .set("Cookie", ownerCookie)
  .send({ crewId, operationId: randomUUID() })
  .expect(201);

expect(first.body.reopened).toBe(false);
expect(await channelMemberIds(first.body.channel.id)).toEqual(
  expect.arrayContaining([ownerId, memberId]),
);

const second = await request(app)
  .post("/work-hub/chats/groups")
  .set("Cookie", ownerCookie)
  .send({ crewId, operationId: randomUUID() })
  .expect(200);

expect(second.body.channel.id).toBe(first.body.channel.id);
expect(second.body.reopened).toBe(true);
```

Also assert inaccessible, archived, deleted, and empty groups are rejected; concurrent requests return one channel; and adding/removing group members after creation does not change channel membership.

- [ ] **Step 2: Run the route test and verify red**

Run:

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/api-server exec vitest run src/routes/workHubCollaboration.test.ts -t "group chat"
```

Expected: FAIL with 404 because the route does not exist.

- [ ] **Step 3: Implement the transactional endpoint**

Add a Zod body schema with UUID validation. Resolve the group with `crewAccess`, reject non-active groups, and load current group members. Within one transaction:

```ts
const contextId = `group:${crew.id}`;
await tx.execute(
  sql`select pg_advisory_xact_lock(hashtext(${`${crew.ownerOrgType}:${crew.ownerOrgId}:${contextId}`}))`,
);
```

Return an existing active `contextKind = "chat"` channel with the same owner and context ID when present. Otherwise create the channel named `${crew.name} Chat`, insert collaboration kind `chat`, and insert a deduplicated snapshot of current group members. Ensure the actor is an owner in the new conversation. Append the existing Work Hub audit event with group and channel identifiers.

- [ ] **Step 4: Run focused API tests and verify green**

Run:

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/api-server exec vitest run src/routes/workHubCollaboration.test.ts -t "group chat"
```

Expected: PASS.

- [ ] **Step 5: Commit the group-chat command**

```powershell
git add artifacts/api-server/src/routes/workHubCollaboration.ts artifacts/api-server/src/routes/workHubCollaboration.test.ts
git commit -m "Add idempotent group chat creation"
```

---

### Task 3: Focused Groups Workspace

**Files:**
- Create: `artifacts/vndrly/src/components/work-hub/groups-workspace.tsx`
- Create: `artifacts/vndrly/src/components/work-hub/groups-workspace.test.tsx`
- Modify: `artifacts/vndrly/src/components/work-hub/collaboration.tsx`
- Modify: `artifacts/vndrly/src/pages/work-hub.tsx:2290-2315`
- Modify: `artifacts/vndrly/src/lib/work-hub-nav.ts:20-32`
- Modify: `artifacts/vndrly/src/lib/work-hub-nav.test.ts`

**Interfaces:**
- Consumes: `/crews`, `/crews/:id/members`, existing group rename/member/archive/delete endpoints, `BrandedInput`, `BrandedSelect`, `BrandPillButton`, and `MiniCardDialogContent`.
- Produces: `export function GroupsWorkspace(): JSX.Element`.

- [ ] **Step 1: Write failing Groups workspace tests**

Assert the page:

```tsx
render(<GroupsWorkspace />, { wrapper });
expect(await screen.findByRole("heading", { name: "Groups" })).toBeTruthy();
expect(screen.getByRole("region", { name: "Manage groups" })).toHaveClass("w-full");
expect(screen.queryByLabelText("Conversations")).toBeNull();
expect(screen.queryByLabelText("Selected conversation workspace")).toBeNull();
expect(screen.queryByText("Channels")).toBeNull();
```

Cover create, select, rename, member/owner role changes, removal, archive, delete, and the last-owner error copy. Assert every action uses the existing branded button component and compact fields use `BrandedInput` or `BrandedSelect`.

- [ ] **Step 2: Run the Groups tests and verify red**

Run:

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/vndrly exec vitest run src/components/work-hub/groups-workspace.test.tsx
```

Expected: FAIL because `GroupsWorkspace` does not exist.

- [ ] **Step 3: Extract group management from CollaborationWorkspace**

Move only group state, group queries, group mutations, the full-width group card, and the group editor modal into `groups-workspace.tsx`. Change all visible copy from Crew/Crews to Group/Groups. Remove the Channels section, new-channel fields, visibility selector, and channel-opening behavior from the editor.

Render the management card as a single-column full-width surface. Preserve group ownership and lifecycle mutations exactly.

- [ ] **Step 4: Route and navigation updates**

Render `<GroupsWorkspace />` for the `channels` module. Change its navigation label to `Groups`. Keep `/work-hub/channels` as the route for bookmark compatibility; only the user-facing label changes.

- [ ] **Step 5: Run Groups and navigation tests**

Run:

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/vndrly exec vitest run src/components/work-hub/groups-workspace.test.tsx src/lib/work-hub-nav.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit the Groups page**

```powershell
git add artifacts/vndrly/src/components/work-hub/groups-workspace.tsx artifacts/vndrly/src/components/work-hub/groups-workspace.test.tsx artifacts/vndrly/src/components/work-hub/collaboration.tsx artifacts/vndrly/src/pages/work-hub.tsx artifacts/vndrly/src/lib/work-hub-nav.ts artifacts/vndrly/src/lib/work-hub-nav.test.ts
git commit -m "Separate Groups from conversations"
```

---

### Task 4: Company-Named Chat and Mutually Exclusive Target Selection

**Files:**
- Create: `artifacts/vndrly/src/components/work-hub/company-chat-workspace.tsx`
- Create: `artifacts/vndrly/src/components/work-hub/company-chat-workspace.test.tsx`
- Create: `artifacts/vndrly/src/components/work-hub/chat-target-picker.tsx`
- Create: `artifacts/vndrly/src/components/work-hub/chat-target-picker.test.tsx`
- Modify: `artifacts/vndrly/src/components/work-hub/collaboration.tsx`
- Modify: `artifacts/vndrly/src/pages/work-hub.tsx:2290-2315`
- Modify: `artifacts/vndrly/src/lib/work-hub-nav.ts`
- Modify: `artifacts/vndrly/src/components/work-hub/navigation.tsx`
- Modify: `artifacts/vndrly/src/components/work-hub/collaboration.test.tsx`

**Interfaces:**
- Consumes: `useBrand().name`, `/chats`, `/crews`, `/people?search=`, `/invitations`, `POST /chats`, and `POST /chats/groups`.
- Produces:
  - `type ChatTarget = { kind: "group"; groupId: string } | { kind: "person"; personId: number } | null`
  - `ChatTargetPicker({ target, onTargetChange }: { target: ChatTarget; onTargetChange(target: ChatTarget): void })`
  - `CompanyChatWorkspace(): JSX.Element`
  - `getWorkHubNavItems(role?: string | null, companyName?: string | null): WorkHubNavItem[]`

- [ ] **Step 1: Write failing target-picker tests**

Assert:

```tsx
expect(screen.getByRole("combobox", { name: "Select Group" })).toBeTruthy();
expect(screen.getByRole("combobox", { name: "Select Person" })).toBeTruthy();

await user.selectOptions(groupSelect, "group-1");
expect(personSelect).toHaveValue("");
expect(screen.getByRole("button", { name: "Start Chat" })).toBeEnabled();
expect(request).not.toHaveBeenCalled();

await user.selectOptions(personSelect, "42");
expect(groupSelect).toHaveValue("");
expect(screen.getByRole("button", { name: "Send Invite" })).toBeEnabled();
expect(request).not.toHaveBeenCalled();
```

Directory result labels must render as `Display Name · Organization · Role`, with no email text.

- [ ] **Step 2: Run target-picker tests and verify red**

Run:

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/vndrly exec vitest run src/components/work-hub/chat-target-picker.test.tsx
```

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement ChatTargetPicker**

Use separate `BrandedSelect` controls. Each `onChange` emits either the selected target or `null`, which inherently clears the other selector. Load groups from `/crews` and people from `/people?search=<encoded search>`. Keep the existing debounced search limit and show organization and role labels without email.

Render one branded action button:

```tsx
const actionLabel = target?.kind === "group" ? "Start Chat" : "Send Invite";
```

Disable it for `null` and while the mutation is pending.

- [ ] **Step 4: Write failing Company Chat integration tests**

Cover:

- heading uses `MidCon Solutions Chat` from the brand;
- group selection makes no request until Start Chat;
- Start Chat posts `{ crewId, operationId }` to `/chats/groups` and selects the returned channel;
- person selection makes no request until Send Invite;
- Send Invite posts the selected user to `/chats`;
- returned channel opens immediately;
- returned invitation displays `Invitation sent` and does not expose conversation content;
- existing search, filters, messages, notes, participants, and pending invitation responses remain available.

- [ ] **Step 5: Extract and implement CompanyChatWorkspace**

Move conversation list, selected conversation workspace, messages, notes, shared files, people management, pending invitation UI, drafts, favorites, and filters out of the conditional combined component. Use `useBrand().name ?? "Company"` for the heading and navigation label rendering.

Replace the old `<details>` New Chat person-only flow with `ChatTargetPicker`. Keep the existing mutation retry operation identifier so a retry cannot duplicate a chat.

- [ ] **Step 6: Route the chat module and update the nav label**

Render `<CompanyChatWorkspace />` for the `chat` module. Change `getWorkHubNavItems` to return a mapped copy whose `channels` label is `Groups` and whose `chat` label is `${companyName?.trim() || "Company"} Chat`. In `WorkHubNavigation`, read `useBrand().name` and call `getWorkHubNavItems(undefined, brand.name)` before ordering items. This keeps the pure navigation helper testable while making the rendered label organization-aware.

- [ ] **Step 7: Run focused chat tests and verify green**

Run:

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/vndrly exec vitest run src/components/work-hub/chat-target-picker.test.tsx src/components/work-hub/company-chat-workspace.test.tsx src/components/work-hub/collaboration.test.tsx src/lib/work-hub-nav.test.ts
```

Expected: PASS.

- [ ] **Step 8: Commit the Company Chat workspace**

```powershell
git add artifacts/vndrly/src/components/work-hub/company-chat-workspace.tsx artifacts/vndrly/src/components/work-hub/company-chat-workspace.test.tsx artifacts/vndrly/src/components/work-hub/chat-target-picker.tsx artifacts/vndrly/src/components/work-hub/chat-target-picker.test.tsx artifacts/vndrly/src/components/work-hub/collaboration.tsx artifacts/vndrly/src/components/work-hub/collaboration.test.tsx artifacts/vndrly/src/components/work-hub/navigation.tsx artifacts/vndrly/src/pages/work-hub.tsx artifacts/vndrly/src/lib/work-hub-nav.ts artifacts/vndrly/src/lib/work-hub-nav.test.ts
git commit -m "Build company-named chat workspace"
```

---

### Task 5: Conversation Invitations and Deep-Link Compatibility

**Files:**
- Modify: `artifacts/vndrly/src/components/work-hub/company-chat-workspace.tsx`
- Modify: `artifacts/vndrly/src/components/work-hub/company-chat-workspace.test.tsx`
- Modify: `artifacts/vndrly/src/components/work-hub/activity-dashboard.tsx`
- Modify: `artifacts/vndrly/src/components/work-hub/calendar-summary-cards.tsx`
- Modify: `artifacts/vndrly/src/components/work-hub/csv-import.tsx`
- Modify: `artifacts/vndrly/src/components/work-hub/import-export.tsx`
- Modify: `artifacts/vndrly/src/lib/work-hub-client.ts`
- Modify: `artifacts/vndrly/src/lib/work-hub-client.test.ts`
- Modify: `artifacts/vndrly/src/pages/work-hub.tsx`

**Interfaces:**
- Consumes: relationship-scoped `/people`, `/channels/:channelId/invitations`, `?channel=<id>`, and the existing pending invitation response endpoint.
- Produces: all conversation links target `/work-hub/chat`; `/work-hub/channels?channel=<id>` forwards to the same chat selection.

- [ ] **Step 1: Write failing deep-link and participant-invite tests**

Assert unread cards, activity entries, imports, and generated collaboration links use `/work-hub/chat?channel=<id>`. Mount the old URL and assert it replaces the location with the chat URL while preserving the encoded channel identifier.

In an open conversation, assert the Invite Person picker shows only eligible directory results, omits existing members and pending invitees, and posts to `/channels/:channelId/invitations` only after the user clicks Send Invite.

- [ ] **Step 2: Run focused compatibility tests and verify red**

Run:

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/vndrly exec vitest run src/components/work-hub/company-chat-workspace.test.tsx src/components/work-hub/collaboration.test.tsx src/lib/work-hub-client.test.ts
```

Expected: FAIL on old `/work-hub/channels` conversation links and the missing relationship-scoped participant filtering.

- [ ] **Step 3: Move all conversation links to Company Chat**

Update link builders and card hrefs to `/work-hub/chat`. Add a compatibility effect at the Groups route boundary:

```ts
const legacyChannel = new URLSearchParams(window.location.search).get("channel");
if (legacyChannel) {
  window.location.replace(`/work-hub/chat?channel=${encodeURIComponent(legacyChannel)}`);
}
```

Do not redirect `/work-hub/channels` when it has no conversation query.

- [ ] **Step 4: Apply the directory picker to existing-chat invitations**

Reuse the same person option shape and labels as New Chat. Filter client-side only for already-loaded member and pending-invite identifiers; authorization remains server-side. Preserve explicit acceptance for cross-organization invitees.

- [ ] **Step 5: Run focused compatibility tests and verify green**

Run:

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/vndrly exec vitest run src/components/work-hub/company-chat-workspace.test.tsx src/components/work-hub/collaboration.test.tsx src/lib/work-hub-client.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit compatibility and invitations**

```powershell
git add artifacts/vndrly/src/components/work-hub/company-chat-workspace.tsx artifacts/vndrly/src/components/work-hub/company-chat-workspace.test.tsx artifacts/vndrly/src/components/work-hub/activity-dashboard.tsx artifacts/vndrly/src/components/work-hub/calendar-summary-cards.tsx artifacts/vndrly/src/components/work-hub/csv-import.tsx artifacts/vndrly/src/components/work-hub/import-export.tsx artifacts/vndrly/src/lib/work-hub-client.ts artifacts/vndrly/src/lib/work-hub-client.test.ts artifacts/vndrly/src/pages/work-hub.tsx
git commit -m "Route conversations through company chat"
```

---

### Task 6: Full Verification and Release Candidate Audit

**Files:**
- Modify only files required to fix demonstrated regressions from the approved scope.

**Interfaces:**
- Consumes: all Tasks 1-5 outputs.
- Produces: a locally verified web/API release candidate with no mobile, database, or unrelated file changes.

- [ ] **Step 1: Run all focused feature tests**

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/api-server exec vitest run src/work-hub/people-directory.test.ts src/routes/workHubCollaboration.test.ts
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/vndrly exec vitest run src/components/work-hub/groups-workspace.test.tsx src/components/work-hub/chat-target-picker.test.tsx src/components/work-hub/company-chat-workspace.test.tsx src/components/work-hub/collaboration.test.tsx src/lib/work-hub-nav.test.ts src/lib/work-hub-client.test.ts
```

Expected: PASS.

- [ ] **Step 2: Run type checks**

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/api-server run typecheck
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/vndrly run typecheck
```

Expected: both PASS.

- [ ] **Step 3: Run full web and API suites**

```powershell
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai run test:web
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai run test:api
```

Expected: both PASS; API uses the isolated test database wrapper.

- [ ] **Step 4: Run production builds**

```powershell
$env:BASE_PATH='/'; pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/vndrly run build
pnpm --dir C:\Users\JohnElerick\DEV\VNDRLY.ai --filter @workspace/api-server run build
```

Expected: both PASS.

- [ ] **Step 5: Audit the exact diff**

```powershell
git diff --check
git status --short
git diff --stat
```

Confirm there are no database migrations, mobile files, generated static builds, credentials, or unrelated working-tree files in the release candidate.

- [ ] **Step 6: Commit verification fixes only if required**

If verification exposed an in-scope regression, return to the task that owns the failing behavior, apply that task's exact test-first cycle, and use that task's explicit `git add` list. Before committing, confirm the candidate file list with:

```powershell
git diff --name-only
```

Then commit the focused correction as `Verify Groups and company chat separation`. If no fixes were needed, do not create an empty release-only commit.
