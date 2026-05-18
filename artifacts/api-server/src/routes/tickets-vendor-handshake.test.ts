import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import { makeTicketRow } from "../test-utils/ticket-row";

import { radiusMilesBetween } from "../lib/geo";
import {
  computeInitialStatus,
  REINVITE_ELIGIBLE_STATUSES,
} from "../lib/intake-status";

// Coverage for Task #494 (vendor accept/deny + alternate-vendor picker):
//   * radiusMilesBetween haversine math
//   * authz on POST /tickets/:id/{accept,deny,reinvite} and
//     GET /tickets/:id/nearby-vendors
//   * status-precondition guards on accept/deny/reinvite
//   * deny reason validation
//
// Full happy-path round-trip + DB transitions are covered by the e2e suite —
// this file mocks the DB layer so we can exercise the route guards in
// isolation without standing up Postgres.


const cookieFor = (s: object) => buildTestCookie(s);

// ── Per-test mutable rows the chained-mock DB returns ──
let ticketRow: any = null;
let vendorRow: any = null;
let assignmentRow: any = null;
let siteRow: any = null;
let nearbyVendorRows: any[] = [];
let workTypeCoverageRows: any[] = [];
let workTypeRows: any[] = [];
let updatedRow: any = null;

// Each .from(table) is matched by name so we can return different rows for
// each query in the same handler.
function makeChain(rows: any) {
  const chain: any = {
    from: (_t: any) => chain,
    leftJoin: () => chain,
    innerJoin: () => chain,
    where: () => Promise.resolve(rows),
    orderBy: () => Promise.resolve(rows),
    limit: () => Promise.resolve(rows),
  };
  // .where can be chained (no await) when followed by .orderBy/limit — we wrap
  // with a thenable so `await db.select().from().where()` resolves to rows
  // while `.orderBy(...)` after `.where(...)` still works.
  chain.where = (_w: any) => {
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

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  let selectStep = 0;
  const db: any = {
    select: (_cols?: any) => {
      // Per-handler queries return different rows in fixed order. The order
      // here mirrors the read order in the new endpoints in tickets.ts.
      const seq = [
        // slot 0: ensureFieldOwnership ticket lookup (check-in/cancel) OR
        // accept/deny initial existing-row read.
        () => makeChain([ticketRow].filter(Boolean)),
        // slot 1: check-in pre-flight siteForGeofence join (Task #145) OR
        // accept/deny post-tx siteRow (partnerId lookup). Same `siteRow`
        // mutable powers both — for geofence the destructure pulls
        // `latitude`/`longitude`/`siteRadiusMeters` (undefined on the
        // accept/deny shape, which makes `distanceMeters(...)` NaN and
        // therefore harmless: `NaN > radius` is false so the rejection
        // is skipped and the route falls through to its real status
        // guard, which is what the existing tests assert.
        () => makeChain([siteRow].filter(Boolean)),
        // slot 2: check-in in-transaction existing-row read (status +
        // arrivedAt). The handshake-status tests reuse the same `row`
        // for ticketRow + siteRow, so returning ticketRow here lets the
        // in-tx CHECK_IN_ALLOWED guard see the right `status`.
        () => makeChain([ticketRow].filter(Boolean)),
        // additional safety reads
        () => makeChain([]),
      ];
      const fn = seq[Math.min(selectStep, seq.length - 1)] ?? (() => makeChain([]));
      selectStep += 1;
      return fn();
    },
    insert: () => ({
      values: () => ({ returning: () => Promise.resolve([{ id: 1 }]) }),
    }),
    update: () => ({
      set: () => ({
        where: () => ({
          returning: () => Promise.resolve(updatedRow ? [updatedRow] : []),
        }),
      }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (fn: any) => fn(db),
  };
  // Expose a way for tests to reset the per-call counter.
  (db as any).__resetSelectStep = () => {
    selectStep = 0;
  };
  return {
    db,
    pool: { query: async () => ({ rows: [] }) },
    ticketsTable: tableTag("tickets"),
    siteLocationsTable: tableTag("siteLocations"),
    vendorsTable: tableTag("vendors"),
    workTypesTable: tableTag("workTypes"),
    fieldEmployeesTable: tableTag("fieldEmployees"),
    partnersTable: tableTag("partners"),
    gpsLogsTable: tableTag("gpsLogs"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
    ticketUnlocksTable: tableTag("ticketUnlocks"),
    ticketLineItemsTable: tableTag("ticketLineItems"),
    taxRatesTable: tableTag("taxRates"),
    usersTable: tableTag("users"),
    vendorPeopleTable: tableTag("vendorPeople"),
    ticketCheckInsTable: tableTag("ticketCheckIns"),
    siteWorkAssignmentsTable: tableTag("siteWorkAssignments"),
    partnerVendorRelationshipsTable: tableTag("partnerVendorRelationships"),
    vendorWorkTypesTable: tableTag("vendorWorkTypes"),
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
  };
});

vi.mock("./notifications", () => ({
  notifyUsers: vi.fn(async () => undefined),
  findVendorUserIds: vi.fn(async () => [] as number[]),
  findPartnerUserIds: vi.fn(async () => [] as number[]),
}));

vi.mock("../lib/expo-push", () => ({
  sendPushToFieldEmployee: vi.fn(async () => undefined),
}));

vi.mock("../lib/invoice-generator", () => ({
  enqueueInvoiceGenerationForTicket: vi.fn(async () => undefined),
}));

vi.mock("../lib/ticket-transitions", () => ({
  recordTicketTransition: vi.fn(async () => undefined),
}));

let app: express.Express;

beforeEach(async () => {
  ticketRow = null;
  vendorRow = null;
  assignmentRow = null;
  siteRow = null;
  nearbyVendorRows = [];
  workTypeCoverageRows = [];
  workTypeRows = [];
  updatedRow = null;
  vi.resetModules();
  const router = (await import("./tickets")).default;
  const db = (await import("@workspace/db")).db as any;
  if (typeof db.__resetSelectStep === "function") db.__resetSelectStep();
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("radiusMilesBetween (haversine)", () => {
  it("returns ~0 for the same point", () => {
    expect(radiusMilesBetween(40.0, -74.0, 40.0, -74.0)).toBeLessThan(0.001);
  });

  it("returns ~3 mi for ~3 mi north–south offset (1° lat ≈ 69 mi)", () => {
    // 0.0435° lat ≈ 3 mi
    const d = radiusMilesBetween(40.0, -74.0, 40.0435, -74.0);
    expect(d).toBeGreaterThan(2.9);
    expect(d).toBeLessThan(3.1);
  });

  it("returns symmetric distance regardless of point order", () => {
    const a = radiusMilesBetween(34.05, -118.24, 36.16, -115.15); // LA → LV ≈ 228 mi
    const b = radiusMilesBetween(36.16, -115.15, 34.05, -118.24);
    expect(Math.abs(a - b)).toBeLessThan(0.0001);
    expect(a).toBeGreaterThan(220);
    expect(a).toBeLessThan(240);
  });
});

describe("POST /tickets/:id/accept — authz + status guards", () => {
  it("returns 401 with no session cookie", async () => {
    const res = await request(app).post("/api/tickets/123/accept").send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("returns 403 when caller is not the invited vendor org", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "awaiting_acceptance", vendorId: 7 });
    const res = await request(app)
      .post("/api/tickets/123/accept")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 999, partnerId: null }))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket.forbidden_not_invited_vendor");
    expect(res.body.error).toBe("forbidden_not_invited_vendor");
  });

  it("returns 409 when ticket is not awaiting_acceptance", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "in_progress", vendorId: 7 });
    const res = await request(app)
      .post("/api/tickets/123/accept")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ticket.not_awaiting_acceptance");
    expect(res.body.error).toBe("ticket_not_awaiting_acceptance");
  });

  it("returns 404 when the ticket id does not exist", async () => {
    ticketRow = null;
    const res = await request(app)
      .post("/api/tickets/999/accept")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }))
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("ticket_not_found");
    expect(res.body.code).toBe("ticket.not_found");
  });
});

describe("POST /tickets/:id/deny — reason validation + authz", () => {
  it("returns 400 when reason is missing", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "awaiting_acceptance", vendorId: 7 });
    const res = await request(app)
      .post("/api/tickets/123/deny")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.deny_reason_required");
    expect(res.body.error).toBe("deny_reason_required");
  });

  it("returns 400 when reason exceeds 500 characters", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "awaiting_acceptance", vendorId: 7 });
    const res = await request(app)
      .post("/api/tickets/123/deny")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }))
      .send({ reason: "x".repeat(501) });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.deny_reason_too_long");
    expect(res.body.error).toBe("deny_reason_too_long");
  });

  it("returns 403 when caller is not the invited vendor", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "awaiting_acceptance", vendorId: 7 });
    const res = await request(app)
      .post("/api/tickets/123/deny")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 999, partnerId: null }))
      .send({ reason: "Out of capacity" });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket.forbidden_not_invited_vendor");
    expect(res.body.error).toBe("forbidden_not_invited_vendor");
  });

  it("returns 409 when ticket has already moved past awaiting_acceptance", async () => {
    ticketRow = makeTicketRow({ id: 123, status: "denied", vendorId: 7 });
    const res = await request(app)
      .post("/api/tickets/123/deny")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }))
      .send({ reason: "Out of capacity" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ticket.not_awaiting_acceptance");
    expect(res.body.error).toBe("ticket_not_awaiting_acceptance");
  });
});

describe("POST /tickets/:id/reinvite — partner authz + status guards", () => {
  it("returns 400 when vendorId body field is missing", async () => {
    ticketRow = makeTicketRow({
      id: 123,
      status: "denied",
      vendorId: 7,
      siteLocationId: 11,
      workTypeId: 22,
      partnerId: 5,
    });
    const res = await request(app)
      .post("/api/tickets/123/reinvite")
      .set("Cookie", cookieFor({ userId: 1, role: "partner", vendorId: null, partnerId: 5 }))
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("ticket.vendor_id_required");
    expect(res.body.error).toBe("vendor_id_required");
  });

  it("returns 403 when caller is a different partner", async () => {
    ticketRow = makeTicketRow({
      id: 123,
      status: "denied",
      vendorId: 7,
      siteLocationId: 11,
      workTypeId: 22,
      partnerId: 5,
    });
    const res = await request(app)
      .post("/api/tickets/123/reinvite")
      .set("Cookie", cookieFor({ userId: 1, role: "partner", vendorId: null, partnerId: 999 }))
      .send({ vendorId: 42 });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket.forbidden_not_owning_partner");
    expect(res.body.error).toBe("forbidden_not_owning_partner");
  });

  it("returns 409 ticket_not_reinvitable when status is in_progress", async () => {
    // Once the vendor has actually checked in (status flips to in_progress),
    // the partner must cancel before reassigning. /reinvite is rejected.
    ticketRow = makeTicketRow({
      id: 124,
      status: "in_progress",
      vendorId: 7,
      siteLocationId: 11,
      workTypeId: 22,
      partnerId: 5,
    });
    const res = await request(app)
      .post("/api/tickets/124/reinvite")
      .set("Cookie", cookieFor({ userId: 1, role: "partner", vendorId: null, partnerId: 5 }))
      .send({ vendorId: 42 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ticket.not_reinvitable");
    expect(res.body.error).toBe("ticket_not_reinvitable");
  });

  it("accepts reinvite from initiated (vendor accepted but not checked in)", async () => {
    // Per task spec, partner can reassign any time before in_progress.
    // initiated means the vendor accepted but has not yet checked in, so the
    // status guard MUST allow this — the route may still 404 later when the
    // vendor lookup runs against the empty mock, which is acceptable; what
    // we're proving is that the status precondition does not reject.
    ticketRow = makeTicketRow({
      id: 125,
      status: "initiated",
      vendorId: 7,
      siteLocationId: 11,
      workTypeId: 22,
      partnerId: 5,
    });
    const res = await request(app)
      .post("/api/tickets/125/reinvite")
      .set("Cookie", cookieFor({ userId: 1, role: "partner", vendorId: null, partnerId: 5 }))
      .send({ vendorId: 42 });
    // Must NOT be 409 ticket_not_reinvitable — that would mean the policy
    // is still locked to {awaiting_acceptance, denied}.
    expect(res.body.error).not.toBe("ticket_not_reinvitable");
  });
});

describe("GET /tickets/:id/nearby-vendors — partner authz", () => {
  it("returns 401 without a session", async () => {
    const res = await request(app).get("/api/tickets/123/nearby-vendors");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("returns 403 when caller is a vendor (not the owning partner)", async () => {
    ticketRow = makeTicketRow({
      id: 123,
      vendorId: 7,
      workTypeId: 22,
      siteLatitude: 40.0,
      siteLongitude: -74.0,
      partnerId: 5,
    });
    const res = await request(app)
      .get("/api/tickets/123/nearby-vendors")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("ticket.forbidden_not_owning_partner");
    expect(res.body.error).toBe("forbidden_not_owning_partner");
  });
});

describe("computeInitialStatus — POST /tickets default-status branching", () => {
  // The branching rule lives in lib/intake-status.ts (a pure function) so
  // we can test it directly instead of mocking the entire POST /tickets
  // read chain (siteLocations, siteWorkAssignments, ticketQuery joins, etc).
  // The route handler at tickets.ts ~L656 is now a one-liner that calls
  // computeInitialStatus, so the rule and its tests are co-located.
  it("partner_self_service intake lands on awaiting_acceptance", () => {
    expect(computeInitialStatus("partner_self_service", false)).toBe("awaiting_acceptance");
  });

  it("partner_self_service ignores auto-check-in (gate must hold)", () => {
    // Even if the upstream auto-check-in flag is somehow true, partner
    // self-service must still go through the vendor accept gate.
    expect(computeInitialStatus("partner_self_service", true)).toBe("awaiting_acceptance");
  });

  // Task #498: by default, an office-operator opening a ticket the partner
  // phoned in still bounces through the vendor accept gate so the field
  // crew gets the standard handshake. The acceptanceImplicit flag is the
  // explicit "partner already coordinated" escape hatch.
  it("office_on_behalf_of_partner without acceptanceImplicit goes through accept gate", () => {
    expect(computeInitialStatus("office_on_behalf_of_partner", false, false)).toBe("awaiting_acceptance");
    expect(computeInitialStatus("office_on_behalf_of_partner", true, false)).toBe("awaiting_acceptance");
  });

  it("office_on_behalf_of_partner with acceptanceImplicit skips accept gate", () => {
    expect(computeInitialStatus("office_on_behalf_of_partner", false, true)).toBe("initiated");
    expect(computeInitialStatus("office_on_behalf_of_partner", true, true)).toBe("in_progress");
  });

  // Task #498: a field employee phoning the office to (re)start a ticket
  // means the crew is already coordinating the work in person — there's no
  // accept gate and no geofence requirement. Both with and without an
  // auto-check-in hint, the ticket lands directly in_progress.
  it("office_on_behalf_of_field_employee without check-in still goes in_progress", () => {
    expect(computeInitialStatus("office_on_behalf_of_field_employee", false)).toBe("in_progress");
  });

  it("office_on_behalf_of_field_employee with check-in stays in_progress", () => {
    expect(computeInitialStatus("office_on_behalf_of_field_employee", true)).toBe("in_progress");
  });
});

describe("REINVITE_ELIGIBLE_STATUSES policy", () => {
  // The owning partner must be able to swap vendors at any point before
  // work actually starts (vendor check-in → in_progress).
  it("includes pre-acceptance and pre-check-in states", () => {
    expect(REINVITE_ELIGIBLE_STATUSES.has("awaiting_acceptance")).toBe(true);
    expect(REINVITE_ELIGIBLE_STATUSES.has("denied")).toBe(true);
    expect(REINVITE_ELIGIBLE_STATUSES.has("initiated")).toBe(true);
  });

  it("excludes states where field work has begun or finished", () => {
    expect(REINVITE_ELIGIBLE_STATUSES.has("in_progress")).toBe(false);
    expect(REINVITE_ELIGIBLE_STATUSES.has("pending_review")).toBe(false);
    expect(REINVITE_ELIGIBLE_STATUSES.has("approved")).toBe(false);
    expect(REINVITE_ELIGIBLE_STATUSES.has("kicked_back")).toBe(false);
    expect(REINVITE_ELIGIBLE_STATUSES.has("cancelled")).toBe(false);
  });
});

// ── Bypass-prevention coverage from architect review ────────────────────────
// The vendor-acknowledgment gate must hold against the two known shortcuts:
//   1) POST /tickets/:id/check-in cannot transition awaiting_acceptance →
//      in_progress directly (would bypass Accept).
//   2) Compare-and-swap on accept/deny ensures stale writes return 409 when
//      the partner has reinvited a different vendor between read and write.
describe("POST /tickets/:id/check-in — Task #494 status guard", () => {
  it("returns 409 when ticket is awaiting_acceptance (must Accept first)", async () => {
    // ensureFieldOwnership reads first (slot 0): needs vendorId/partnerId.
    // The check-in route then re-reads (slot 1: siteRow) for arrivedAt+status.
    // We mirror the row data on both rows so both reads see the same ticket.
    const row = {
      id: 555,
      status: "awaiting_acceptance",
      vendorId: 7,
      partnerId: 5,
      fieldEmployeeId: null,
      arrivedAt: null,
    };
    ticketRow = row;
    siteRow = row;
    const res = await request(app)
      .post("/api/tickets/555/check-in")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }))
      .send({ latitude: 40.0, longitude: -74.0 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ticket.not_checkinable");
    expect(res.body.error).toBe("ticket_not_checkinable");
  });

  it("returns 409 when ticket is denied", async () => {
    const row = {
      id: 556,
      status: "denied",
      vendorId: 7,
      partnerId: 5,
      fieldEmployeeId: null,
      arrivedAt: null,
    };
    ticketRow = row;
    siteRow = row;
    const res = await request(app)
      .post("/api/tickets/556/check-in")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }))
      .send({ latitude: 40.0, longitude: -74.0 });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ticket.not_checkinable");
    expect(res.body.error).toBe("ticket_not_checkinable");
  });
});

describe("POST /tickets/:id/cancel — Task #494 pre-accept guard", () => {
  // /cancel must reject vendor and field_employee actors when status is
  // awaiting_acceptance or denied — they have to go through /deny instead.
  // Only partner (the inviter) and admin may cancel a pre-accept ticket.
  it("returns 409 when a vendor tries to cancel an awaiting_acceptance ticket", async () => {
    const row = {
      id: 800,
      status: "awaiting_acceptance",
      vendorId: 7,
      partnerId: 5,
      fieldEmployeeId: null,
    };
    ticketRow = row;
    siteRow = row;
    const res = await request(app)
      .post("/api/tickets/800/cancel")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }));
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ticket.not_accepted");
    expect(res.body.error).toBe("ticket_not_accepted");
  });

  it("returns 409 when a field_employee tries to cancel a denied ticket", async () => {
    const row = {
      id: 801,
      status: "denied",
      vendorId: 7,
      partnerId: 5,
      fieldEmployeeId: 42,
    };
    ticketRow = row;
    siteRow = row;
    const res = await request(app)
      .post("/api/tickets/801/cancel")
      .set("Cookie", cookieFor({ userId: 1, role: "field_employee", vendorId: 7, fieldEmployeeId: 42, partnerId: null }));
    // Either 403 (ensureFieldOwnership rejects) or 409 (pre-accept guard) is
    // acceptable — both prevent the bypass. We assert it's NOT a 200.
    expect([403, 409]).toContain(res.status);
  });
});

describe("Compare-and-swap on accept/deny", () => {
  // Route reads the row, checks status, then issues UPDATE pinned to the
  // observed status + vendorId. With updatedRow=null (default), the mock's
  // `.returning()` resolves to [], simulating "0 rows affected" = a stale
  // CAS. Route must respond 409 instead of 200 or 5xx.
  it("accept returns 409 when CAS update affects 0 rows (vendor reinvited mid-flight)", async () => {
    ticketRow = makeTicketRow({ id: 700, status: "awaiting_acceptance", vendorId: 7 });
    // updatedRow stays null from beforeEach → mock returns [] from update
    const res = await request(app)
      .post("/api/tickets/700/accept")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }))
      .send({});
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ticket.state_changed");
    expect(res.body.error).toBe("ticket_state_changed");
  });

  it("deny returns 409 when CAS update affects 0 rows", async () => {
    ticketRow = makeTicketRow({ id: 701, status: "awaiting_acceptance", vendorId: 7 });
    const res = await request(app)
      .post("/api/tickets/701/deny")
      .set("Cookie", cookieFor({ userId: 1, role: "vendor", vendorId: 7, partnerId: null }))
      .send({ reason: "no capacity" });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("ticket.state_changed");
    expect(res.body.error).toBe("ticket_state_changed");
  });
});
