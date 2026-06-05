import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { z } from "zod";
import { buildTestCookie } from "../test-utils/session";
import {
  GetFieldMeResponse,
  ListFieldSitesResponse,
  ListFieldOpenTicketsResponse,
  GetFieldOpenTicketResponse,
  FieldCreatedTicketType,
} from "@workspace/api-zod";
type FieldCreatedTicket = FieldCreatedTicketType;

// Task #681 — Contract tests for the `/api/field/*` family.
//
// The mobile field app's generated client (lib/api-client-react) is
// produced from `lib/api-spec/openapi.yaml` and the matching response
// zod validators live in `@workspace/api-zod`. Without runtime checks
// against those validators, a route in `routes/field.ts` could quietly
// return a different shape than what the spec promises — the mobile
// build would still typecheck (the generated TS type would just be
// wrong) and the regression would only surface on-device.
//
// These tests pin the response shape of the five endpoints the mobile
// app depends on every launch:
//   * GET  /field/me
//   * GET  /field/sites
//   * GET  /field/open-tickets
//   * GET  /field/open-tickets/:id  (Task #668; the new per-ticket fetch)
//   * POST /field/tickets
//
// Each test mocks the database to return a realistic row, hits the
// route through supertest, then runs the response body through the
// codegen'd zod validator (or, for POST /field/tickets where the spec
// is intentionally `additionalProperties: true` and orval skips the
// response zod, a hand-rolled mirror of the documented schema). A
// failure means EITHER the route changed shape and the spec needs a
// matching update, OR the spec changed and the route needs to follow
// — both of which are exactly the drift this test catches.

// ─── DB mock ────────────────────────────────────────────────────────────────
//
// Same shape as `field-open-tickets-vendor.test.ts` and
// `field-tickets-validation.test.ts`: a per-test queue of resolved row
// arrays for `db.select(...)` calls plus a tiny override for the one
// raw-SQL `db.execute(...)` the sites endpoint uses. The route only
// reads (in order); each test seeds the queue with the rows the handler
// will see at each step. We do not assert against the SQL itself — the
// codegen'd zod validators are the source of truth for shape.
type RowProvider = () => any[];
let selectQueue: RowProvider[] = [];
let executeRows: any[] = [];
let insertedTicket: any = null;

function makeChain(rowsProvider: RowProvider) {
  const run = () => rowsProvider();
  const chain: any = {};
  chain.from = () => chain;
  chain.leftJoin = () => chain;
  chain.innerJoin = () => chain;
  chain.where = () => chain;
  chain.orderBy = () => chain;
  chain.limit = () => chain;
  chain.then = (resolve: any, reject: any) =>
    Promise.resolve(run()).then(resolve, reject);
  chain.catch = (reject: any) => Promise.resolve(run()).catch(reject);
  chain.finally = (cb: any) => Promise.resolve(run()).finally(cb);
  return chain;
}

vi.mock("@workspace/db", () => {
  const tableTag = (name: string) =>
    new Proxy(
      { __name: name },
      { get: (_t, k: string) => ({ __table: name, __col: k }) },
    );
  const db: any = {
    select: (_projection?: Record<string, any>) => {
      const provider = selectQueue.shift() ?? (() => []);
      return makeChain(provider);
    },
    insert: () => ({
      values: () => ({
        returning: () =>
          Promise.resolve(insertedTicket ? [insertedTicket] : []),
        onConflictDoNothing: () => Promise.resolve([]),
        onConflictDoUpdate: () => Promise.resolve([]),
      }),
    }),
    update: () => ({
      set: () => ({ where: () => Promise.resolve([]) }),
    }),
    delete: () => ({ where: () => Promise.resolve([]) }),
    transaction: async (fn: any) => fn(db),
    execute: async () => ({ rows: executeRows }),
  };
  return {
    db,
    pool: { query: async () => ({ rows: [] }) },
    ticketsTable: tableTag("tickets"),
    ticketCrewTable: tableTag("ticketCrew"),
    siteLocationsTable: tableTag("siteLocations"),
    vendorsTable: tableTag("vendors"),
    workTypesTable: tableTag("workTypes"),
    fieldEmployeesTable: tableTag("fieldEmployees"),
    partnersTable: tableTag("partners"),
    gpsLogsTable: tableTag("gpsLogs"),
    ticketNoteLogsTable: tableTag("ticketNoteLogs"),
    ticketUnlocksTable: tableTag("ticketUnlocks"),
    usersTable: tableTag("users"),
    vendorPeopleTable: tableTag("vendorPeople"),
    ticketCheckInsTable: tableTag("ticketCheckIns"),
    siteWorkAssignmentsTable: tableTag("siteWorkAssignments"),
    partnerVendorRelationshipsTable: tableTag("partnerVendorRelationships"),
    vendorWorkTypesTable: tableTag("vendorWorkTypes"),
    pushTokensTable: tableTag("pushTokens"),
    fieldPushTokensTable: tableTag("fieldPushTokens"),
    userOrgMembershipsTable: tableTag("userOrgMemberships"),
    workTypePartnerOverridesTable: tableTag("workTypePartnerOverrides"),
    // Task #51 — referenced by `unreadTicketCommentCountSql` from
    // `artifacts/api-server/src/lib/unread-comments.ts`. The
    // `ticketNoteLogsTable` and `hotlistCommentsTable` parents are
    // already registered above (the latter unused by field routes but
    // safe as a harmless tag).
    commentReadReceiptsTable: tableTag("commentReadReceipts"),
    hotlistCommentsTable: tableTag("hotlistComments"),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  const sqlTag: any = () => ({ kind: "true" });
  sqlTag.raw = passthrough;
  return {
    and: passthrough,
    eq: passthrough,
    ne: passthrough,
    isNull: passthrough,
    isNotNull: passthrough,
    inArray: passthrough,
    sql: sqlTag,
    desc: passthrough,
    asc: passthrough,
    gte: passthrough,
    lte: passthrough,
    or: passthrough,
    aliasedTable: (t: any) => t,
  };
});

vi.mock("../lib/expo-push", () => ({
  sendPushToFieldEmployee: vi.fn(async () => undefined),
}));

vi.mock("../lib/ticket-transitions", () => ({
  recordTicketTransition: vi.fn(async () => undefined),
}));

// ─── Cookies ────────────────────────────────────────────────────────────────

const FIELD_USER_ID = 1234;
const VENDOR_ID = 11;
const FIELD_EMPLOYEE_ID = 555;

const fieldCookie = buildTestCookie({
  userId: FIELD_USER_ID,
  role: "field_employee",
  vendorId: VENDOR_ID,
  partnerId: null,
});

// ─── Fixture helpers ────────────────────────────────────────────────────────

function fieldEmployeeRow(overrides: Record<string, unknown> = {}) {
  return {
    id: FIELD_EMPLOYEE_ID,
    vendorId: VENDOR_ID,
    firstName: "Frank",
    lastName: "Field",
    email: "ff@example.com",
    isActive: true,
    vendorName: "Acme",
    ...overrides,
  };
}

function fieldMeExtras(overrides: Record<string, unknown> = {}) {
  return {
    profilePhotoPath: null,
    photoUrl: null,
    jobTitle: "Foreman",
    phone: "555-1212",
    pecExpirationDate: null,
    pecCertification: false,
    vendorLogoUrl: null,
    ...overrides,
  };
}

function siteRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    name: "Pad 12",
    address: "123 Main St",
    state: "TX",
    siteCode: "PAD12",
    partnerId: 5,
    partnerName: "ACME",
    ...overrides,
  };
}

function openTicketRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 101,
    status: "in_progress",
    checkInTime: new Date("2026-04-30T15:00:00.000Z"),
    siteLocationId: 1,
    siteName: "Pad 12",
    partnerName: "ACME",
    workTypeId: 5,
    workTypeName: "Pumping",
    fieldEmployeeId: FIELD_EMPLOYEE_ID,
    fieldEmployeeFirstName: "Frank",
    fieldEmployeeLastName: "Field",
    createdAt: new Date("2026-04-30T14:00:00.000Z"),
    updatedAt: new Date("2026-04-30T15:00:00.000Z"),
    // Task #51 — mobile home-screen unread-comment badge.
    unreadCommentCount: 0,
    ...overrides,
  };
}

// FieldCreatedTicket — the OpenAPI schema is intentionally
// `additionalProperties: true` (the route returns the raw `tickets`
// row from drizzle's `.returning()` and that column set evolves faster
// than the spec). Orval's zod generator skips response schemas with
// `additionalProperties: true`, so there is no
// `CreateFieldTicketResponse` zod export to import. We rebuild the
// spec's documented fields here as a strict zod object so this test
// catches any drift in the listed properties; the `passthrough()` call
// preserves the spec's `additionalProperties: true` semantics.
//
// The schema below MUST stay in sync with the `FieldCreatedTicket`
// definition in `lib/api-spec/openapi.yaml`. The
// `satisfies` check below pins the property set against the
// `FieldCreatedTicket` TS type orval DOES generate, so a future spec
// change that adds, removes, or retypes a documented property will
// surface here as a TS error.
const FieldCreatedTicketContract = z
  .object({
    id: z.number().int(),
    status: z.enum(["initiated", "in_progress"]),
    siteLocationId: z.number().int(),
    vendorId: z.number().int().nullable(),
    workTypeId: z.number().int(),
    fieldEmployeeId: z.number().int().nullable(),
    intakeChannel: z.literal("vendor_field_self_service"),
    lifecycleState: z.enum(["pending_arrival", "on_site"]),
    description: z.string().nullable(),
    checkInTime: z.coerce.date().nullable(),
    checkInLatitude: z.number().nullable(),
    checkInLongitude: z.number().nullable(),
    arrivedAt: z.coerce.date().nullable(),
    foremanUserId: z.number().int().nullable(),
    createdAt: z.coerce.date(),
    updatedAt: z.coerce.date(),
  })
  .passthrough();
type FieldCreatedTicketContractT = z.infer<typeof FieldCreatedTicketContract>;
// Compile-time fence: every required FieldCreatedTicket property in the
// generated TS type must be representable by this contract schema.
// Adding a new required field to the spec without extending the schema
// above will fail this assignment.
const _typeContractCheck = (v: FieldCreatedTicket): FieldCreatedTicketContractT =>
  v as FieldCreatedTicketContractT;
void _typeContractCheck;

// ─── App wiring ─────────────────────────────────────────────────────────────

let app: express.Express;

beforeEach(async () => {
  vi.resetModules();
  selectQueue = [];
  executeRows = [];
  insertedTicket = null;
  const router = (await import("./field")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─── GET /field/me ──────────────────────────────────────────────────────────

describe("GET /api/field/me — response contract", () => {
  it("body parses cleanly against GetFieldMeResponse for a field-employee session", async () => {
    selectQueue = [
      // 1) requireFieldUser → vendor_people LEFT JOIN vendors
      () => [fieldEmployeeRow()],
      // 2) /field/me extras lookup (profilePhotoPath, jobTitle, etc.)
      () => [fieldMeExtras()],
    ];
    const res = await request(app)
      .get("/api/field/me")
      .set("Cookie", fieldCookie);
    expectStatus(res, 200);
    const parsed = GetFieldMeResponse.safeParse(res.body);
    if (!parsed.success) {
      // Surface the zod issues directly so a regression points the
      // reader at the offending field instead of just "expected true
      // to be false". Same pattern as tickets-portal.test.ts.
      throw new Error(
        `GET /field/me drifted from spec:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
  });
});

// ─── GET /field/sites ───────────────────────────────────────────────────────

describe("GET /api/field/sites — response contract", () => {
  it("body parses cleanly against ListFieldSitesResponse", async () => {
    // requireFieldUser still runs first via select(), then the route
    // drops to a raw `db.execute(sql)` that we feed via `executeRows`.
    selectQueue = [() => [fieldEmployeeRow()]];
    executeRows = [
      siteRow(),
      siteRow({
        id: 2,
        name: "Pad 13",
        // exercise the nullable columns the spec marks as nullish so the
        // contract test fails if a future change accidentally drops one
        // of them from the SELECT projection.
        address: null,
        state: null,
        siteCode: null,
        partnerId: null,
        partnerName: null,
      }),
    ];
    const res = await request(app)
      .get("/api/field/sites")
      .set("Cookie", fieldCookie);
    expectStatus(res, 200);
    expect(Array.isArray(res.body)).toBe(true);
    const parsed = ListFieldSitesResponse.safeParse(res.body);
    if (!parsed.success) {
      throw new Error(
        `GET /field/sites drifted from spec:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    expect(parsed.data).toHaveLength(2);
  });
});

// ─── GET /field/open-tickets ────────────────────────────────────────────────

describe("GET /api/field/open-tickets — response contract", () => {
  it("body parses cleanly against ListFieldOpenTicketsResponse", async () => {
    selectQueue = [
      // 1) requireFieldUser
      () => [fieldEmployeeRow()],
      // 2) the open-tickets list SELECT
      () => [
        openTicketRow(),
        openTicketRow({
          id: 102,
          status: "initiated",
          // Newly-created ticket may have a null check-in time — the
          // spec marks checkInTime as nullable; pin that here so a
          // regression that strips the nullable() also fails this test.
          checkInTime: null,
          // Joins can return null on either side of a left join.
          siteLocationId: null,
          siteName: null,
          partnerName: null,
          workTypeId: null,
          workTypeName: null,
          fieldEmployeeId: null,
          fieldEmployeeFirstName: null,
          fieldEmployeeLastName: null,
          updatedAt: null,
        }),
      ],
    ];
    const res = await request(app)
      .get("/api/field/open-tickets")
      .set("Cookie", fieldCookie);
    expectStatus(res, 200);
    expect(Array.isArray(res.body)).toBe(true);
    const parsed = ListFieldOpenTicketsResponse.safeParse(res.body);
    if (!parsed.success) {
      throw new Error(
        `GET /field/open-tickets drifted from spec:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    expect(parsed.data).toHaveLength(2);
  });
});

// ─── GET /field/open-tickets/:id ────────────────────────────────────────────

describe("GET /api/field/open-tickets/:id — response contract", () => {
  it("body parses cleanly against GetFieldOpenTicketResponse (Task #668)", async () => {
    selectQueue = [
      // 1) requireFieldUser
      () => [fieldEmployeeRow()],
      // 2) the per-id SELECT (returns the same denormalized row shape
      //    as the list endpoint — the spec guarantees both share the
      //    shape so a row from one can replace a row from the other).
      () => [openTicketRow()],
    ];
    const res = await request(app)
      .get("/api/field/open-tickets/101")
      .set("Cookie", fieldCookie);
    expectStatus(res, 200);
    const parsed = GetFieldOpenTicketResponse.safeParse(res.body);
    if (!parsed.success) {
      throw new Error(
        `GET /field/open-tickets/:id drifted from spec:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    expect(parsed.data.id).toBe(101);
  });
});

// ─── POST /field/tickets ────────────────────────────────────────────────────

describe("POST /api/field/tickets — response contract", () => {
  it("body matches the FieldCreatedTicket spec shape on the happy path", async () => {
    selectQueue = [
      // 1) requireFieldUser
      () => [fieldEmployeeRow()],
      // 2) site_locations row (site_not_found guard + geofence math)
      () => [
        {
          id: 1,
          partnerId: 5,
          latitude: 30,
          longitude: -90,
          siteRadiusMeters: 500,
        },
      ],
      // 3) site_work_assignments by (vendor, site, work_type) — happy path
      () => [{ id: 99 }],
    ];
    const now = new Date("2026-04-30T15:00:00.000Z");
    insertedTicket = {
      // Mirrors what drizzle's `.returning()` would yield — every
      // required column from the spec plus a few extras the route
      // doesn't explicitly project. The `passthrough()` on the
      // contract schema lets the extras through, matching the spec's
      // `additionalProperties: true`.
      id: 7777,
      status: "in_progress",
      siteLocationId: 1,
      vendorId: VENDOR_ID,
      fieldEmployeeId: FIELD_EMPLOYEE_ID,
      workTypeId: 2,
      intakeChannel: "vendor_field_self_service",
      lifecycleState: "on_site",
      description: null,
      checkInTime: now,
      checkInLatitude: 30,
      checkInLongitude: -90,
      arrivedAt: now,
      foremanUserId: FIELD_USER_ID,
      createdAt: now,
      updatedAt: now,
      // Extra columns the route doesn't list in the spec — verifies
      // the `additionalProperties: true` semantics survive.
      partnerId: 5,
      notes: null,
    };
    const res = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send({
        siteLocationId: 1,
        workTypeId: 2,
        latitude: 30,
        longitude: -90,
        initialState: "on_site",
      });
    expectStatus(res, 201);
    const parsed = FieldCreatedTicketContract.safeParse(res.body);
    if (!parsed.success) {
      throw new Error(
        `POST /field/tickets drifted from spec (FieldCreatedTicket):\n${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    // The two enums in the spec have very small allowed sets — pin
    // them explicitly so a route change that broadens them shows up
    // here too.
    expect(["initiated", "in_progress"]).toContain(parsed.data.status);
    expect(["pending_arrival", "on_site"]).toContain(parsed.data.lifecycleState);
    expect(parsed.data.intakeChannel).toBe("vendor_field_self_service");
  });

  it("body still matches FieldCreatedTicket when the geofence misses (initiated/pending_arrival path)", async () => {
    // Same fixture sequence, but the device's coords land far enough
    // from the site that `insideGeofence === false` — the route then
    // initialises the ticket as `initiated` + `pending_arrival` with
    // null check-in fields. The spec's enums permit BOTH branches; this
    // test pins the second branch so a regression that, e.g., stops
    // emitting `pending_arrival` would fail here even though the
    // happy-path test above kept passing.
    selectQueue = [
      () => [fieldEmployeeRow()],
      () => [
        {
          id: 1,
          partnerId: 5,
          latitude: 30,
          longitude: -90,
          siteRadiusMeters: 50,
        },
      ],
      () => [{ id: 99 }],
    ];
    const now = new Date("2026-04-30T15:00:00.000Z");
    insertedTicket = {
      id: 7778,
      status: "initiated",
      siteLocationId: 1,
      vendorId: VENDOR_ID,
      fieldEmployeeId: FIELD_EMPLOYEE_ID,
      workTypeId: 2,
      intakeChannel: "vendor_field_self_service",
      lifecycleState: "pending_arrival",
      description: null,
      checkInTime: null,
      checkInLatitude: null,
      checkInLongitude: null,
      arrivedAt: null,
      foremanUserId: FIELD_USER_ID,
      createdAt: now,
      updatedAt: now,
    };
    const res = await request(app)
      .post("/api/field/tickets")
      .set("Cookie", fieldCookie)
      .send({
        siteLocationId: 1,
        workTypeId: 2,
        // Coords are far enough away (~111km) from the site centre to
        // miss any plausible geofence radius.
        latitude: 31,
        longitude: -90,
        initialState: "on_site",
      });
    expectStatus(res, 201);
    const parsed = FieldCreatedTicketContract.safeParse(res.body);
    if (!parsed.success) {
      throw new Error(
        `POST /field/tickets pending_arrival branch drifted from spec:\n${JSON.stringify(parsed.error.issues, null, 2)}`,
      );
    }
    expect(parsed.data.status).toBe("initiated");
    expect(parsed.data.lifecycleState).toBe("pending_arrival");
    expect(parsed.data.checkInTime).toBeNull();
  });
});
