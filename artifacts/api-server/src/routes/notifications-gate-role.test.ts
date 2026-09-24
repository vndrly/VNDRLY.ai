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
}));
vi.mock("drizzle-orm", () => ({
  eq: (c: string, v: any) => (r: any) =>
    (+new Date(r[c]) === +new Date(v) && v instanceof Date) || r[c] === v,
  lt: (c: string, v: any) => (r: any) => r[c] < v,
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
    (parts: TemplateStringsArray) =>
      parts.join("").includes("count(*)")
        ? "count"
        : (r: any) => r.category !== "comments",
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
    const execute = () => {
      let rows = (state.tables[table.name] ?? []).filter(predicate);
      if (patch) rows.forEach((r) => Object.assign(r, patch));
      rows = [...rows]
        .sort((a, b) => {
          for (const key of order) {
            if (a[key] < b[key]) return 1;
            if (a[key] > b[key]) return -1;
          }
          return 0;
        })
        .slice(0, cap);
      if (select?.n === "count") return [{ n: rows.length }];
      return rows.map((r) =>
        select
          ? Object.fromEntries(
              Object.entries(select).map(([k, v]) => [k, r[v as string]]),
            )
          : { ...r },
      );
    };
    const chain: any = {
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
    pool: {},
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
});
const office = buildTestCookie({ userId: 7, role: "vendor", vendorId: 11 });
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
  state.channelContexts = {};
  app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api", (await import("./notifications")).default);
  attachTestErrorMiddleware(app);
});
const get = (path = "", cookie = gate) =>
  request(app).get(`/api/notifications${path}`).set("Cookie", cookie);

describe("role-aware notification inbox", () => {
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
    expect((await get("", office)).body.items?.map((r: any) => r.id)).toEqual([
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
    expect(first.body.nextCursor).toEqual({ createdAt: at, id: 36 });
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
    expect((await get("", office)).body.items).toHaveLength(2);
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
  it("keeps office email-only comments out of the envelope and unread count", async () => {
    state.tables.notifications = [
      notification(2, "comment_mention"),
      notification(1, "hotlist_match"),
    ];
    state.tables.notificationPreferences = [
      { userId: 7, commentsEnabled: false, commentMentionEmailEnabled: true },
    ];
    expect((await get("", office)).body.items?.map((r: any) => r.id)).toEqual([
      1,
    ]);
    expect((await get("/unread-count", office)).body.count).toBe(1);
  });
  it("returns gate switches and atomically maps combined preferences", async () => {
    const prefs = (await get("/preferences")).body;
    expect(prefs).toEqual({
      mode: "gate",
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
