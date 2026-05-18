import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Task #651: regression coverage for the new hard-blocking
// certification enforcement on POST /tickets/:id/schedule.
//
// Sister test to ticket-schedule-cert-warnings.test.ts (Task #646),
// which pinned the warn-only `certWarnings` branch. Where that test
// proves a missing cert never blocks the save, this one proves the
// new `blockingCertifications` array DOES block — and that the
// platform-admin `overrideBlockingCerts: true` re-POST writes one row
// to `schedule_cert_override_audit_log` and lets the schedule through.
//
// The four cases this file pins:
//   1. Warn-only path: `requiredCertifications` set, no
//      `blockingCertifications` → schedule saves (200), `certWarnings`
//      surfaced (legacy behavior preserved).
//   2. Block without override (admin caller, no flag) → 400 with
//      `code: "schedule.certifications_blocked"`,
//      `canOverride: true`, `blockingMissing` populated, schedule
//      NOT saved.
//   3. Block without override (vendor caller, no flag) → 400 with
//      `canOverride: false`, schedule NOT saved.
//   4. Admin override (`overrideBlockingCerts: true`) → schedule
//      saves, one row written to scheduleCertOverrideAuditLog with
//      the missing-by-employee snapshot.
//
// Mock recipe mirrors ticket-schedule-cert-warnings.test.ts: a
// drizzle-style chainable select queue plus full mocks for
// notifications/expo-push.

const cookieFor = (s: object) => buildTestCookie(s);

const TICKET_ID = 9999;
const VENDOR_ID = 12;
const ADMIN_USER_ID = 1;
const VENDOR_ADMIN_USER_ID = 2;

const adminCookie = cookieFor({
  userId: ADMIN_USER_ID,
  role: "admin",
  vendorId: null,
  partnerId: null,
});

const vendorAdminCookie = cookieFor({
  userId: VENDOR_ADMIN_USER_ID,
  role: "vendor",
  vendorId: VENDOR_ID,
  partnerId: null,
});

let selectQueue: any[] = [];
const auditInsertCalls: any[] = [];

function makeChain(rows: any[]) {
  const chain: any = {
    from: () => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    orderBy: () => Promise.resolve(rows),
    limit: () => Promise.resolve(rows),
  };
  chain.where = () => {
    const next: any = {
      then: (resolve: any) => Promise.resolve(rows).then(resolve),
      orderBy: () => Promise.resolve(rows),
      limit: () => Promise.resolve(rows),
      leftJoin: () => next,
      innerJoin: () => next,
    };
    return next;
  };
  return chain;
}

vi.mock("../lib/logger", () => ({
  logger: { warn: () => undefined, info: () => undefined, error: () => undefined },
}));

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: () => {
      const head = selectQueue.shift();
      const rows = head == null ? [] : Array.isArray(head) ? head : [head];
      return makeChain(rows);
    },
    insert: (table: any) => ({
      values: (values: any) => {
        // Only the override audit-log insert is interesting to assert
        // on. Every other insert call (ticket_crew, scheduled
        // notifications) is exercised by other test files.
        // The Proxy table tag intercepts every property get, so the
        // direct `__name` slot lives on the target accessed via
        // `Reflect.get(table, Symbol.for("name"))` would also be
        // proxied; the cleanest disambiguator is to look at any
        // column-shaped value's `__table` field, which the Proxy
        // returns intact.
        const tableName: unknown =
          (table as { __col?: { __table?: string } } | undefined)?.__col
            ?.__table ??
          (table as any)?.id?.__table ??
          (table as any)?.ticketId?.__table;
        if (tableName === "scheduleCertOverrideAuditLog") {
          auditInsertCalls.push(values);
          return Promise.resolve([]);
        }
        return {
          returning: () => Promise.resolve([]),
        };
      },
    }),
    update: () => ({
      set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (fn: any) => fn(db),
  };
  return {
    db,
    pool: { query: async () => ({ rows: [] }) },
    ticketsTable: tableTag("tickets"),
    ticketCrewTable: tableTag("ticketCrew"),
    ticketScheduledNotificationsTable: tableTag("ticketScheduledNotifications"),
    vendorPeopleTable: tableTag("vendorPeople"),
    siteLocationsTable: tableTag("siteLocations"),
    partnersTable: tableTag("partners"),
    workTypesTable: tableTag("workTypes"),
    vendorsTable: tableTag("vendors"),
    usersTable: tableTag("users"),
    userOrgMembershipsTable: tableTag("userOrgMemberships"),
    employeeCertificationsTable: tableTag("employeeCertifications"),
    gpsLogsTable: tableTag("gpsLogs"),
    scheduleCertOverrideAuditLogTable: tableTag("scheduleCertOverrideAuditLog"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
  };
});

vi.mock("@workspace/db/format", () => ({
  formatTicketTrackingNumber: (id: number) =>
    `VNDRLY-${String(id).padStart(8, "0")}`,
}));

const sendPushToUserMock = vi.fn(async () => undefined);
vi.mock("../lib/expo-push", () => ({
  sendPushToUser: (...args: unknown[]) =>
    (sendPushToUserMock as unknown as (...a: unknown[]) => Promise<void>)(
      ...args,
    ),
}));

const notifyUsersMock = vi.fn(async () => 1);
vi.mock("./notifications", () => ({
  notifyUsers: (...args: unknown[]) =>
    (notifyUsersMock as unknown as (...a: unknown[]) => Promise<number>)(
      ...args,
    ),
}));

const notifyRemovedCrewMemberMock = vi.fn(async () => undefined);
vi.mock("./crew", () => ({
  notifyRemovedCrewMember: (...args: unknown[]) =>
    (notifyRemovedCrewMemberMock as unknown as (
      ...a: unknown[]
    ) => Promise<void>)(...args),
}));

let app: express.Express;

const ticketRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  status: "scheduled",
  siteLocationId: 5050,
  partnerId: 77,
};
const ticketDetailsRow = {
  id: TICKET_ID,
  vendorId: VENDOR_ID,
  siteLocationId: 5050,
  workTypeId: 80,
};
const siteRow = { name: "Pad C", address: "456 Field Rd", partnerId: 77 };
const partnerRow = { name: "BigOps" };

const SCHEDULED_AT = "2026-05-01T15:00:00.000Z";
const FUTURE_EXP = "2099-12-31";

beforeEach(async () => {
  selectQueue = [];
  auditInsertCalls.length = 0;
  notifyUsersMock.mockClear();
  sendPushToUserMock.mockClear();
  notifyRemovedCrewMemberMock.mockClear();
  vi.resetModules();
  const router = (await import("./ticketSchedule")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

// Select sequence in POST /tickets/:id/schedule for an admin caller
// when work_type carries blockingCertifications. The vendor-admin path
// adds one extra select (the `userOrgMemberships` lookup inside
// `ensureSchedulerAuth`) ahead of the rest, which is why the vendor
// test prepends a membership row.
function queueForAdmin(opts: {
  crew: Array<{ id: number; userId: number | null; firstName?: string; lastName?: string }>;
  certs: Array<{ employeeId: number; name: string; expirationDate: string }>;
  workType: {
    name: string;
    requiredCertifications?: string[] | null;
    blockingCertifications?: string[] | null;
  };
}) {
  return [
    ticketRow,
    opts.crew.map((c) => ({
      id: c.id,
      userId: c.userId,
      firstName: c.firstName ?? "First",
      lastName: c.lastName ?? "Last",
      vendorId: VENDOR_ID,
    })),
    ticketDetailsRow,
    siteRow,
    {
      name: opts.workType.name,
      requiredCertifications: opts.workType.requiredCertifications ?? null,
      blockingCertifications: opts.workType.blockingCertifications ?? null,
    },
    partnerRow,
    [], // conflict-detection query — no overlapping tickets
    opts.certs,
  ];
}

function queueForVendorAdmin(opts: Parameters<typeof queueForAdmin>[0]) {
  // ensureSchedulerAuth runs the userOrgMemberships lookup BEFORE
  // returning vendor-admin auth (only for role="vendor"). Prepend a
  // role="admin" membership row so the route accepts the caller as a
  // vendor admin for this vendor.
  return [
    ticketRow,
    [{ role: "admin" }],
    ...queueForAdmin(opts).slice(1),
  ];
}

describe("POST /tickets/:id/schedule — Task #651 blocking certifications", () => {
  it("warn-only path: certWarnings populated but schedule still saves", async () => {
    // Same shape as the Task #646 test: requiredCertifications only,
    // no blockingCertifications. Verifies we didn't regress the legacy
    // warn-only branch when adding blocking enforcement.
    const crew = [{ id: 601, userId: 100, firstName: "Pat", lastName: "Lee" }];
    const certs = [
      { employeeId: 601, name: "H2S", expirationDate: FUTURE_EXP },
    ];
    selectQueue = queueForAdmin({
      crew,
      certs,
      workType: {
        name: "Hot Oil",
        requiredCertifications: ["H2S", "OSHA-10"],
        blockingCertifications: null,
      },
    });

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        scheduledDurationMinutes: 120,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expectStatus(r, 200);
    expect(r.body.ok).toBe(true);
    expect(Array.isArray(r.body.certWarnings)).toBe(true);
    expect(r.body.certWarnings).toHaveLength(1);
    expect(r.body.certWarnings[0].missing).toEqual(["OSHA-10"]);
    // Crucially: no override row was written for the warn-only path.
    expect(auditInsertCalls).toHaveLength(0);
  });

  it("blocks the schedule (admin, no override flag) with canOverride=true", async () => {
    // Same crew + certs as the warn case, but the missing cert is now
    // listed in blockingCertifications. The schedule must NOT save —
    // we expect 400 with the structured payload the modal renders as
    // an inline blocking banner.
    const crew = [{ id: 601, userId: 100, firstName: "Pat", lastName: "Lee" }];
    const certs = [
      { employeeId: 601, name: "OSHA-10", expirationDate: FUTURE_EXP },
    ];
    selectQueue = queueForAdmin({
      crew,
      certs,
      workType: {
        name: "Hot Oil",
        requiredCertifications: null,
        blockingCertifications: ["H2S"],
      },
    });

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        crewEmployeeIds: crew.map((c) => c.id),
      });

    expect(r.status).toBe(400);
    expect(r.body.error).toBe("certifications_blocked");
    expect(r.body.code).toBe("schedule.certifications_blocked");
    expect(r.body.canOverride).toBe(true);
    expect(r.body.blockingCertifications).toEqual(["H2S"]);
    expect(r.body.blockingMissing).toEqual([
      { employeeId: 601, employeeName: "Pat Lee", missing: ["H2S"] },
    ]);
    // No audit row written when the schedule was rejected.
    expect(auditInsertCalls).toHaveLength(0);
  });

  it("blocks the schedule (vendor admin) with canOverride=false", async () => {
    // Vendor admins can schedule normally but cannot bypass blocking
    // certs — the override path is platform-admin-only. We assert the
    // 400 still fires AND `canOverride` is false so the modal hides
    // the override button.
    const crew = [{ id: 601, userId: 100, firstName: "Pat", lastName: "Lee" }];
    const certs: Array<{ employeeId: number; name: string; expirationDate: string }> = [];
    selectQueue = queueForVendorAdmin({
      crew,
      certs,
      workType: {
        name: "Hot Oil",
        requiredCertifications: null,
        blockingCertifications: ["H2S"],
      },
    });

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", vendorAdminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        crewEmployeeIds: crew.map((c) => c.id),
        // Even sending the override flag from a non-admin must NOT
        // bypass the check. This is the security-critical assertion:
        // we deliberately set the flag to prove the server still
        // rejects it.
        overrideBlockingCerts: true,
      });

    expect(r.status).toBe(400);
    expect(r.body.error).toBe("certifications_blocked");
    expect(r.body.canOverride).toBe(false);
    expect(auditInsertCalls).toHaveLength(0);
  });

  it("admin override: schedule saves and one audit row is written", async () => {
    // Platform admin re-POSTs with `overrideBlockingCerts: true`. We
    // expect: 200, schedule saves, and exactly one row inserted into
    // scheduleCertOverrideAuditLog with the missing-by-employee
    // snapshot pinned at the time of override.
    const crew = [{ id: 601, userId: 100, firstName: "Pat", lastName: "Lee" }];
    const certs: Array<{ employeeId: number; name: string; expirationDate: string }> = [];
    selectQueue = queueForAdmin({
      crew,
      certs,
      workType: {
        name: "Hot Oil",
        requiredCertifications: null,
        blockingCertifications: ["H2S", "OSHA-10"],
      },
    });

    const r = await request(app)
      .post(`/api/tickets/${TICKET_ID}/schedule`)
      .set("Cookie", adminCookie)
      .send({
        scheduledStartAt: SCHEDULED_AT,
        crewEmployeeIds: crew.map((c) => c.id),
        overrideBlockingCerts: true,
      });

    expectStatus(r, 200);
    expect(r.body.ok).toBe(true);
    expect(auditInsertCalls).toHaveLength(1);
    const audit = auditInsertCalls[0];
    expect(audit.ticketId).toBe(TICKET_ID);
    expect(audit.actorUserId).toBe(ADMIN_USER_ID);
    expect(audit.actorRole).toBe("admin");
    expect(audit.blockingCertifications).toEqual(["H2S", "OSHA-10"]);
    expect(audit.missingByEmployee).toEqual([
      { employeeId: 601, employeeName: "Pat Lee", missing: ["H2S", "OSHA-10"] },
    ]);
  });
});
