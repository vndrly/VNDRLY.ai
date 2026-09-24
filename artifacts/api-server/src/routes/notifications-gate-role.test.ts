import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
import { attachTestErrorMiddleware } from "../test-utils/route-app";

// Only persistence and the existing channel/site authority boundary are faked.
// The route, closed policy, preference mapping, cursor and subject resolver run.
const state = vi.hoisted(() => ({
  tables: {} as Record<string, any[]>,
  revokedChannels: new Set<string>(),
  channelContexts: {} as Record<string, string>,
  revokedSites: new Set<number>(),
  events: [] as unknown[],
  pageSizes: [] as number[],
  cursorTimestampBindings: [] as string[],
  subscriber: undefined as undefined | ((event: any) => void),
  currentSession: null as any,
}));
// PostgreSQL compares all six fractional digits even when the driver returns a Date.
const timestampKey = vi.hoisted(() => (value: any): string => {
  const text =
    value instanceof Date ? value.toISOString() : (value.timestamp ?? value);
  return text.replace(
    /\.(\d{1,6})Z$/,
    (_match: string, digits: string) => `.${digits.padEnd(6, "0")}Z`,
  );
});
vi.mock("drizzle-orm", () => ({
  eq: (c: string, v: any) => Object.assign((r: any) =>
    c === "createdAt"
      ? timestampKey(r.databaseCreatedAt ?? r[c]) === timestampKey(v)
      : r[c] === v, { columns: [c, v] }),
  isNull: (c: string) => (r: any) => r[c] == null,
  lt: (c: string, v: any) => (r: any) =>
    c === "createdAt"
      ? timestampKey(r.databaseCreatedAt ?? r[c]) < timestampKey(v)
      : r[c] < v,
  and:
    (...p: any[]) =>
    (r: any) =>
      p.filter(Boolean).every((f) => f(r)),
  or:
    (...p: any[]) =>
    (r: any) =>
      p.filter(Boolean).some((f) => f(r)),
  inArray: (c: string, values: any[]) => (r: any) => values.includes(r[c]),
  desc: (c: string) => c,
  sql: Object.assign(
    (parts: TemplateStringsArray, ...values: any[]) => {
      if (parts.join("") === " <> " && values[0] === "type") return (r: any) => r.type !== values[1];
      if (parts.join("").includes("::timestamptz")) {
        state.cursorTimestampBindings.push(values[0]);
        return { timestamp: values[0] };
      }
      return parts.join("").includes("to_char(")
        ? "exactTimestamp"
        : parts.join("").includes("count(*)")
          ? "count"
          : (r: any) => r.category !== "comments";
    },
    { raw: () => "" },
  ),
}));
vi.mock("@workspace/db", () => {
  const names = [
    "notifications",
    "notificationPreferences",
    "userOrgMemberships",
    "users",
    "vendorPeople",
    "workHubTasks",
    "workHubShifts",
    "workHubShiftAssignments",
    "workHubMessages",
    "workHubAnnouncements",
    "workHubAnnouncementRecipients",
    "workHubMeetingOccurrences",
    "workHubMeetings",
    "workHubMeetingParticipants",
    "employeeCertifications",
    "gateStations",
    "gateHandovers",
    "gatePreparations",
    "gateShifts",
    "workHubChecklistInstances",
    "workHubFormInstances",
    "workHubChecklistTemplates",
    "workHubFormTemplates",
    "safetyEvents",
    "workHubCalls", "workHubVoicemail", "workHubApprovalRequests", "workHubApprovalSteps", "workHubClientOperations",
    "workHubChatInvitations", "workHubCollaborationChannels", "managedSubcontractorWorkerSponsorships", "managedSubcontractorRoleGrants",
  ];
  const tables = Object.fromEntries(
    names.map((name) => [
      `${name}Table`,
      new Proxy(
        { name },
        { get: (t, k: string) => (k === "name" ? t.name : k) },
      ),
    ]),
  );
  const query = (table: any, select?: any, patch?: any) => {
    let predicate = (_r: any) => true;
    let order: string[] = [];
    let cap = Infinity;
    const joins: { table: any; columns: string[] }[] = [];
    const execute = () => {
      let rows = state.tables[table.name] ?? [];
      // These boundaries use single-column equality joins; keep the real
      // invitation status, company membership, and recipient predicates live.
      for (const join of joins) rows = rows.flatMap(row => (state.tables[join.table.name] ?? [])
        .filter(other => {
          const [a, b] = join.columns;
          return (row[a] != null && row[a] === other[b]) || (row[b] != null && row[b] === other[a]);
        }).map(other => ({ ...row, ...other })));
      rows = rows.filter(predicate);
      if (patch) rows.forEach((r) => Object.assign(r, patch));
      rows = [...rows]
        .sort((a, b) => {
          for (const key of order) {
            const av =
              key === "createdAt"
                ? timestampKey(a.databaseCreatedAt ?? a[key])
                : a[key];
            const bv =
              key === "createdAt"
                ? timestampKey(b.databaseCreatedAt ?? b[key])
                : b[key];
            if (av < bv) return 1;
            if (av > bv) return -1;
          }
          return 0;
        })
        .slice(0, cap);
      if (select?.n === "count") return [{ n: rows.length }];
      return rows.map((r) =>
        select
          ? Object.fromEntries(
              Object.entries(select).map(([k, v]) => [
                k,
                v === "exactTimestamp"
                  ? timestampKey(r.databaseCreatedAt ?? r.createdAt)
                  : (v as any)?.name === table.name
                    ? { ...r }
                    : r[v as string],
              ]),
            )
          : { ...r },
      );
    };
    const chain: any = {
      innerJoin: (table: any, on: any) => { joins.push({ table, columns: on.columns }); return chain; },
      where: (p: any) => {
        predicate = p;
        return chain;
      },
      orderBy: (...o: string[]) => {
        order = o;
        return chain;
      },
      limit: (n: number) => {
        cap = n;
        if (table.name === "notifications") state.pageSizes.push(n);
        return chain;
      },
      returning: (s: any) => {
        select = s;
        return chain;
      },
      then: (resolve: any, reject: any) =>
        Promise.resolve().then(execute).then(resolve, reject),
    };
    return chain;
  };
  return {
    ...tables,
    pool: { query: async (sql: string, values: unknown[]) => {
      expect(sql).toContain("u.suspended_at IS NULL");
      expect(sql).toContain("m.id = u.active_membership_id");
      expect(values).toEqual([7]);
      const s = state.currentSession;
      return { rows: s ? [{ userId: s.userId, userRole: s.role, sessionVersion: s.sv, membershipId: s.activeMembershipId,
        orgType: s.partnerId ? "partner" : "vendor", vendorId: s.vendorId, partnerId: s.partnerId,
        membershipRole: s.role === "field_employee" ? "field_employee" : "admin", vendorRole: s.vendorRole,
        vendorPeopleId: s.vendorPeopleId,
        grants: s.managedSubcontractor?.siteGrants ?? [] }] : [] };
    } },
    db: {
      select: (s: any) => ({ from: (t: any) => query(t, s) }),
      update: (t: any) => ({ set: (p: any) => query(t, undefined, p) }),
      insert: (t: any) => ({
        values: (v: any) => ({
          onConflictDoUpdate: ({ set }: any) => ({
            returning: async () => {
              const rows = (state.tables[t.name] ??= []);
              const row = rows.find((r) => r.userId === v.userId);
              if (row) Object.assign(row, set);
              else rows.push(v);
              return [row ?? v];
            },
          }),
        }),
      }),
    },
  };
});
vi.mock("../work-hub/queries", () => ({
  resolveChannelAccess: async (_s: unknown, id: string) => {
    if (state.revokedChannels.has(id))
      throw Object.assign(new Error("revoked"), { status: 404 });
    return {
      channel: {
        id,
        contextKind: state.channelContexts[id] ?? "gate",
        contextId: "3",
        ownerOrgType: "vendor",
        ownerOrgId: 11,
      },
    };
  },
}));
vi.mock("../services/gate-change-over", () => ({
  requireChangeOverAccess: async (_db: unknown, _s: unknown, site: number) => {
    if (state.revokedSites.has(site))
      throw Object.assign(new Error("revoked"), { status: 403 });
    return {};
  },
}));
vi.mock("../lib/expo-push", () => ({ sendPushToUser: vi.fn() }));
vi.mock("../lib/notifications-rate-limit", () => ({
  enforceNotificationsRateLimit: async () => true,
}));
vi.mock("../lib/notification-events", () => ({
  publishNotificationStateChanged: (event: unknown) => state.events.push(event),
  getCurrentNotificationEventSeq: async () => 0,
  subscribeNotificationEvents: (listener: (event: any) => void) => {
    state.subscriber = listener;
    return () => { state.subscriber = undefined; };
  },
}));
vi.mock("../lib/sendgrid", () => ({
  sendNotificationAlertEmail: vi.fn(),
  renderBulkActionExpiringEmail: vi.fn(),
}));
vi.mock("../services/notification-delivery", () => ({
  acknowledgeNotification: vi.fn(),
  databaseNotificationDeliveryRepository: {},
}));

const gate = buildTestCookie({
  userId: 7,
  role: "field_employee",
  vendorId: 11,
  vendorRole: "gatekeeper",
  sv: 1,
  activeMembershipId: 8,
});
const office = buildTestCookie({ userId: 7, role: "vendor", vendorId: 11, sv: 1, activeMembershipId: 8 });
const channel = "10000000-0000-4000-8000-000000000001";
const at = "2026-09-24T12:00:00.000Z";
function notification(
  id: number,
  type = "work_hub_message",
  extra: Record<string, unknown> = {},
) {
  return {
    id,
    userId: 7,
    type,
    category: type === "comment_mention" ? "comments" : "system",
    title: "Notice",
    body: "Summary",
    link: `/work-hub/channels/${channel}`,
    isRead: false,
    createdAt: new Date(at),
    ...extra,
  };
}
let app: express.Express;
beforeEach(async () => {
  state.tables = {
    notifications: [],
    notificationPreferences: [],
    userOrgMemberships: [
      { userId: 7, orgType: "vendor", vendorId: 11, role: "field_employee" },
    ],
  };
  state.revokedChannels.clear();
  state.revokedSites.clear();
  state.events = [];
  state.pageSizes = [];
  state.cursorTimestampBindings = [];
  state.channelContexts = {};
  state.currentSession = { userId: 7, role: "field_employee", vendorId: 11, sv: 1, activeMembershipId: 8, vendorRole: "gatekeeper", vendorPeopleId: 70 };
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", (await import("./notifications")).default);
  attachTestErrorMiddleware(app);
});
const get = (path = "", cookie = gate) =>
  request(app).get(`/api/notifications${path}`).set("Cookie", cookie);

describe("role-aware notification inbox", () => {
  it("keeps managed workers with empty grants restricted during recipient reconstruction", async () => {
    state.tables.users = [{ id: 7, sessionVersion: 1 }];
    state.tables.workHubTasks = [{ id: channel, ownerOrgType: "vendor", ownerOrgId: 11, createdById: 8, assigneeUserId: 9 }];
    const { currentNotificationRecipients } = await import("../work-hub/notification-recipients");
    expect(await currentNotificationRecipients({ type: "vendor", id: 11 }, [7], `/work-hub/tasks/${channel}`)).toEqual([]);
    state.tables.workHubTasks[0].assigneeUserId = 7;
    expect(await currentNotificationRecipients({ type: "vendor", id: 11 }, [7], `/work-hub/tasks/${channel}`)).toEqual([7]);
  });
  it("never leaks reassigned task content through real SSE for a managed worker with empty grants", async () => {
    state.currentSession = { ...state.currentSession, vendorRole: null, vendorPeopleId: null, managedSubcontractor: { siteGrants: [] } };
    const cookie = buildTestCookie(state.currentSession);
    state.tables.workHubTasks = [{ id: channel, ownerOrgType: "vendor", ownerOrgId: 11, createdById: 8, assigneeUserId: 9 }];
    state.tables.notifications = [notification(1, "work_hub_task_assigned", { title: "Private reassigned task", link: `/work-hub/tasks/${channel}` })];
    const server = app.listen(0); const controller = new AbortController();
    try {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/notifications/events`, { headers: { Cookie: cookie }, signal: controller.signal });
      const reader = response.body!.getReader(); await reader.read();
      state.subscriber!({ type: "notification.created", userId: 7, notificationId: 1, seq: 1 });
      state.subscriber!({ type: "notification.state_changed", userId: 7, state: "all_read", seq: 2 });
      let received = "";
      while (!received.includes('"seq":2')) received += new TextDecoder().decode((await reader.read()).value);
      expect(received).not.toContain("Private reassigned task");
      expect(received).not.toContain("notification.created");
      state.tables.workHubTasks[0].assigneeUserId = 7;
      state.subscriber!({ type: "notification.created", userId: 7, notificationId: 1, seq: 3 });
      while (!received.includes('"seq":3')) received += new TextDecoder().decode((await reader.read()).value);
      expect(received).toContain("Private reassigned task");
    } finally {
      controller.abort(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it.each(["call", "voicemail"])("preserves accepted cross-company %s access, but rejects revoked contacts and non-parties", async kind => {
    state.tables.users = [{ id: 8, suspendedAt: null }];
    state.tables.workHubCalls = [{ id: channel, callerUserId: 8, recipientUserId: 7, occurrenceId: channel }];
    state.tables.workHubVoicemail = [{ id: channel, callId: channel, recipientUserId: 7 }];
    state.tables.workHubMeetingOccurrences = [{ id: channel, meetingId: channel }];
    state.tables.workHubMeetings = [{ id: channel, ownerOrgType: "vendor", ownerOrgId: 99 }];
    state.tables.workHubChatInvitations = [{ channelId: channel, senderUserId: 8, recipientUserId: 7, status: "accepted" }];
    state.tables.workHubCollaborationChannels = [{ channelId: channel, kind: "chat" }];
    state.tables.notifications = [notification(1, `work_hub_${kind}`, { link: "/work-hub/calls", dedupeKey: `${kind}:${channel}` })];
    expect((await get("", office)).body.map((row: any) => row.id)).toEqual([1]);
    expect((await request(app).post("/api/notifications/1/resolve").set("Cookie", office)).body).toEqual({ href: "/work-hub/calls" });
    state.tables.workHubCalls[0].recipientUserId = 9;
    expect((await get("", office)).body).toEqual([]);
    state.tables.workHubCalls[0].recipientUserId = 7;
    state.tables.workHubChatInvitations[0].status = "revoked";
    expect((await get("", office)).body).toEqual([]);
    expect((await get("/unread-count", office)).body).toEqual({ count: 0 });
    await request(app).post("/api/notifications/read-all").set("Cookie", office);
    expect(state.tables.notifications[0].isRead).toBe(false);
  });
  it.each(["suspended", "version", "membership", "organization", "role"])("closes an existing SSE stream after current %s authority changes", async change => {
    state.tables.notifications = [notification(1)];
    const server = app.listen(0);
    const controller = new AbortController();
    try {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/notifications/events`, { headers: { Cookie: gate }, signal: controller.signal });
      const reader = response.body!.getReader();
      await reader.read();
      if (change === "suspended") state.currentSession = null;
      if (change === "version") state.currentSession.sv = 2;
      if (change === "membership") state.currentSession.activeMembershipId = 9;
      if (change === "organization") state.currentSession.vendorId = 99;
      if (change === "role") state.currentSession.role = "vendor";
      state.subscriber!({ type: "notification.created", userId: 7, notificationId: 1, seq: 1 });
      const result = await reader.read();
      expect(new TextDecoder().decode(result.value)).not.toContain("Notice");
      expect(result.done).toBe(true);
    } finally {
      controller.abort(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("office read-all marks only currently visible rows", async () => {
    state.tables.notifications = [notification(1), notification(2, "ticket_approved", { link: "/tickets/5" })];
    state.revokedChannels.add(channel);
    expect((await request(app).post("/api/notifications/read-all").set("Cookie", office)).status).toBe(204);
    expect(state.tables.notifications.map(row => row.isRead)).toEqual([false, true]);
  });
  it("office read-all leaves revoked membership and muted comment rows unread", async () => {
    state.tables.notifications = [notification(1), notification(2, "comment_mention", { link: "/tickets/5" })];
    state.tables.userOrgMemberships = [];
    state.tables.notificationPreferences = [{ userId: 7, commentsEnabled: false }];
    await request(app).post("/api/notifications/read-all").set("Cookie", office);
    expect(state.tables.notifications.map(row => row.isRead)).toEqual([false, false]);
    expect(state.events).toEqual([]);
  });
  it("uses a refreshed organization-admin role for legacy office SSE authorization", async () => {
    state.currentSession = { ...state.currentSession, role: "vendor", vendorRole: "office" };
    state.tables.userOrgMemberships[0].role = "admin";
    state.tables.workHubClientOperations = [{ operationId: channel, commandKind: "supervisor_exception", ownerOrgType: "vendor", ownerOrgId: 11 }];
    state.tables.notifications = [notification(1, "supervisor_exception", { link: "/work-hub/operations-health", dedupeKey: `supervisor:${channel}` })];
    const server = app.listen(0);
    const controller = new AbortController();
    try {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/notifications/events`, { headers: { Cookie: office }, signal: controller.signal });
      const reader = response.body!.getReader(); await reader.read();
      state.subscriber!({ type: "notification.created", userId: 7, notificationId: 1, seq: 1 });
      let received = "";
      while (!received.includes('"seq":1')) received += new TextDecoder().decode((await reader.read()).value);
      expect(received).toContain("operations-health");
      state.tables.userOrgMemberships[0].role = "member";
      state.subscriber!({ type: "notification.created", userId: 7, notificationId: 1, seq: 2 });
      state.subscriber!({ type: "notification.state_changed", userId: 7, state: "all_read", seq: 3 });
      received = "";
      while (!received.includes('"seq":3')) received += new TextDecoder().decode((await reader.read()).value);
      expect(received).not.toContain("Notice");
      expect(received).not.toContain("operations-health");
    } finally {
      controller.abort(); server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it("preserves office site channel and shift access without a gatekeeper grant", async () => {
    state.channelContexts[channel] = "site";
    state.revokedSites.add(3);
    state.tables.workHubShifts = [{ id: channel, ownerOrgType: "vendor", ownerOrgId: 11, siteLocationId: 3, channelId: channel }];
    state.tables.notifications = [notification(1), notification(2, "work_hub_shift_assigned", { link: `/work-hub/calendar?shift=${channel}` })];
    expect((await get("", office)).body.map((row: any) => row.id)).toEqual([2, 1]);
    expect((await get()).body.items).toEqual([]);
  });
  it.each(["coverage", "call", "voicemail", "approval", "health"])("authorizes legacy office %s subject and rejects tenant revocation", async kind => {
    state.tables.userOrgMemberships[0].role = "admin";
    state.tables.userOrgMemberships.push({ userId: 8, orgType: "vendor", vendorId: 11, role: "member" });
    state.tables.users = [{ id: 8 }];
    const owner = { ownerOrgType: "vendor", ownerOrgId: 11 };
    state.tables.workHubShifts = [{ id: channel, ...owner }];
    state.tables.workHubCalls = [{ id: channel, callerUserId: 8, recipientUserId: 7, occurrenceId: channel }];
    state.tables.workHubVoicemail = [{ id: "20000000-0000-4000-8000-000000000001", callId: channel, recipientUserId: 7 }];
    state.tables.workHubMeetingOccurrences = [{ id: channel, meetingId: channel }];
    state.tables.workHubMeetings = [{ id: channel, ...owner }];
    state.tables.workHubApprovalRequests = [{ id: channel, ...owner }];
    state.tables.workHubApprovalSteps = [{ requestId: channel, approverUserId: 7 }];
    state.tables.workHubClientOperations = [{ operationId: channel, commandKind: "supervisor_exception", ...owner }];
    const cases: Record<string, any> = {
      coverage: { link: "/work-hub/workforce-coverage", dedupeKey: `gate-coverage:${channel}:uncovered:1` },
      call: { link: "/work-hub/calls", dedupeKey: `call:${channel}` },
      voicemail: { link: "/work-hub/calls", dedupeKey: "voicemail:20000000-0000-4000-8000-000000000001" },
      approval: { link: `/work-hub/tasks?approval=${channel}` },
      health: { link: "/work-hub/operations-health", dedupeKey: `supervisor:${channel}` },
    };
    state.tables.notifications = [notification(1, "work_hub_legacy", cases[kind])];
    expect((await get("", office)).body.map((row: any) => row.id)).toEqual([1]);
    expect((await get("/unread-count", office)).body).toEqual({ count: 1 });
    expect((await request(app).post("/api/notifications/1/resolve").set("Cookie", office)).body).toEqual({ href: cases[kind].link });
    for (const table of ["workHubShifts", "workHubMeetings", "workHubApprovalRequests", "workHubClientOperations"]) state.tables[table][0].ownerOrgId = 99;
    state.tables.userOrgMemberships = state.tables.userOrgMemberships.filter(row => row.userId === 7);
    expect((await get("", office)).body).toEqual([]);
    expect((await get("/unread-count", office)).body).toEqual({ count: 0 });
  });
  it("rejects safety null scope even with a membership in another organization", async () => {
    const malformed = buildTestCookie({ userId: 7, role: "vendor", vendorId: null, partnerId: 22 });
    state.tables.userOrgMemberships = [{ userId: 7, orgType: "partner", partnerId: 22 }];
    state.tables.safetyEvents = [{ id: 41, vendorId: null, partnerId: 99, reportedByUserId: 8 }];
    state.tables.notifications = [notification(1, "safety_stop_work", { link: "/safety/41" })];
    expect((await get("", malformed)).body).toEqual([]);
  });
  it("resolves the exact authorized safety event, including an inactive stop-work site", async () => {
    state.tables.safetyEvents = [{ id: 41, vendorId: 11, partnerId: 22, reportedByUserId: 7 }];
    state.tables.notifications = [notification(1, "safety_stop_work", { link: "/safety/41" })];
    expect((await request(app).post("/api/notifications/1/resolve").set("Cookie", gate)).body).toEqual({ href: "/safety/41" });
    state.tables.safetyEvents[0].reportedByUserId = 8;
    expect((await request(app).post("/api/notifications/1/resolve").set("Cookie", gate)).status).toBe(404);
    expect((await request(app).post("/api/notifications/1/resolve").set("Cookie", office)).body).toEqual({ href: "/safety/41" });
    state.tables.safetyEvents[0].vendorId = 99;
    expect((await request(app).post("/api/notifications/1/resolve").set("Cookie", office)).status).toBe(404);
    expect(state.tables.notifications[0].isRead).toBe(false);
  });
  it("keeps the office array contract while excluding revoked Work Hub content and unread totals", async () => {
    state.tables.notifications = [notification(1), notification(2, "ticket_approved", { link: "/tickets/5" })];
    state.revokedChannels.add(channel);
    const response = await get("", office);
    expect(response.status).toBe(200);
    expect(response.body.map((row: any) => row.id)).toEqual([2]);
    expect((await get("/unread-count", office)).body).toEqual({ count: 1 });
    expect(state.tables.notifications[0].isRead).toBe(false);
  });
  it("hides a current destination from office users after organization membership is removed", async () => {
    state.tables.notifications = [notification(1)];
    state.tables.userOrgMemberships = [];
    expect((await get("", office)).body).toEqual([]);
    expect((await get("/unread-count", office)).body).toEqual({ count: 0 });
  });
  it.each([gate, office])("authorizes stored content before emitting a created SSE event", async (cookie) => {
    if (cookie === office) state.currentSession = { ...state.currentSession, role: "vendor", vendorRole: "office" };
    state.tables.notifications = [notification(1)];
    const server = app.listen(0);
    const controller = new AbortController();
    try {
      const port = (server.address() as { port: number }).port;
      const response = await fetch(`http://127.0.0.1:${port}/api/notifications/events`, { headers: { Cookie: cookie }, signal: controller.signal });
      const reader = response.body!.getReader();
      await reader.read();
      const event = { type: "notification.created", userId: 7, notificationId: 1, notifType: "work_hub_message", category: "system", title: "FORGED CONTENT", body: "secret", link: `/work-hub/channels/${channel}`, createdAt: at, seq: 1 };
      state.revokedChannels.add(channel);
      state.subscriber!(event);
      // A state event acts as a barrier after the asynchronous authorization.
      state.subscriber!({ type: "notification.state_changed", userId: 7, notificationId: null, state: "all_read", changedAt: at, seq: 2 });
      let received = "";
      while (!received.includes('"seq":2')) received += new TextDecoder().decode((await reader.read()).value);
      expect(received).not.toContain("secret");
      expect(received).not.toContain("notification.created");
      state.revokedChannels.clear();
      state.subscriber!({ ...event, seq: 3 });
      while (!received.includes('"seq":3')) received += new TextDecoder().decode((await reader.read()).value);
      expect(received).toContain('"title":"Notice"');
      expect(received).not.toContain("FORGED CONTENT");
    } finally {
      controller.abort();
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it.each([
    "2026-02-30T12:00:00.000975Z",
    "2026-02-29T12:00:00Z",
    "2100-02-29T12:00:00Z",
    "2026-04-31T12:00:00Z",
    "0000-01-01T00:00:00Z",
    "2026-01-01T24:00:00Z",
    "2026-01-01T12:60:00Z",
    "2026-01-01T12:00:60Z",
    "2026-01-01T12:00:00+14:01",
    "2026-01-01T12:00:00+23:00",
    "2026-01-01T12:00:00.1234567Z",
    "0",
    "September 24, 2026",
    "2026/09/24",
    "2026-09-24",
    "2026-09-24 12:00:00Z",
  ])(
    "ignores invalid cursor timestamp %s before SQL binding",
    async (createdAt) => {
      state.tables.notifications = [notification(1)];
      const response = await get(
        `?beforeCreatedAt=${encodeURIComponent(createdAt)}&beforeId=25`,
      );
      expect(response.status).toBe(200);
      expect(state.cursorTimestampBindings).toEqual([]);
      expect(response.body.items.map((row: any) => row.id)).toEqual([1]);
    },
  );
  it.each([
    "2024-02-29T12:00:00.000975Z",
    "2000-02-29T12:00:00Z",
    "2026-09-24T12:00:00.1Z",
    "2026-09-24T12:00:00.120034+05:30",
    "2026-09-24T12:00:00.000001-06:00",
    "2026-09-24T12:00:00+14:00",
  ])(
    "binds valid RFC3339 cursor %s without losing fractional digits",
    async (createdAt) => {
      const response = await get(
        `?beforeCreatedAt=${encodeURIComponent(createdAt)}&beforeId=25`,
      );
      expect(response.status).toBe(200);
      expect(state.cursorTimestampBindings).toEqual([createdAt]);
    },
  );
  it("preserves microseconds across a 25-row page boundary", async () => {
    state.tables.notifications = Array.from({ length: 30 }, (_, index) =>
      notification(index + 1, "work_hub_message", {
        // IDs deliberately run opposite to timestamp order.
        databaseCreatedAt: `2026-09-24T12:00:00.000${String(999 - index).padStart(3, "0")}Z`,
      }),
    );
    const first = await get();
    expect(first.body.items.map((row: any) => row.id)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 1),
    );
    expect(first.body.nextCursor).toEqual({
      createdAt: "2026-09-24T12:00:00.000975Z",
      id: 25,
    });
    const second = await get(
      `?beforeCreatedAt=${first.body.nextCursor.createdAt}&beforeId=25`,
    );
    expect(second.body.items.map((row: any) => row.id)).toEqual([
      26, 27, 28, 29, 30,
    ]);
    expect(second.body.nextCursor).toBeNull();
    expect(first.body.items[0]).not.toHaveProperty("cursorCreatedAt");
  });
  it("preserves microseconds when list scanning crosses 100 hidden rows", async () => {
    state.tables.notifications = Array.from({ length: 130 }, (_, index) =>
      notification(
        index + 1,
        index < 105 ? "hotlist_match" : "work_hub_message",
        {
          databaseCreatedAt: `2026-09-24T12:00:00.000${String(999 - index).padStart(3, "0")}Z`,
        },
      ),
    );
    const response = await get();
    expect(response.body.items.map((row: any) => row.id)).toEqual(
      Array.from({ length: 25 }, (_, index) => index + 106),
    );
    expect(response.body.nextCursor).toBeNull();
  });
  it("counts all submillisecond rows across internal 100-row boundaries", async () => {
    state.tables.notifications = Array.from({ length: 205 }, (_, index) =>
      notification(index + 1, "work_hub_message", {
        databaseCreatedAt: `2026-09-24T12:00:00.000${String(999 - index).padStart(3, "0")}Z`,
      }),
    );
    expect((await get("/unread-count")).body.count).toBe(205);
  });
  it("marks all submillisecond rows read across internal 100-row boundaries", async () => {
    state.tables.notifications = Array.from({ length: 205 }, (_, index) =>
      notification(index + 1, "work_hub_message", {
        databaseCreatedAt: `2026-09-24T12:00:00.000${String(999 - index).padStart(3, "0")}Z`,
      }),
    );
    await request(app).post("/api/notifications/read-all").set("Cookie", gate);
    expect(state.tables.notifications.filter((row) => row.isRead)).toHaveLength(
      205,
    );
    expect(state.events).toHaveLength(1);
  });
  it("preserves the raw array and 100-row default for the unfiltered office inbox", async () => {
    state.tables.notifications = Array.from({ length: 40 }, (_, i) =>
      notification(i + 1, "hotlist_match"),
    );
    const response = await get("", office);
    expect(response.status).toBe(200);
    expect(Array.isArray(response.body)).toBe(true);
    expect(response.body).toHaveLength(40);
  });
  it("isolates gate categories, returns metadata, and preserves office rows", async () => {
    state.tables.notifications = [
      notification(3, "hotlist_match"),
      notification(2, "work_hub_shift_assigned"),
      notification(1),
    ];
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.body.items?.map((r: any) => r.displayCategory)).toEqual([
      "schedule",
      "messages",
    ]);
    expect(response.body.categories).toEqual([
      "schedule",
      "gate_crew",
      "messages",
      "handoffs",
      "tasks",
      "compliance",
      "alerts",
    ]);
    expect((await get("", office)).body.map((r: any) => r.id)).toEqual([
      3, 2, 1,
    ]);
  });
  it("fills 25 authorized rows through hidden batches and pages same-time IDs without gaps", async () => {
    const revoked = "10000000-0000-4000-8000-000000000099";
    state.revokedChannels.add(revoked);
    state.tables.notifications = Array.from({ length: 180 }, (_, i) =>
      notification(
        i + 1,
        i >= 120 ? "hotlist_match" : "work_hub_message",
        i >= 60 && i < 120 ? { link: `/work-hub/channels/${revoked}` } : {},
      ),
    );
    const first = await get("?limit=999");
    expect(first.body.items?.map((r: any) => r.id)).toEqual(
      Array.from({ length: 25 }, (_, i) => 60 - i),
    );
    expect(first.body.nextCursor).toEqual({
      createdAt: "2026-09-24T12:00:00.000000Z",
      id: 36,
    });
    const second = await get(`?beforeCreatedAt=${at}&beforeId=36`);
    expect(second.body.items?.map((r: any) => r.id)).toEqual(
      Array.from({ length: 25 }, (_, i) => 35 - i),
    );
    const last = await get(`?beforeCreatedAt=${at}&beforeId=11`);
    expect(last.body.items).toHaveLength(10);
    expect(last.body.nextCursor).toBeNull();
    expect(Math.max(...state.pageSizes)).toBeLessThanOrEqual(100);
  });
  it("filters categories and treats an unknown gate category as empty", async () => {
    state.tables.notifications = [
      notification(2, "work_hub_shift_changed"),
      notification(1),
    ];
    expect(
      (await get("?category=schedule")).body.items?.map((r: any) => r.id),
    ).toEqual([2]);
    expect((await get("?category=hotlist")).body.items).toEqual([]);
  });
  it("shares enabled and authorized visibility across list, unread total and read-all", async () => {
    const revoked = "10000000-0000-4000-8000-000000000099";
    state.tables.notifications = [
      notification(5),
      notification(4, "work_hub_task_assigned"),
      notification(3, "hotlist_match"),
      notification(2, "work_hub_message", {
        link: `/work-hub/channels/${revoked}`,
      }),
      notification(1, "work_hub_message", { userId: 8 }),
    ];
    state.revokedChannels.add(revoked);
    state.tables.notificationPreferences = [
      { userId: 7, workHubTasksEnabled: false },
    ];
    expect((await get()).body.items?.map((r: any) => r.id)).toEqual([5]);
    expect((await get("/unread-count")).body.count).toBe(1);
    expect(
      (
        await request(app)
          .post("/api/notifications/read-all")
          .set("Cookie", gate)
      ).status,
    ).toBe(204);
    expect(
      state.tables.notifications.filter((r) => r.isRead).map((r) => r.id),
    ).toEqual([5]);
    expect(state.events).toEqual([
      { userId: 7, notificationId: null, state: "all_read" },
    ]);
    expect((await get("/unread-count")).body.count).toBe(0);
  });
  it("sums unread across all seven categories", async () => {
    state.tables.notifications = [
      "work_hub_shift_assigned",
      "work_hub_announcement",
      "work_hub_message",
      "gate_handoff_ready",
      "work_hub_task_assigned",
      "cert_expiring",
      "gate_closed",
    ].map((type, i) => notification(i + 1, type));
    state.tables.notifications.push(notification(8, "hotlist_match"));
    expect((await get("/unread-count")).body.count).toBe(7);
  });
  it("marks all authorized unread batches once, including rows older than the first page", async () => {
    state.tables.notifications = Array.from({ length: 205 }, (_, i) =>
      notification(i + 1),
    );
    state.tables.notifications.push(notification(206, "rating_received"));
    expect((await get("/unread-count")).body.count).toBe(205);
    expect(
      (
        await request(app)
          .post("/api/notifications/read-all")
          .set("Cookie", gate)
      ).status,
    ).toBe(204);
    expect(state.tables.notifications.filter((row) => row.isRead)).toHaveLength(
      205,
    );
    expect(state.tables.notifications[205].isRead).toBe(false);
    expect(state.events).toHaveLength(1);
  });
  it("excludes general office announcements from the Gate Crew category", async () => {
    state.channelContexts[channel] = "organization";
    state.tables.notifications = [notification(1, "work_hub_announcement")];
    expect((await get()).body.items).toEqual([]);
    expect((await get("/unread-count")).body.count).toBe(0);
  });
  it("recognizes managed gate sessions and immediately restores office output on role change", async () => {
    state.tables.notifications = [
      notification(2, "hotlist_match"),
      notification(1),
    ];
    const managed = buildTestCookie({
      userId: 7,
      role: "field_employee",
      vendorId: 11,
      managedSubcontractor: {
        siteGrants: [{ siteId: 3, role: "gate_supervisor" }],
      },
    });
    expect((await get("", managed)).body.items?.map((r: any) => r.id)).toEqual([
      1,
    ]);
    expect((await get("", office)).body).toHaveLength(2);
  });
  it("keeps focused type queries as arrays without bypassing gate policy", async () => {
    state.tables.notifications = [
      notification(2, "hotlist_match"),
      notification(1),
    ];
    expect(
      (await get("?type=hotlist_match", office)).body.map((r: any) => r.id),
    ).toEqual([2]);
    expect((await get("?type=hotlist_match")).body).toEqual([]);
  });
  it("keeps office email-only comments out of the array and unread count", async () => {
    state.tables.notifications = [
      notification(2, "comment_mention"),
      notification(1, "hotlist_match"),
    ];
    state.tables.notificationPreferences = [
      { userId: 7, commentsEnabled: false, commentMentionEmailEnabled: true },
    ];
    expect((await get("", office)).body.map((r: any) => r.id)).toEqual([1]);
    expect((await get("/unread-count", office)).body.count).toBe(1);
  });
  it("retains canonical urgent records but hides disabled office categories from list and badge", async () => {
    state.tables.notifications = [notification(3, "gate_closed"), notification(2, "safety_stop_work", { category: "safety" }), notification(1, "hotlist_match")];
    state.tables.notificationPreferences = [{ userId: 7, systemEnabled: false, complianceEnabled: false }];
    expect((await get("", office)).body.map((r: any) => r.id)).toEqual([1]);
    expect((await get("/unread-count", office)).body.count).toBe(1);
    expect(state.tables.notifications).toHaveLength(3);
  });
  it("returns gate switches and atomically maps combined preferences", async () => {
    const prefs = (await get("/preferences")).body;
    expect(prefs).toEqual({
      mode: "gate",
      alertsEmailEnabled: true,
      alertsSmsEnabled: false,
      alertsSmsOptedInAt: null,
      alertsSmsAvailable: false,
      scheduleEnabled: true,
      gateCrewEnabled: true,
      messagesEnabled: true,
      handoffsEnabled: true,
      tasksEnabled: true,
      complianceEnabled: true,
      alertsEnabled: true,
      pushEnabled: true,
      dndStartHour: null,
      dndEndHour: null,
    });
    const saved = await request(app)
      .patch("/api/notifications/preferences")
      .set("Cookie", gate)
      .send({
        scheduleEnabled: false,
        messagesEnabled: false,
        handoffsEnabled: false,
        alertsEnabled: false,
      });
    expect(saved.body).toMatchObject({
      mode: "gate",
      scheduleEnabled: false,
      messagesEnabled: false,
      handoffsEnabled: false,
      alertsEnabled: false,
    });
    expect(state.tables.notificationPreferences[0]).toMatchObject({
      workHubScheduleEnabled: false,
      workHubMeetingsEnabled: false,
      workHubMessagesEnabled: false,
      commentsEnabled: false,
      gateHandoffsEnabled: false,
      gateAlertsEnabled: false,
    });
    expect((await get("/preferences", office)).body.mode).toBeUndefined();
    state.tables.notifications = [
      notification(1),
      notification(2, "comment_mention"),
      notification(3, "work_hub_meeting_changed"),
    ];
    expect((await get()).body.items).toEqual([]);
  });
});

describe("resolve before read", () => {
  it("returns the exact authorized href without changing read state", async () => {
    const href = `/work-hub/channels/${channel}?message=20000000-0000-4000-8000-000000000001`;
    state.tables.workHubMessages = [
      {
        id: "20000000-0000-4000-8000-000000000001",
        channelId: channel,
        deletedAt: null,
      },
    ];
    state.tables.notifications = [
      notification(1, "work_hub_message", { link: href }),
    ];
    const result = await request(app)
      .post("/api/notifications/1/resolve")
      .set("Cookie", gate);
    expect(result.status).toBe(200);
    expect(result.body).toEqual({ href });
    expect(state.tables.notifications[0].isRead).toBe(false);
  });
  it.each([
    "https://evil.example/work-hub",
    "//evil.example",
    "/work-hub/../admin",
    "/work-hub?channel=missing&channel=other",
    "/unknown",
  ])("rejects malformed or unsupported destinations: %s", async (link) => {
    state.tables.notifications = [
      notification(1, "work_hub_message", { link }),
    ];
    const result = await request(app)
      .post("/api/notifications/1/resolve")
      .set("Cookie", gate);
    expect(result.status).toBe(404);
    expect(result.body.code).toBe("notification.unavailable");
    expect(state.tables.notifications[0].isRead).toBe(false);
  });
  it("returns the same neutral failure for revoked and foreign-owned notifications", async () => {
    state.revokedChannels.add(channel);
    state.tables.notifications = [
      notification(1),
      notification(2, "work_hub_message", { userId: 8 }),
    ];
    for (const id of [1, 2, 999]) {
      const result = await request(app)
        .post(`/api/notifications/${id}/resolve`)
        .set("Cookie", gate);
      expect(result.status).toBe(404);
      expect(result.body.code).toBe("notification.unavailable");
    }
    expect(state.tables.notifications.every((r) => !r.isRead)).toBe(true);
  });
  it("rejects a cross-tenant task even if its notification belongs to the caller", async () => {
    const id = "30000000-0000-4000-8000-000000000001";
    state.tables.workHubTasks = [
      { id, ownerOrgType: "vendor", ownerOrgId: 99, assigneeUserId: 7 },
    ];
    state.tables.notifications = [
      notification(1, "work_hub_task_assigned", {
        link: `/work-hub/tasks/${id}`,
      }),
    ];
    const result = await request(app)
      .post("/api/notifications/1/resolve")
      .set("Cookie", gate);
    expect(result.status).toBe(404);
    expect(result.body.code).toBe("notification.unavailable");
    expect(state.tables.notifications[0].isRead).toBe(false);
  });
  it("checks current company membership even when a signed role remains", async () => {
    state.tables.userOrgMemberships = [];
    state.tables.notifications = [notification(1)];
    const result = await request(app)
      .post("/api/notifications/1/resolve")
      .set("Cookie", gate);
    expect(result.status).toBe(404);
    expect(result.body.code).toBe("notification.unavailable");
  });
  it("opens an owned task and rejects a removed channel", async () => {
    const id = "30000000-0000-4000-8000-000000000001";
    state.tables.workHubTasks = [
      {
        id,
        ownerOrgType: "vendor",
        ownerOrgId: 11,
        assigneeUserId: 7,
        channelId: channel,
      },
    ];
    state.tables.notifications = [
      notification(1, "work_hub_task_assigned", {
        link: `/work-hub/tasks/${id}`,
      }),
    ];
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", gate)
      ).body,
    ).toEqual({ href: `/work-hub/tasks/${id}` });
    state.revokedChannels.add(channel);
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", gate)
      ).status,
    ).toBe(404);
  });
  it("checks gate site access and the exact handoff's station", async () => {
    const stationId = "40000000-0000-4000-8000-000000000001";
    const handoffId = "50000000-0000-4000-8000-000000000001";
    state.tables.gateStations = [{ id: stationId, siteId: 3 }];
    state.tables.gateHandovers = [{ id: handoffId, preparationId: "prep" }];
    state.tables.gatePreparations = [{ id: "prep", shiftId: "shift" }];
    state.tables.gateShifts = [{ id: "shift", stationId }];
    const href = `/(tabs)/shift-notes?stationId=${stationId}&handoffId=${handoffId}`;
    state.tables.notifications = [
      notification(1, "gate_handoff_ready", { link: href }),
    ];
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", gate)
      ).body,
    ).toEqual({ href });
    state.revokedSites.add(3);
    const denied = await request(app)
      .post("/api/notifications/1/resolve")
      .set("Cookie", gate);
    expect(denied.status).toBe(404);
    expect(denied.body.code).toBe("notification.unavailable");
    expect((await get()).body.items).toEqual([]);
  });
  it("opens only the caller's existing Profile credential", async () => {
    state.tables.vendorPeople = [
      { id: 12, userId: 7, vendorId: 11, deletedAt: null },
    ];
    state.tables.employeeCertifications = [
      { id: 21, employeeId: 12, deletedAt: null },
      { id: 22, employeeId: 99, deletedAt: null },
    ];
    const href = "/(tabs)/profile?section=compliance&credentialId=21";
    state.tables.notifications = [
      notification(1, "cert_expiring", { link: href }),
      notification(2, "cert_expiring", { link: "/profile?credentialId=22" }),
    ];
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", gate)
      ).body,
    ).toEqual({ href });
    const denied = await request(app)
      .post("/api/notifications/2/resolve")
      .set("Cookie", gate);
    expect(denied.status).toBe(404);
    expect(denied.body.code).toBe("notification.unavailable");
  });
  it("opens assigned forms through the template owner and current channel", async () => {
    const id = "60000000-0000-4000-8000-000000000001";
    state.tables.workHubFormInstances = [
      { id, assigneeUserId: 7, channelId: channel, templateId: "template" },
    ];
    state.tables.workHubFormTemplates = [
      { id: "template", ownerOrgType: "vendor", ownerOrgId: 11 },
    ];
    const href = `/work-hub/tasks?form=${id}`;
    state.tables.notifications = [
      notification(1, "work_hub_task_assigned", { link: href }),
    ];
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", gate)
      ).body,
    ).toEqual({ href });
    state.tables.workHubFormInstances[0].assigneeUserId = 8;
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", gate)
      ).status,
    ).toBe(404);
  });
  it("rejects cross-kind subject parameters instead of returning an unchecked href", async () => {
    state.tables.notifications = [
      notification(1, "work_hub_message", {
        link: `/work-hub/channels/${channel}?siteId=99`,
      }),
    ];
    const response = await request(app)
      .post("/api/notifications/1/resolve")
      .set("Cookie", gate);
    expect(response.status).toBe(404);
    expect(response.body.code).toBe("notification.unavailable");
  });
  it("checks current meeting participation, including removals", async () => {
    const id = "70000000-0000-4000-8000-000000000001";
    state.tables.workHubMeetingOccurrences = [{ id, meetingId: "meeting" }];
    state.tables.workHubMeetings = [
      {
        id: "meeting",
        ownerOrgType: "vendor",
        ownerOrgId: 11,
        channelId: channel,
      },
    ];
    state.tables.workHubMeetingParticipants = [
      { occurrenceId: id, userId: 7, removedAt: null },
    ];
    const href = `/work-hub/meetings/${id}`;
    state.tables.notifications = [
      notification(1, "work_hub_meeting_invite", { link: href }),
    ];
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", gate)
      ).body,
    ).toEqual({ href });
    state.tables.workHubMeetingParticipants[0].removedAt = new Date();
    const result = await request(app)
      .post("/api/notifications/1/resolve")
      .set("Cookie", gate);
    expect(result.status).toBe(404);
    expect(result.body.code).toBe("notification.unavailable");
    expect((await get()).body.items).toEqual([]);
  });
  it("opens the exact shift but rejects a managed worker after assignment is revoked", async () => {
    const id = "80000000-0000-4000-8000-000000000001";
    state.tables.workHubShifts = [
      {
        id,
        ownerOrgType: "vendor",
        ownerOrgId: 11,
        channelId: channel,
        createdById: 8,
        sharedWithUserIds: [],
        siteLocationId: 3,
      },
    ];
    state.tables.workHubShiftAssignments = [{ shiftId: id, userId: 7 }];
    const href = `/work-hub/calendar?shift=${id}`;
    state.tables.notifications = [
      notification(1, "work_hub_shift_assigned", { link: href }),
    ];
    const managed = buildTestCookie({
      userId: 7,
      role: "field_employee",
      vendorId: 11,
      managedSubcontractor: { siteGrants: [{ siteId: 3, role: "gatekeeper" }] },
    });
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", managed)
      ).body,
    ).toEqual({ href });
    state.tables.workHubShiftAssignments = [];
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", managed)
      ).status,
    ).toBe(404);
  });
  it("opens a gate announcement only while the recipient and publication are current", async () => {
    const id = "90000000-0000-4000-8000-000000000001";
    state.tables.workHubAnnouncements = [
      {
        id,
        ownerOrgType: "vendor",
        ownerOrgId: 11,
        channelId: channel,
        withdrawnAt: null,
      },
    ];
    state.tables.workHubAnnouncementRecipients = [
      { announcementId: id, userId: 7 },
    ];
    const href = `/work-hub?announcement=${id}`;
    state.tables.notifications = [
      notification(1, "work_hub_announcement", { link: href }),
    ];
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", gate)
      ).body,
    ).toEqual({ href });
    state.tables.workHubAnnouncements[0].withdrawnAt = new Date();
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", gate)
      ).status,
    ).toBe(404);
    state.tables.workHubAnnouncements[0].withdrawnAt = null;
    state.tables.workHubAnnouncementRecipients = [];
    expect(
      (
        await request(app)
          .post("/api/notifications/1/resolve")
          .set("Cookie", gate)
      ).status,
    ).toBe(404);
  });
});
