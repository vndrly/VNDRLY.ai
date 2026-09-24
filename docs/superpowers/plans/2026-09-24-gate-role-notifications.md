# Gate-Role Notifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace office-oriented notification categories for gatekeepers and gate supervisors with one authorized, Work Hub-backed gate inbox whose filters, preferences, deep links, pagination, and unread badge agree on every iPhone and iPad layout.

**Architecture:** Keep `notifications` and `notification_preferences` as the authoritative stores. Add one server-side gate-role policy that maps existing event types to seven gate display categories and applies the same visibility rules to list, unread count, mark-all-read, and preferences; the mobile client renders the server result instead of inventing a second taxonomy. Reuse existing Work Hub links and add only the two preference fields whose meaning is not already represented: Handoffs and Alerts.

**Tech Stack:** TypeScript 5.9, Express 5, Drizzle ORM/PostgreSQL, React Native/Expo Router, Vitest, React Native Testing Library, i18next.

**Spec:** `docs/superpowers/specs/2026-09-24-gate-role-notifications-design.md`

## Global Constraints

- The first implementation is local-only; do not push, deploy, publish an OTA update, or submit TestFlight.
- Gate roles are `gatekeeper` and `gate_supervisor`; all other roles keep their existing categories and preference behavior.
- Gate categories are `schedule`, `gate_crew`, `messages`, `handoffs`, `tasks`, `compliance`, and `alerts`; `all` is a filter only.
- The server is authoritative for category, visibility, unread totals, and preference gating.
- Results are newest-first, 25 at a time, using the existing stable `createdAt` cursor.
- Deep links are re-authorized at their destination; a failed destination remains unread and exposes no restricted content.
- Use existing `TogglePillButton` and brand assets: gray inactive, current brand active.
- No destructive database operation. Any schema change is additive and guarded with `ADD COLUMN IF NOT EXISTS`.
- Preserve existing rate limiting, SSE refresh, push badge synchronization, DND, and non-gate notification behavior.

## Review Focus

- A user who changes from a gate role to an office role must immediately receive the office taxonomy and count, without stale gate filters.
- A gate notification whose link points to a revoked site or removed Work Hub membership must remain unread and show the neutral unavailable state.
- Events with identical `createdAt` values must not duplicate or disappear across 25-item pages; the cursor must use `(createdAt, id)` ordering.
- Turning off a combined gate preference such as Messages must consistently gate Work Hub messages, mentions, and comment-derived messages without altering email-only behavior for office roles.
- The first and last iPhone filter pills must center correctly with VoiceOver, larger text, and narrow devices while the iPad row remains stable.

---

## File map

- `artifacts/api-server/src/lib/gate-notification-policy.ts` — authoritative gate-role detection, type-to-category mapping, visible-category list, and preference-key mapping.
- `artifacts/api-server/src/lib/gate-notification-policy.test.ts` — pure policy contract tests.
- `artifacts/api-server/src/routes/notifications.ts` — applies policy to list/count/read-all/preferences and returns role-aware response metadata.
- `artifacts/api-server/src/routes/notifications-gate-role.test.ts` — API regression coverage for role isolation, pagination, counts, preferences, and revoked items.
- `lib/db/src/schema/notifications.ts` — two additive preference columns.
- `artifacts/api-server/scripts/migrate-gate-notification-preferences.ts` and package script — guarded production migration.
- `artifacts/vndrly-mobile/lib/notifications-ui.ts` — gate category types, labels, icons, and `NotificationsResponse`; no client-side remapping of server categories.
- `artifacts/vndrly-mobile/lib/notification-deep-links.ts` — resolves allowed Work Hub/Profile destinations and marks read only after navigation succeeds.
- `artifacts/vndrly-mobile/components/NotificationCategoryCarousel.tsx` — centered iPhone carousel, fixed iPad row, edge fades, and branded pill states.
- `artifacts/vndrly-mobile/components/NotificationBell.tsx` — shared 27-point bell, count badge, and responsive placement.
- `artifacts/vndrly-mobile/app/notifications.tsx` — page loading, 25-row pagination, fixed filter/divider, empty/error states, and deep-link opening.
- `artifacts/vndrly-mobile/app/notification-preferences.tsx` — seven gate switches while preserving the existing office preferences UI.
- `artifacts/vndrly-mobile/components/AdaptiveNavigationShell.tsx` and `app/(tabs)/_layout.tsx` — iPad bell placement and shared count.
- `artifacts/vndrly-mobile/components/PortalPageHeader.tsx` — iPhone bell slot immediately left of the VNDRLY icon.
- `artifacts/vndrly-mobile/lib/locales/en.json` and `es.json` — category, description, empty-state, and unavailable copy.

### Task 1: Authoritative gate notification policy

**Files:**
- Create: `artifacts/api-server/src/lib/gate-notification-policy.ts`
- Create: `artifacts/api-server/src/lib/gate-notification-policy.test.ts`
- Modify: `artifacts/api-server/src/lib/session.ts`

**Interfaces:**
- Consumes: `SessionPayload.vendorRole`, `SessionPayload.managedSubcontractor.siteGrants`, and notification `{ type, category, link }`.
- Produces: `GateNotificationCategory`, `GATE_NOTIFICATION_CATEGORIES`, `isGateNotificationSession(session)`, `resolveGateNotificationCategory(row)`, `gateNotificationVisible(row)`, and `gatePreferenceKeys(category)`.

- [ ] **Step 1: Write the failing pure-policy tests**

```ts
it.each([
  ["work_hub_shift_assigned", "schedule"],
  ["work_hub_meeting_changed", "schedule"],
  ["work_hub_announcement", "gate_crew"],
  ["work_hub_message", "messages"],
  ["work_hub_mention", "messages"],
  ["gate_handoff_ready", "handoffs"],
  ["work_hub_task_assigned", "tasks"],
  ["cert_expiring", "compliance"],
  ["safety_stop_work", "alerts"],
])("maps %s to %s", (type, expected) => {
  expect(resolveGateNotificationCategory({ type, category: "system", link: "/work-hub" })).toBe(expected);
});

it("omits office-only and routine system notices", () => {
  expect(gateNotificationVisible({ type: "hotlist_match", category: "hotlist", link: "/hotlist" })).toBe(false);
  expect(gateNotificationVisible({ type: "rating_received", category: "system", link: "/ratings" })).toBe(false);
});

it("recognizes direct and managed gate assignments", () => {
  expect(isGateNotificationSession({ vendorRole: "gatekeeper" })).toBe(true);
  expect(isGateNotificationSession({ managedSubcontractor: { siteGrants: [{ siteId: 3, role: "gate_supervisor" }] } })).toBe(true);
});
```

- [ ] **Step 2: Run the policy test and verify it fails because the module does not exist**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/gate-notification-policy.test.ts`

Expected: FAIL with an unresolved `gate-notification-policy` import.

- [ ] **Step 3: Implement the closed mapping and fail-closed visibility rule**

```ts
export const GATE_NOTIFICATION_CATEGORIES = [
  "schedule", "gate_crew", "messages", "handoffs", "tasks", "compliance", "alerts",
] as const;
export type GateNotificationCategory = (typeof GATE_NOTIFICATION_CATEGORIES)[number];

const GATE_TYPE_CATEGORY: Readonly<Record<string, GateNotificationCategory>> = {
  work_hub_shift_assigned: "schedule",
  work_hub_shift_changed: "schedule",
  work_hub_meeting_invite: "schedule",
  work_hub_meeting_changed: "schedule",
  work_hub_announcement: "gate_crew",
  work_hub_message: "messages",
  work_hub_mention: "messages",
  comment_mention: "messages",
  gate_handoff_ready: "handoffs",
  gate_handoff_revised: "handoffs",
  gate_handoff_ack_required: "handoffs",
  work_hub_task_assigned: "tasks",
  work_hub_task_updated: "tasks",
  cert_expiring: "compliance",
  cert_expired: "compliance",
  safety_stop_work: "alerts",
  safety_event_hipo: "alerts",
  gate_closed: "alerts",
  gate_access_changed_urgent: "alerts",
};

export function resolveGateNotificationCategory(row: { type: string }): GateNotificationCategory | null {
  return GATE_TYPE_CATEGORY[row.type] ?? null;
}

export function gateNotificationVisible(row: { type: string }): boolean {
  return resolveGateNotificationCategory(row) !== null;
}
```

Implement `isGateNotificationSession` from `vendorRole` plus managed site grants, and return exact existing preference keys for Schedule, Gate Crew, Messages, Tasks, and Compliance; return new keys for Handoffs and Alerts.

- [ ] **Step 4: Add the five Review Focus cases owned by the policy**

Add tests for role change, unknown future types failing closed, comment-to-Messages mapping, urgent-only safety mapping, and a managed worker with mixed site grants.

- [ ] **Step 5: Run the policy test and API typecheck**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/gate-notification-policy.test.ts`

Run: `pnpm --filter @workspace/api-server run typecheck`

Expected: PASS.

- [ ] **Step 6: Commit the policy**

```powershell
git add -- artifacts/api-server/src/lib/gate-notification-policy.ts artifacts/api-server/src/lib/gate-notification-policy.test.ts artifacts/api-server/src/lib/session.ts
git commit -m "feat: define gate notification policy"
```

### Task 2: Add gate-only preference storage safely

**Files:**
- Modify: `lib/db/src/schema/notifications.ts`
- Create: `artifacts/api-server/scripts/migrate-gate-notification-preferences.ts`
- Modify: `artifacts/api-server/package.json`
- Create: `artifacts/api-server/src/lib/gate-notification-preferences.test.ts`

**Interfaces:**
- Consumes: existing `notification_preferences` row.
- Produces: `gateHandoffsEnabled: boolean` and `gateAlertsEnabled: boolean`, both defaulting to `true`.

- [ ] **Step 1: Write a failing schema contract test**

```ts
it("exposes additive gate preference columns with true defaults", () => {
  expect(getTableConfig(notificationPreferencesTable).columns.map((c) => c.name)).toEqual(
    expect.arrayContaining(["gate_handoffs_enabled", "gate_alerts_enabled"]),
  );
});
```

- [ ] **Step 2: Run the test and verify the columns are absent**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/gate-notification-preferences.test.ts`

Expected: FAIL because both column names are missing.

- [ ] **Step 3: Add the Drizzle columns and guarded migration**

```ts
gateHandoffsEnabled: boolean("gate_handoffs_enabled").notNull().default(true),
gateAlertsEnabled: boolean("gate_alerts_enabled").notNull().default(true),
```

```ts
await db.execute(sql`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS gate_handoffs_enabled boolean NOT NULL DEFAULT true`);
await db.execute(sql`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS gate_alerts_enabled boolean NOT NULL DEFAULT true`);
```

Register `migrate:gate-notification-preferences` in the API package. Do not run the migration against shared or production data during local visual implementation.

- [ ] **Step 4: Run schema test and database typecheck**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/gate-notification-preferences.test.ts`

Run: `pnpm --filter @workspace/db run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit additive preference storage**

```powershell
git add -- lib/db/src/schema/notifications.ts artifacts/api-server/scripts/migrate-gate-notification-preferences.ts artifacts/api-server/package.json artifacts/api-server/src/lib/gate-notification-preferences.test.ts
git commit -m "feat: store gate notification preferences"
```

### Task 3: Make notification APIs role-aware and page-safe

**Files:**
- Modify: `artifacts/api-server/src/routes/notifications.ts`
- Create: `artifacts/api-server/src/routes/notifications-gate-role.test.ts`
- Modify: `artifacts/api-server/src/routes/notifications-list-filter.test.ts`

**Interfaces:**
- Consumes: Task 1 policy and Task 2 preference fields.
- Produces: `GET /api/notifications?category=<id>&limit=25&beforeCreatedAt=<iso>&beforeId=<id>` returning `{ items, nextCursor, categories }`, plus `POST /api/notifications/:id/resolve`; unread count and read-all use the same gate visibility predicate.

- [ ] **Step 1: Write failing route tests for gate and non-gate callers**

```ts
it("returns only mapped gate categories and preserves office output", async () => {
  const gate = await request(app).get("/api/notifications?limit=25").set("Cookie", gateCookie());
  expect(gate.body.items.map((row: any) => row.displayCategory)).toEqual(["schedule", "messages"]);
  expect(gate.body.items.some((row: any) => row.type === "hotlist_match")).toBe(false);

  const office = await request(app).get("/api/notifications?limit=25").set("Cookie", officeCookie());
  expect(office.body.items.some((row: any) => row.type === "hotlist_match")).toBe(true);
});
```

Add failures for: seven-category unread sum, category filter, stable `(createdAt,id)` second page, gate-only read-all, disabled gate category, managed gatekeeper, and office regression.

- [ ] **Step 2: Run the route tests and verify the current raw-array endpoint fails the contract**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/notifications-gate-role.test.ts src/routes/notifications-list-filter.test.ts`

Expected: FAIL because the response has no `items`, `displayCategory`, or stable two-part cursor.

- [ ] **Step 3: Add one query builder used by list, unread count, and read-all**

```ts
type NotificationCursor = { createdAt: string; id: number };

function cursorPredicate(cursor: NotificationCursor) {
  const at = new Date(cursor.createdAt);
  return or(
    lt(notificationsTable.createdAt, at),
    and(eq(notificationsTable.createdAt, at), lt(notificationsTable.id, cursor.id)),
  );
}
```

Fetch gate rows in bounded batches, apply the closed type mapping, and continue until 26 authorized rows or exhaustion so office-only rows cannot shorten a gate page. Return 25 items and derive `nextCursor` from the last returned row. Preserve the current raw-array behavior only for focused legacy `?type=` consumers, or update those consumers and tests in the same task.

- [ ] **Step 4: Apply identical visibility to unread count and read-all**

For gate callers, count and update only types in the closed gate mapping whose category preference is enabled. Keep non-gate SQL and comments-email visibility behavior unchanged. `read-all` publishes one existing `all_read` event after scoped rows change.

- [ ] **Step 5: Return and patch role-specific preferences**

For gate callers, `GET /notifications/preferences` returns:

```ts
{
  mode: "gate",
  scheduleEnabled,
  gateCrewEnabled,
  messagesEnabled,
  handoffsEnabled,
  tasksEnabled,
  complianceEnabled,
  alertsEnabled,
  pushEnabled,
  dndStartHour,
  dndEndHour,
}
```

Map combined switches atomically: Schedule updates `workHubScheduleEnabled` and `workHubMeetingsEnabled`; Messages updates `workHubMessagesEnabled` and `commentsEnabled`. Other roles continue receiving the existing preference object.

- [ ] **Step 6: Add a resolve-before-read endpoint**

Add `POST /notifications/:id/resolve`. Load only a row owned by the current user, normalize its app-relative link, and call the existing authorization function for the referenced Work Hub owner/channel/item, gate site/handoff, or Profile credential. Return `{ href }` only when the current session can still open the subject; otherwise return the same neutral `404 notification.unavailable` for missing, malformed, cross-tenant, and revoked subjects. The endpoint must not change `isRead`. Add route tests proving a valid subject returns its exact href and a revoked/cross-tenant subject stays unread.

- [ ] **Step 7: Run focused and full API verification**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/gate-notification-policy.test.ts src/routes/notifications-gate-role.test.ts src/routes/notifications-list-filter.test.ts src/routes/notifications-comments.test.ts`

Run: `pnpm run test:api`

Expected: PASS against the isolated test database.

- [ ] **Step 8: Commit the role-aware API**

```powershell
git add -- artifacts/api-server/src/routes/notifications.ts artifacts/api-server/src/routes/notifications-gate-role.test.ts artifacts/api-server/src/routes/notifications-list-filter.test.ts
git commit -m "feat: serve gate role notification inbox"
```

### Task 4: Add mobile gate response and deep-link contracts

**Files:**
- Modify: `artifacts/vndrly-mobile/lib/notifications-ui.ts`
- Create: `artifacts/vndrly-mobile/lib/notification-deep-links.ts`
- Create: `artifacts/vndrly-mobile/lib/notification-deep-links.test.ts`
- Modify: `artifacts/vndrly-mobile/app/notifications.tsx`

**Interfaces:**
- Consumes: Task 3 `items`, `nextCursor`, `categories`, and each row's `displayCategory` and `link`.
- Produces: `NotificationsResponse`, `openNotificationDestination(row, router) => Promise<"opened" | "unavailable">`.

- [ ] **Step 1: Write failing deep-link tests**

```ts
it.each([
  ["schedule", "/(tabs)/work-hub?section=calendar"],
  ["gate_crew", "/(tabs)/work-hub?section=groups"],
  ["messages", "/(tabs)/work-hub?section=communications"],
  ["handoffs", "/(tabs)/shift-notes"],
  ["tasks", "/(tabs)/work-hub?section=my-work"],
  ["compliance", "/(tabs)/profile?section=compliance"],
  ["alerts", "/(tabs)/work-hub?section=activity"],
])("opens %s destinations", async (category, fallback) => {
  await expect(resolveNotificationHref({ displayCategory: category, link: fallback })).resolves.toBe(fallback);
});
```

Add cases for a server-supplied exact Work Hub item, an unsupported external URL, and a rejected `/resolve` response returning `unavailable` without calling `/read`.

- [ ] **Step 2: Run the test and verify the resolver is missing**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run lib/notification-deep-links.test.ts`

Expected: FAIL on unresolved import.

- [ ] **Step 3: Define server-owned response types and the fail-closed resolver**

```ts
export type GateNotificationCategory = "schedule" | "gate_crew" | "messages" | "handoffs" | "tasks" | "compliance" | "alerts";
export type GateNotificationRow = NotificationRow & { displayCategory: GateNotificationCategory };
export type NotificationsResponse = {
  items: GateNotificationRow[];
  nextCursor: { createdAt: string; id: number } | null;
  categories: readonly GateNotificationCategory[];
};
```

Call `POST /api/notifications/:id/resolve` first and accept only the app-relative href returned by that endpoint. After resolution succeeds, navigate to the href and call `POST /api/notifications/:id/read`; if resolution fails, do neither, keep the row unread, and show `notifications.destinationUnavailable`.

- [ ] **Step 4: Run focused tests and mobile typecheck**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run lib/notification-deep-links.test.ts`

Run: `pnpm --filter @workspace/vndrly-mobile run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit response and deep-link contracts**

```powershell
git add -- artifacts/vndrly-mobile/lib/notifications-ui.ts artifacts/vndrly-mobile/lib/notification-deep-links.ts artifacts/vndrly-mobile/lib/notification-deep-links.test.ts artifacts/vndrly-mobile/app/notifications.tsx
git commit -m "feat: add gate notification deep links"
```

### Task 5: Build the responsive category carousel and paged inbox

**Files:**
- Create: `artifacts/vndrly-mobile/components/NotificationCategoryCarousel.tsx`
- Create: `artifacts/vndrly-mobile/components/NotificationCategoryCarousel.test.tsx`
- Modify: `artifacts/vndrly-mobile/app/notifications.tsx`
- Modify: `artifacts/vndrly-mobile/app/__tests__/notifications-action-modal.test.tsx`
- Modify: `artifacts/vndrly-mobile/app/__tests__/notifications-rate-limited.test.tsx`

**Interfaces:**
- Consumes: categories from Task 4, active category, unread counts, width, brand, and `onSelect`.
- Produces: fixed iPad row or centered iPhone carousel; the page owns vertical pagination separately.

- [ ] **Step 1: Write failing component tests**

Test that iPhone selection calls `scrollTo({ x: centeredX, animated: true })` without reordering, first/last pills center using measured end spacers, inactive pills use gray artwork, active uses brand artwork, edge fades are present, iPad preserves order without recentering, and accessibility state marks one selected pill.

```tsx
fireEvent.press(getByTestId("notification-category-compliance"));
expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ animated: true }));
expect(getAllByTestId(/notification-category-/).map((node) => node.props.testID)).toEqual([
  "notification-category-all",
  "notification-category-schedule",
  "notification-category-gate_crew",
  "notification-category-messages",
  "notification-category-handoffs",
  "notification-category-tasks",
  "notification-category-compliance",
  "notification-category-alerts",
]);
```

- [ ] **Step 2: Run the component test and verify failure**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run components/NotificationCategoryCarousel.test.tsx`

Expected: FAIL because the component does not exist.

- [ ] **Step 3: Implement the carousel with `TogglePillButton`**

Measure each pill with `onLayout`, keep order constant, and compute `x = pillCenter - viewportWidth / 2`. Add leading/trailing spacers of half the viewport minus half the endpoint pill. Use `LinearGradient` overlays with `pointerEvents="none"` for the subtle edge fades. At `REGULAR_NAVIGATION_BREAKPOINT`, render the same pills in a stable row and allow overflow scrolling only when required.

- [ ] **Step 4: Convert the inbox to server pagination**

Request `limit=25` and the active category. On `FlatList.onEndReached`, append the next page using both cursor values, dedupe by `id`, and stop when `nextCursor` is null. Changing category clears rows/cursor and loads page one. Keep category row and divider outside the `FlatList` so only results scroll.

- [ ] **Step 5: Add paging and error tests**

Cover 25 rows plus next page, duplicate IDs, same-time cursor rows, category reset, category-specific empty copy, rate-limit banner without filter movement, and failed deep link remaining unread.

- [ ] **Step 6: Run notification UI tests and typecheck**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run components/NotificationCategoryCarousel.test.tsx app/__tests__/notifications-action-modal.test.tsx app/__tests__/notifications-rate-limited.test.tsx lib/notification-deep-links.test.ts`

Run: `pnpm --filter @workspace/vndrly-mobile run typecheck`

Expected: PASS.

- [ ] **Step 7: Commit the responsive inbox**

```powershell
git add -- artifacts/vndrly-mobile/components/NotificationCategoryCarousel.tsx artifacts/vndrly-mobile/components/NotificationCategoryCarousel.test.tsx artifacts/vndrly-mobile/app/notifications.tsx artifacts/vndrly-mobile/app/__tests__/notifications-action-modal.test.tsx artifacts/vndrly-mobile/app/__tests__/notifications-rate-limited.test.tsx
git commit -m "feat: add responsive gate notification inbox"
```

### Task 6: Share one responsive notification bell

**Files:**
- Create: `artifacts/vndrly-mobile/components/NotificationBell.tsx`
- Create: `artifacts/vndrly-mobile/components/NotificationBell.test.tsx`
- Modify: `artifacts/vndrly-mobile/components/AdaptiveNavigationShell.tsx`
- Modify: `artifacts/vndrly-mobile/components/AdaptiveNavigationShell.test.tsx`
- Modify: `artifacts/vndrly-mobile/components/PortalPageHeader.tsx`
- Modify: `artifacts/vndrly-mobile/components/PortalPageHeader.test.tsx`
- Modify: `artifacts/vndrly-mobile/app/(tabs)/_layout.tsx`

**Interfaces:**
- Consumes: authoritative `notificationCount`, `onPress`, and layout mode.
- Produces: one 27-point bell with `99+` badge; iPad sidebar placement or iPhone header placement.

- [ ] **Step 1: Write failing bell placement tests**

```tsx
expect(getByTestId("notification-bell-icon").props.size).toBe(27);
expect(getByText("99+")).toBeTruthy();
```

Assert iPad renders the bell once inside `adaptive-sidebar`, shifted left by 12 points from its current right edge; iPhone renders it once immediately before the VNDRLY logo on every page header; both press handlers open `/(tabs)/gate-notifications`.

- [ ] **Step 2: Run tests and verify current 18-point sidebar-only bell fails**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run components/NotificationBell.test.tsx components/AdaptiveNavigationShell.test.tsx components/PortalPageHeader.test.tsx`

Expected: FAIL on size and compact placement.

- [ ] **Step 3: Extract and place the shared component**

```tsx
<NotificationBell count={notificationCount} iconSize={27} onPress={onOpenNotifications} />
```

Keep a minimum 44-by-44 accessible press target even though the visible icon is 27 points. Use the same unread count query/SSE refresh in the tab layout and pass it to either location; do not start a second poll per page.

- [ ] **Step 4: Run bell, shell, header, and navigation tests**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run components/NotificationBell.test.tsx components/AdaptiveNavigationShell.test.tsx components/PortalPageHeader.test.tsx lib/app-navigation.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit the responsive bell**

```powershell
git add -- artifacts/vndrly-mobile/components/NotificationBell.tsx artifacts/vndrly-mobile/components/NotificationBell.test.tsx artifacts/vndrly-mobile/components/AdaptiveNavigationShell.tsx artifacts/vndrly-mobile/components/AdaptiveNavigationShell.test.tsx artifacts/vndrly-mobile/components/PortalPageHeader.tsx artifacts/vndrly-mobile/components/PortalPageHeader.test.tsx 'artifacts/vndrly-mobile/app/(tabs)/_layout.tsx'
git commit -m "feat: share responsive notification bell"
```

### Task 7: Show gate-specific preferences and bilingual copy

**Files:**
- Modify: `artifacts/vndrly-mobile/app/notification-preferences.tsx`
- Modify: `artifacts/vndrly-mobile/app/__tests__/notification-preferences-shell.test.tsx`
- Modify: `artifacts/vndrly-mobile/lib/locales/en.json`
- Modify: `artifacts/vndrly-mobile/lib/locales/es.json`
- Modify: `artifacts/vndrly-mobile/lib/locales/parity.test.ts`

**Interfaces:**
- Consumes: Task 3 preference response `mode`.
- Produces: seven gate switches plus Mobile Push and DND; office users retain all existing controls.

- [ ] **Step 1: Write failing role-specific preference tests**

For `mode: "gate"`, assert Schedule, Gate Crew, Messages, Handoffs, Tasks, Compliance, and Alerts are visible; Tickets, Hotlist, Crew, Comments, and System are absent; All is absent. For office mode, assert the existing labels remain. Assert saving sends only the gate contract plus push/DND.

- [ ] **Step 2: Run the preference tests and verify office categories still appear for gate mode**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run app/__tests__/notification-preferences-shell.test.tsx`

Expected: FAIL because current rows are static.

- [ ] **Step 3: Render rows from response mode and add exact translations**

English labels: `All`, `Schedule`, `Gate Crew`, `Messages`, `Handoffs`, `Tasks`, `Compliance`, `Alerts`.

Spanish labels: `Todas`, `Horario`, `Equipo de puerta`, `Mensajes`, `Entregas de turno`, `Tareas`, `Cumplimiento`, `Alertas`.

Add category-specific empty messages and the neutral destination-unavailable message in both locales. Keep the standard header, Back-to-Notifications behavior, and right-aligned Save Preferences placement already approved.

- [ ] **Step 4: Run preference tests, locale parity, and mobile typecheck**

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run app/__tests__/notification-preferences-shell.test.tsx lib/locales/parity.test.ts`

Run: `pnpm lint:i18n`

Run: `pnpm --filter @workspace/vndrly-mobile run typecheck`

Expected: PASS.

- [ ] **Step 5: Commit preferences and translations**

```powershell
git add -- artifacts/vndrly-mobile/app/notification-preferences.tsx artifacts/vndrly-mobile/app/__tests__/notification-preferences-shell.test.tsx artifacts/vndrly-mobile/lib/locales/en.json artifacts/vndrly-mobile/lib/locales/es.json artifacts/vndrly-mobile/lib/locales/parity.test.ts
git commit -m "feat: tailor notification settings for gate roles"
```

### Task 8: Wire representative Work Hub and gate events

**Files:**
- Modify: existing Work Hub notification emitters under `artifacts/api-server/src/work-hub/`
- Modify: existing gate handoff emitters under `artifacts/api-server/src/services/gate-change-over.ts`
- Modify: existing urgent gate/safety emitters that currently call `notifyUsers`
- Create: `artifacts/api-server/src/routes/gate-notification-events.test.ts`

**Interfaces:**
- Consumes: existing `notifyUsers(userIds, { type, title, body, link, ... })`.
- Produces: canonical event types and exact authorized links for all seven gate categories; no second notification table or group-membership store.

- [ ] **Step 1: Write failing event producer tests**

Create one representative event per category and assert its type and exact link: assigned shift, Gate-group announcement, direct message/mention, completed handoff requiring acknowledgement, assigned task, expiring credential, and urgent gate closure. Assert unrelated vendor/partner users receive none.

- [ ] **Step 2: Run the event tests and identify only missing canonical emissions**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/gate-notification-events.test.ts`

Expected: Existing Work Hub categories pass where already emitted; handoff and gate-alert cases fail until their canonical notification calls are present.

- [ ] **Step 3: Add minimal missing emissions using current authorization sources**

Resolve Gate Crew recipients from current gatekeeper/gate-supervisor roles and site grants at send time. Emit `gate_handoff_ready`, `gate_handoff_revised`, or `gate_handoff_ack_required` from the existing handoff transaction. Emit urgent alert types only for immediate safety, closure, access, stop-work, or site-change events. Use dedupe keys containing the subject id and event version.

- [ ] **Step 4: Run event tests and existing Work Hub/gate regressions**

Run: `pnpm --filter @workspace/api-server exec vitest run src/routes/gate-notification-events.test.ts src/work-hub/context-access.test.ts src/services/gate-change-over.database.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit event wiring**

```powershell
git add -- artifacts/api-server/src/work-hub artifacts/api-server/src/services/gate-change-over.ts artifacts/api-server/src/routes/gate-notification-events.test.ts
git commit -m "feat: notify gate teams from work hub events"
```

### Task 9: Local integration verification and visual review

**Files:**
- Modify only if a demonstrated regression requires a fix.

**Interfaces:**
- Consumes: Tasks 1-8.
- Produces: verified local iPhone and iPad notification flows; no publication.

- [ ] **Step 1: Run focused notification suites**

Run: `pnpm --filter @workspace/api-server exec vitest run src/lib/gate-notification-policy.test.ts src/routes/notifications-gate-role.test.ts src/routes/gate-notification-events.test.ts`

Run: `pnpm --filter @workspace/vndrly-mobile exec vitest run components/NotificationCategoryCarousel.test.tsx components/NotificationBell.test.tsx app/__tests__/notifications-action-modal.test.tsx app/__tests__/notifications-rate-limited.test.tsx app/__tests__/notification-preferences-shell.test.tsx lib/notification-deep-links.test.ts`

Expected: PASS.

- [ ] **Step 2: Run mandatory static gates**

Run: `pnpm lint:i18n`

Run: `pnpm run typecheck`

Expected: PASS.

- [ ] **Step 3: Run full validation**

Run: `pnpm test`

Expected: web, mobile locales, isolated API, and end-to-end suites all PASS. Fix root causes; do not skip or narrow failing suites.

- [ ] **Step 4: Verify the local iPhone layout**

At a compact width, verify the bell and total badge sit immediately left of the VNDRLY icon on every page, the selected category centers without reordering, edge fades advertise scrolling, the filter/divider stay fixed, and only the 25-row list scrolls.

- [ ] **Step 5: Verify the local iPad layout**

At a regular iPad width, verify the 27-point bell and total badge appear only in the sidebar with the approved left shift, the eight filters stay in fixed order, and the notification/settings routes retain the full shell and header treatment.

- [ ] **Step 6: Verify all seven click-throughs**

Open one item per category and confirm the exact Work Hub or Profile destination. Revoke one item's authorization and confirm it stays unread with the neutral unavailable message. Use Mark All Read and confirm both inbox and bell reach zero.

- [ ] **Step 7: Record local review evidence without publishing**

Capture one iPhone and one iPad screenshot, record the passing commands, and report any known local-data limitations. Do not push, deploy, run OTA, or submit TestFlight.

- [ ] **Step 8: Commit only demonstrated verification fixes**

If verification required source changes, stage only those exact files and commit with a message describing the repaired behavior. If no files changed, do not create an empty commit.
