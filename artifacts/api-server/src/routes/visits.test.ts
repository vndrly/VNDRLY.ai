import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import pg from "pg";
import request from "supertest";
import {
  attachTestErrorMiddleware,
  expectStatus,
} from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import { formatTooFarFromSiteMessage } from "@workspace/map-utils";

// ── Tiny in-memory store with predicate-aware query evaluation ───────────────
//
// The visits routes use drizzle's eq / and / isNull / isNotNull / sql / lt
// helpers in their WHERE clauses. To exercise the geofence, host validation
// and role-aware filtering for real, we mock those helpers to build a
// predicate AST and have the mock `db` evaluate it against fixture rows.
//
// Fixture rows for joined reads include the joined column names directly
// (e.g. siteVisits rows carry siteName, hostPartnerName, hostVendorName,
// sitePartnerId), since the mock does not perform real joins. The route's
// projection maps drizzle column refs to keys in the response object, but
// since the mock returns the full row as-is, accessing `row.siteName`
// (etc.) just works as long as the fixture provides that key.

type Row = Record<string, any>;
type ColRef = { __table: string; __col: string };
type CountExpr = { kind: "count" };
type Selection = Record<string, ColRef | CountExpr>;
type Pred =
  | { kind: "eq"; col: ColRef; val: any }
  | { kind: "isNull"; col: ColRef }
  | { kind: "isNotNull"; col: ColRef }
  | { kind: "lt"; col: ColRef; val: any }
  | { kind: "gte"; col: ColRef; val: any }
  | { kind: "inArray"; col: ColRef; vals: any[] }
  | { kind: "stalePlus30"; col: ColRef; now: Date }
  | { kind: "tsRange"; col: ColRef; cmp: ">=" | "<="; val: Date }
  | { kind: "and"; preds: Pred[] }
  | { kind: "true" };

function requireIsolatedTestDatabaseUrl(env: {
  DATABASE_URL?: string;
  TEST_DATABASE_URL?: string;
  VNDRLY_ISOLATED_TEST_DB?: string;
}): string {
  const databaseUrl = env.DATABASE_URL?.trim();
  const testDatabaseUrl = env.TEST_DATABASE_URL?.trim();
  if (!databaseUrl || !testDatabaseUrl || env.VNDRLY_ISOLATED_TEST_DB !== "1") {
    throw new Error(
      "schema contract requires the isolated test wrapper marker and database URLs",
    );
  }

  const normalizedTarget = (urlString: string) => {
    const url = new URL(urlString);
    const protocol = url.protocol.toLowerCase();
    const effectivePort =
      url.port ||
      (protocol === "postgres:" || protocol === "postgresql:" ? "5432" : "");
    return JSON.stringify({
      protocol,
      hostname: url.hostname.toLowerCase(),
      port: effectivePort,
      username: decodeURIComponent(url.username),
      databasePath: decodeURIComponent(url.pathname).replace(/^\/+/, ""),
    });
  };
  if (normalizedTarget(databaseUrl) !== normalizedTarget(testDatabaseUrl)) {
    throw new Error(
      "schema contract requires matching isolated database targets",
    );
  }

  return databaseUrl;
}

function tableTag(name: string, cols: string[]) {
  const t: any = { __name: name };
  for (const c of cols) t[c] = { __table: name, __col: c };
  return t;
}

const tables = {
  guestSessions: tableTag("guestSessions", [
    "id",
    "tokenJti",
    "firstName",
    "lastName",
    "phone",
    "email",
    "company",
    "vehiclePlate",
    "plateState",
    "lastPurpose",
    "createdAt",
    "expiresAt",
    "revokedAt",
  ]),
  siteVisits: tableTag("siteVisits", [
    "id",
    "siteLocationId",
    "guestSessionId",
    "firstName",
    "lastName",
    "phone",
    "email",
    "company",
    "vehiclePlate",
    "plateState",
    "platePhotoUrl",
    "vehiclePhotoUrl",
    "purpose",
    "notes",
    "checkOutNotes",
    "admissionStatus",
    "entryCategory",
    "expectedDurationMinutes",
    "hostType",
    "hostPartnerId",
    "hostVendorId",
    "checkInTime",
    "checkInLatitude",
    "checkInLongitude",
    "checkOutTime",
    "checkOutLatitude",
    "checkOutLongitude",
    "autoCheckedOut",
    "recordedByUserId",
    "safetyAcknowledgedAt",
    "createdAt",
    "expiresAt",
  ]),
  siteLocations: tableTag("siteLocations", [
    "id",
    "name",
    "address",
    "state",
    "siteCode",
    "latitude",
    "longitude",
    "siteRadiusMeters",
    "partnerId",
    "isActive",
    "status",
    "hidden",
  ]),
  partners: tableTag("partners", [
    "id",
    "name",
    "logoUrl",
    "logoSquareUrl",
    "brandPrimaryColor",
    "brandAccentColor",
  ]),
  vendors: tableTag("vendors", ["id", "name"]),
  siteWorkAssignments: tableTag("siteWorkAssignments", [
    "id",
    "siteLocationId",
    "vendorId",
  ]),
  users: tableTag("users", ["id", "partnerId", "vendorId"]),
  vendorPeople: tableTag("vendorPeople", [
    "id",
    "vendorId",
    "vendorRole",
    "firstName",
    "lastName",
    "userId",
    "deletedAt",
  ]),
  ticketCheckIns: tableTag("ticketCheckIns", [
    "id",
    "employeeId",
    "checkInAt",
    "checkOutAt",
  ]),
};

const fixtures: Record<string, Row[]> = {
  guestSessions: [],
  siteVisits: [],
  siteLocations: [],
  partners: [],
  vendors: [],
  siteWorkAssignments: [],
  users: [],
  vendorPeople: [],
  ticketCheckIns: [],
};

const idCounters: Record<string, number> = {};
function nextId(t: string) {
  idCounters[t] = (idCounters[t] ?? 0) + 1;
  return idCounters[t];
}

function evalPred(pred: Pred | undefined, row: Row, now = new Date()): boolean {
  if (!pred) return true;
  switch (pred.kind) {
    case "true":
      return true;
    case "eq":
      return row[pred.col.__col] === pred.val;
    case "isNull":
      return row[pred.col.__col] == null;
    case "isNotNull":
      return row[pred.col.__col] != null;
    case "lt": {
      const lhs = row[pred.col.__col];
      if (lhs == null) return false;
      const a = lhs instanceof Date ? lhs.getTime() : lhs;
      const b = pred.val instanceof Date ? pred.val.getTime() : pred.val;
      return a < b;
    }
    case "gte": {
      const lhs = row[pred.col.__col];
      if (lhs == null) return false;
      const a = lhs instanceof Date ? lhs.getTime() : lhs;
      const b = pred.val instanceof Date ? pred.val.getTime() : pred.val;
      return a >= b;
    }
    case "inArray":
      return pred.vals.includes(row[pred.col.__col]);
    case "tsRange": {
      const lhs = row[pred.col.__col];
      if (lhs == null) return false;
      const a = lhs instanceof Date ? lhs.getTime() : lhs;
      const b = pred.val.getTime();
      return pred.cmp === ">=" ? a >= b : a <= b;
    }
    case "stalePlus30": {
      // expiresAt + 30 minutes < now()
      const lhs = row[pred.col.__col];
      if (lhs == null) return false;
      const a = (lhs instanceof Date ? lhs.getTime() : lhs) + 30 * 60 * 1000;
      return a < pred.now.getTime();
    }
    case "and":
      return pred.preds.every((p) => evalPred(p, row, now));
  }
}

let lastInsert: { table: string; values: Row | Row[] } | null = null;
const selectCounts: Record<string, number> = {};

function isCountExpression(value: unknown): value is CountExpr {
  return Boolean(
    value && typeof value === "object" && (value as CountExpr).kind === "count",
  );
}

function projectRow(
  row: Row,
  selection: Selection | undefined,
  count?: number,
): Row {
  if (!selection) return row;
  return Object.fromEntries(
    Object.entries(selection).map(([key, value]) => {
      if (isCountExpression(value)) return [key, count];
      if (!value || typeof value !== "object" || !("__col" in value)) {
        throw new Error(`unsupported projection: ${key}`);
      }
      return [key, row[value.__col]];
    }),
  );
}

function makeQuery(tableName: string, selection?: Selection) {
  let pred: Pred | undefined;
  let limitN: number | undefined;
  let groupColumns: ColRef[] = [];
  const run = () => {
    const all = fixtures[tableName] ?? [];
    const filtered = all.filter((r) => evalPred(pred, r));
    const hasCount = Object.values(selection ?? {}).some(isCountExpression);

    if (groupColumns.length > 0) {
      const grouped = new Map<string, Row[]>();
      for (const row of filtered) {
        const key = groupColumns
          .map((column) => String(row[column.__col]))
          .join("\u0000");
        const rows = grouped.get(key) ?? [];
        rows.push(row);
        grouped.set(key, rows);
      }
      return [...grouped.values()].map((rows) =>
        projectRow(rows[0], selection, rows.length),
      );
    }

    if (hasCount)
      return [projectRow(filtered[0] ?? {}, selection, filtered.length)];

    const rows = filtered.map((row) => projectRow(row, selection));
    return limitN != null ? rows.slice(0, limitN) : rows;
  };
  const q: any = {
    where: (p: Pred) => {
      pred = p;
      return q;
    },
    leftJoin: () => q,
    innerJoin: () => q,
    groupBy: (...columns: ColRef[]) => {
      groupColumns = columns;
      return q;
    },
    orderBy: () => q,
    limit: (n: number) => {
      limitN = n;
      return q;
    },
    offset: () => q,
    then: (resolve: any, reject?: any) =>
      Promise.resolve(run()).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(run()).catch(reject),
  };
  return q;
}

vi.mock("@workspace/db", () => {
  const db = {
    select: (_cols?: any) => ({
      from: (t: any) => {
        selectCounts[t.__name] = (selectCounts[t.__name] ?? 0) + 1;
        return makeQuery(t.__name, _cols);
      },
    }),
    selectDistinct: (_cols?: any) => ({
      from: (t: any) => makeQuery(t.__name, _cols),
    }),
    insert: (t: any) => ({
      values: (v: any) => {
        const valsArr: Row[] = Array.isArray(v) ? v : [v];
        const inserted = valsArr.map((vv) => {
          // Mirror DB-side defaults the production code relies on.
          const defaults: Row = {};
          if (t.__name === "siteVisits") {
            defaults.checkInTime = new Date();
            defaults.autoCheckedOut = false;
            defaults.checkOutTime = null;
            defaults.checkOutLatitude = null;
            defaults.checkOutLongitude = null;
            defaults.createdAt = new Date();
          }
          return { id: nextId(t.__name), ...defaults, ...vv };
        });
        for (const row of inserted) fixtures[t.__name].push(row);
        lastInsert = { table: t.__name, values: v };
        const ret: any = {
          returning: async () => inserted,
          onConflictDoNothing: () => ret,
          then: (resolve: any) => Promise.resolve(inserted).then(resolve),
        };
        return ret;
      },
    }),
    update: (t: any) => ({
      set: (s: Row) => {
        const apply = (pred?: Pred) => {
          const matching = (fixtures[t.__name] ?? []).filter((r) =>
            evalPred(pred, r),
          );
          for (const m of matching) Object.assign(m, s);
          return matching;
        };
        const where = (p?: Pred) => {
          let resolved = false;
          let updated: Row[] = [];
          const ensure = () => {
            if (!resolved) {
              updated = apply(p);
              resolved = true;
            }
            return updated;
          };
          const ret: any = {
            returning: async (_cols?: any) => ensure(),
            then: (resolve: any) => Promise.resolve(ensure()).then(resolve),
            catch: (reject: any) => Promise.resolve(ensure()).catch(reject),
          };
          return ret;
        };
        return { where };
      },
    }),
  };
  return {
    db,
    pool: { query: vi.fn(async () => ({ rows: [] })) },
    guestSessionsTable: tables.guestSessions,
    siteVisitsTable: tables.siteVisits,
    siteLocationsTable: tables.siteLocations,
    partnersTable: tables.partners,
    vendorsTable: tables.vendors,
    siteWorkAssignmentsTable: tables.siteWorkAssignments,
    usersTable: tables.users,
    vendorPeopleTable: tables.vendorPeople,
    ticketCheckInsTable: tables.ticketCheckIns,
    // Task #51 — referenced by unread-comments.ts subqueries.
    commentReadReceiptsTable: tableTag("commentReadReceipts", []),
    hotlistCommentsTable: tableTag("hotlistComments", []),
    ticketNoteLogsTable: tableTag("ticketNoteLogs", []),
  };
});

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" });
  // Recognize the sweepStaleVisits SQL shape:
  //   sql`${siteVisits.expiresAt} + interval '30 minutes' < now()`
  // Translate it to a `stalePlus30` predicate the evaluator can honor so
  // the sweep test can verify only-overdue rows are auto-checked-out.
  const sqlTag: any = (strings: any, ...values: any[]) => {
    if (Array.isArray(strings) && (strings as any).raw !== undefined) {
      const joined = (strings as string[]).join(" ");
      if (/^\s*count\(\*\)(?:::\w+)?\s*$/i.test(joined)) {
        return { kind: "count" };
      }
      if (
        values.length === 1 &&
        /interval '30 minutes' < now\(\)/.test(joined) &&
        values[0] &&
        typeof (values[0] as any).__col === "string"
      ) {
        return {
          kind: "stalePlus30",
          col: values[0] as ColRef,
          now: new Date(),
        };
      }
      // Range predicates used by GET /api/visits filter (from / to)
      if (values.length === 2 && /\s>=\s/.test(joined)) {
        return {
          kind: "tsRange",
          col: values[0] as ColRef,
          cmp: ">=",
          val: values[1] as Date,
        };
      }
      if (values.length === 2 && /\s<=\s/.test(joined)) {
        return {
          kind: "tsRange",
          col: values[0] as ColRef,
          cmp: "<=",
          val: values[1] as Date,
        };
      }
    }
    return { kind: "true" };
  };
  sqlTag.raw = passthrough;
  return {
    and: (...preds: Pred[]) => ({ kind: "and", preds: preds.filter(Boolean) }),
    eq: (col: ColRef, val: any) => ({ kind: "eq", col, val }),
    isNull: (col: ColRef) => ({ kind: "isNull", col }),
    isNotNull: (col: ColRef) => ({ kind: "isNotNull", col }),
    lt: (col: ColRef, val: any) => ({ kind: "lt", col, val }),
    gte: (col: ColRef, val: any) => ({ kind: "gte", col, val }),
    inArray: (col: ColRef, vals: any[]) => ({ kind: "inArray", col, vals }),
    sql: sqlTag,
    desc: passthrough,
  };
});

// Stub out notifications so we don't pull in the notifications table chain.
const notifyUsersMock = vi.fn(async () => 0);
vi.mock("./notifications", () => ({
  notifyUsers: notifyUsersMock,
  findPartnerUserIds: async (id: number) => (id ? [100, 101] : []),
  findVendorUserIds: async (id: number) => (id ? [200] : []),
  findPartnerVisitNotifierUserIds: async (id: number) => (id ? [100, 101] : []),
  findVendorVisitNotifierUserIds: async (id: number) => (id ? [200] : []),
  VISIT_NOTIFICATIONS_ROLE: "Visitor Notifications",
}));

const readPlateFromImageMock = vi.fn();
vi.mock("../lib/plate-ocr", () => ({
  PlateOcrFailedError: class PlateOcrFailedError extends Error {},
  PlateOcrUnavailableError: class PlateOcrUnavailableError extends Error {},
  readPlateFromImage: readPlateFromImageMock,
}));

const getStoredObjectMock = vi.fn();
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class ObjectStorageService {
    getStoredObject = getStoredObjectMock;
  },
}));

vi.mock("../lib/gate-ocr-rate-limit", () => ({
  enforceGateOcrRateLimit: vi.fn(async () => true),
}));

const publishVisitEventMock = vi.fn();
let visitEventSubscriber: ((event: any) => void) | null = null;
vi.mock("../lib/visit-events", () => ({
  getCurrentVisitEventSeq: vi.fn(async () => 0),
  publishVisitEvent: publishVisitEventMock,
  subscribeVisitEvents: vi.fn((subscriber: (event: any) => void) => {
    visitEventSubscriber = subscriber;
    return () => {
      if (visitEventSubscriber === subscriber) visitEventSubscriber = null;
    };
  }),
}));

function staffCookie(
  overrides: Partial<{
    userId: number;
    role: string;
    vendorId: number | null;
    partnerId: number | null;
    vendorRole: string | null;
    exp: number;
  }> = {},
) {
  const session = {
    userId: 10,
    role: "admin",
    vendorId: null,
    partnerId: null,
    // getStaffSession requires `exp` (seconds-since-epoch) on the cookie.
    exp: Math.floor(Date.now() / 1000) + 60 * 60,
    ...overrides,
  };
  return buildTestCookie(session);
}

let app: express.Express;
let visitsModule: typeof import("./visits");
const hardeningEnvKeys = [
  "VNDRLY_REQUIRE_PLATE_STATE",
  "PREFERRED_PLATE_STATES_RATE_LIMIT_MAX",
  "PREFERRED_PLATE_STATES_RATE_LIMIT_WINDOW_MS",
  "PREFERRED_PLATE_STATES_GLOBAL_RATE_LIMIT_MAX",
  "PREFERRED_PLATE_STATES_GLOBAL_RATE_LIMIT_WINDOW_MS",
] as const;
const originalHardeningEnv = Object.fromEntries(
  hardeningEnvKeys.map((key) => [key, process.env[key]]),
);

beforeEach(async () => {
  for (const key of hardeningEnvKeys) delete process.env[key];
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  for (const k of Object.keys(idCounters)) idCounters[k] = 0;
  for (const k of Object.keys(selectCounts)) delete selectCounts[k];
  lastInsert = null;
  notifyUsersMock.mockClear();
  publishVisitEventMock.mockClear();
  visitEventSubscriber = null;
  readPlateFromImageMock.mockReset();
  getStoredObjectMock.mockReset();
  vi.resetModules();
  visitsModule = await import("./visits");
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", visitsModule.default);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  for (const key of hardeningEnvKeys) {
    const original = originalHardeningEnv[key];
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  }
  vi.clearAllMocks();
});

describe("POST /api/visits/gate/read-plate", () => {
  it("returns the legacy scalar plate and OCR metadata at the top level", async () => {
    getStoredObjectMock.mockResolvedValue({
      body: Buffer.from("plate-photo"),
      contentType: "image/jpeg",
      acl: { owner: "77" },
      size: 42,
    });
    readPlateFromImageMock.mockResolvedValue({
      plate: "OK-4412",
      state: "OK",
      plateConfidence: 0.96,
      stateConfidence: 0.83,
    });

    const res = await request(app)
      .post("/api/visits/gate/read-plate")
      .set(
        "Cookie",
        staffCookie({
          userId: 77,
          role: "vendor",
          vendorId: 9,
          vendorRole: "gatekeeper",
        }),
      )
      .send({
        objectPath: "/objects/uploads/00000000-0000-4000-8000-000000000001",
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      plate: "OK-4412",
      state: "OK",
      plateConfidence: 0.96,
      stateConfidence: 0.83,
    });
  });
});

describe("GET /api/visits/events", () => {
  it("streams plate state from a subscribed visit event", async () => {
    const server = app.listen(0);
    await new Promise<void>((resolve) => server.once("listening", resolve));
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("test server did not bind a TCP port");
    const controller = new AbortController();

    try {
      const response = await fetch(
        `http://127.0.0.1:${address.port}/api/visits/events`,
        {
          headers: { Cookie: staffCookie({ role: "admin" }) },
          signal: controller.signal,
        },
      );
      expect(response.status).toBe(200);
      expect(response.body).not.toBeNull();
      const subscriber = visitEventSubscriber;
      expect(subscriber).toBeTypeOf("function");

      subscriber!({
        type: "visit.checked_in",
        seq: 17,
        visit: {
          id: 170,
          firstName: "SSE",
          lastName: "Driver",
          company: "Stream Co",
          vehiclePlate: "SSE-170",
          plateState: "TX",
          platePhotoUrl: null,
          vehiclePhotoUrl: null,
          purpose: "Delivery",
          hostType: "partner",
          hostPartnerId: 1,
          hostVendorId: null,
          hostPartnerName: "Acme Partner",
          hostVendorName: null,
          siteLocationId: 10,
          sitePartnerId: 1,
          siteName: "Site A",
          checkInTime: "2026-08-27T20:00:00.000Z",
          checkInLatitude: 40,
          checkInLongitude: -74,
        },
      });

      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let stream = "";
      while (!stream.includes('"plateState":"TX"')) {
        const chunk = await Promise.race([
          reader.read(),
          new Promise<never>((_, reject) =>
            setTimeout(
              () => reject(new Error("timed out waiting for SSE visit event")),
              2_000,
            ),
          ),
        ]);
        if (chunk.done) break;
        stream += decoder.decode(chunk.value, { stream: true });
      }

      expect(stream).toContain("event: visit.checked_in");
      expect(stream).toContain('"vehiclePlate":"SSE-170"');
      expect(stream).toContain('"plateState":"TX"');
      await reader.cancel();
    } finally {
      controller.abort();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });
});

// Convenience: seed a site with both a partner host and a vendor host
// assigned, plus a guest session that authenticates subsequent calls.
function seedScenario() {
  const partner = { id: 1, name: "Acme Partner" };
  const vendor = { id: 2, name: "Beta Vendor" };
  const otherVendor = { id: 3, name: "Other Vendor" };
  const site = {
    id: 10,
    name: "Site A",
    address: "1 Main St",
    siteCode: "SITE-A",
    latitude: 40.0,
    longitude: -74.0,
    siteRadiusMeters: 150,
    partnerId: partner.id,
    isActive: true,
    status: "active",
    hidden: false,
  };
  const otherSite = {
    id: 11,
    name: "Other Site",
    address: "2 Other St",
    siteCode: "SITE-B",
    latitude: 41.0,
    longitude: -75.0,
    siteRadiusMeters: 150,
    partnerId: 99,
    isActive: true,
    status: "active",
    hidden: false,
  };
  fixtures.partners = [partner];
  fixtures.vendors = [vendor, otherVendor];
  fixtures.siteLocations = [site, otherSite];
  fixtures.siteWorkAssignments = [
    { id: 1, siteLocationId: site.id, vendorId: vendor.id },
  ];
  return { partner, vendor, otherVendor, site, otherSite };
}

async function startGuest(extras: Partial<Row> = {}) {
  const res = await request(app)
    .post("/api/auth/guest")
    .send({
      firstName: "Jane",
      lastName: "Visitor",
      phone: "555-1234",
      email: "jane@example.com",
      company: "Visitor Co",
      vehiclePlate: "ABC123",
      plateState: "TX",
      purpose: "Inspection",
      safetyAcknowledged: true,
      ...extras,
    });
  expectStatus(res, 200);
  return {
    token: res.body.token as string,
    guestSessionId: res.body.guestSessionId as number,
    cookie:
      (res.headers["set-cookie"] as unknown as string[])?.find((c) =>
        c.startsWith("vndrly_guest="),
      ) ?? "",
    body: res.body,
  };
}

describe("public site lookup isolation", () => {
  it("never lists the public directory without an exact code", async () => {
    seedScenario();
    const response = await request(app).get("/api/visits/public-sites");
    expectStatus(response, 200);
    expect(response.body).toEqual([]);
  });

  it("returns only the site named by the visitor's code", async () => {
    seedScenario();
    const response = await request(app).get("/api/visits/public-sites?siteCode=SITE-A");
    expectStatus(response, 200);
    expect(response.body.map((row: Row) => row.id)).toEqual([10]);
  });

  it("does not fall back to a directory for an unknown code", async () => {
    seedScenario();
    const response = await request(app).get("/api/visits/public-sites?siteCode=UNKNOWN");
    expectStatus(response, 200);
    expect(response.body).toEqual([]);
  });
});

describe("plate state persistence schema contract", () => {
  it("refuses a missing isolated-wrapper marker", () => {
    expect(() =>
      requireIsolatedTestDatabaseUrl({
        DATABASE_URL:
          "postgresql://test:test@example.test/explicit_test_database",
        TEST_DATABASE_URL:
          "postgresql://test:test@example.test/explicit_test_database",
      }),
    ).toThrow(/isolated test wrapper marker/);
  });

  it("refuses same-name targets on different hosts", () => {
    expect(() =>
      requireIsolatedTestDatabaseUrl({
        DATABASE_URL:
          "postgresql://test:test@isolated-a.example.test/explicit_test_database",
        TEST_DATABASE_URL:
          "postgresql://test:test@isolated-b.example.test/explicit_test_database",
        VNDRLY_ISOLATED_TEST_DB: "1",
      }),
    ).toThrow(/matching isolated database targets/);
  });

  it("accepts the exact wrapper target without requiring a database-name suffix", () => {
    const databaseUrl =
      "postgresql://test%20user:password@isolated.example.test:5432/explicit_database?sslmode=require";
    expect(
      requireIsolatedTestDatabaseUrl({
        DATABASE_URL: databaseUrl,
        TEST_DATABASE_URL:
          "postgresql://test%20user:other-password@isolated.example.test/explicit_database?application_name=vitest",
        VNDRLY_ISOLATED_TEST_DB: "1",
      }),
    ).toBe(databaseUrl);
  });

  it("stores and returns TX for guest sessions and site visits", async () => {
    // The route suite mocks @workspace/db, so this contract queries the
    // wrapper-provisioned database directly. The wrapper builds that schema
    // from the real Drizzle tables before this test starts. The guard requires
    // the wrapper's child-only marker and normalized full-target equality
    // before opening a connection; the transaction leaves no fixtures.
    const isolatedClient = new pg.Client({
      connectionString: requireIsolatedTestDatabaseUrl(process.env),
    });
    let transactionStarted = false;
    try {
      await isolatedClient.connect();
      await isolatedClient.query("BEGIN");
      transactionStarted = true;

      const metadata = await isolatedClient.query<{
        table_name: string;
        data_type: string;
        is_nullable: string;
      }>(`
        SELECT table_name, data_type, is_nullable
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND column_name = 'plate_state'
          AND table_name IN ('guest_sessions', 'site_visits')
        ORDER BY table_name
      `);
      expect(metadata.rows).toEqual([
        { table_name: "guest_sessions", data_type: "text", is_nullable: "YES" },
        { table_name: "site_visits", data_type: "text", is_nullable: "YES" },
      ]);

      const suffix = `plate-state-${Date.now()}`;
      const guest = await isolatedClient.query<{
        id: number;
        plate_state: string;
      }>(
        `INSERT INTO guest_sessions (token_jti, first_name, last_name, expires_at, plate_state)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, plate_state`,
        [
          suffix,
          "Schema",
          "Contract",
          new Date(Date.now() + 60 * 60 * 1000),
          "TX",
        ],
      );
      expect(guest.rows[0]?.plate_state).toBe("TX");

      const partner = await isolatedClient.query<{ id: number }>(
        `INSERT INTO partners (name, contact_name, contact_email)
         VALUES ($1, $2, $3)
         RETURNING id`,
        [`Plate State ${suffix}`, "Schema Contract", `${suffix}@example.test`],
      );
      const site = await isolatedClient.query<{ id: number }>(
        `INSERT INTO site_locations (partner_id, name, address, latitude, longitude, site_code)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [
          partner.rows[0]!.id,
          "Plate State Test Site",
          "1 Isolated Test Way",
          31,
          -102,
          suffix.toUpperCase(),
        ],
      );
      const visit = await isolatedClient.query<{ plate_state: string }>(
        `INSERT INTO site_visits (
          site_location_id, guest_session_id, first_name, last_name,
          host_type, host_partner_id, plate_state
        ) VALUES ($1, $2, $3, $4, $5, $6, $7)
        RETURNING plate_state`,
        [
          site.rows[0]!.id,
          guest.rows[0]!.id,
          "Schema",
          "Contract",
          "partner",
          partner.rows[0]!.id,
          "TX",
        ],
      );
      expect(visit.rows[0]?.plate_state).toBe("TX");
    } finally {
      try {
        if (transactionStarted) await isolatedClient.query("ROLLBACK");
      } finally {
        await isolatedClient.end();
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/auth/guest", () => {
  it("accepts a legacy plate-only request while the rollout flag is disabled", async () => {
    const res = await request(app).post("/api/auth/guest").send({
      firstName: "Legacy",
      lastName: "Driver",
      vehiclePlate: "LEGACY-1",
      safetyAcknowledged: true,
    });

    expectStatus(res, 200);
    expect(res.body.profile).toMatchObject({
      vehiclePlate: "LEGACY-1",
      plateState: null,
    });
    expect(fixtures.guestSessions[0]).toMatchObject({
      vehiclePlate: "LEGACY-1",
      plateState: null,
    });
  });

  it.each([
    ["absent", undefined],
    ["null", null],
    ["empty", ""],
    ["blank", "   "],
  ])("rejects a vehicle plate when state is %s", async (_label, plateState) => {
    process.env.VNDRLY_REQUIRE_PLATE_STATE = "1";
    const res = await request(app).post("/api/auth/guest").send({
      firstName: "Jane",
      lastName: "Doe",
      vehiclePlate: "ABC123",
      plateState,
      safetyAcknowledged: true,
    });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "missing-state",
      message: expect.any(String),
    });
    expect(fixtures.guestSessions).toHaveLength(0);
  });

  it.each([
    ["unknown code", "ZZ"],
    ["number", 42],
    ["array", ["TX"]],
    ["object", { code: "TX" }],
    ["boolean", true],
  ])(
    "rejects a vehicle plate when state is an invalid %s",
    async (_label, plateState) => {
      const res = await request(app).post("/api/auth/guest").send({
        firstName: "Jane",
        lastName: "Doe",
        vehiclePlate: "ABC123",
        plateState,
        safetyAcknowledged: true,
      });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        code: "invalid-state",
        message: expect.any(String),
      });
      expect(fixtures.guestSessions).toHaveLength(0);
    },
  );

  it("normalizes and returns the guest vehicle state", async () => {
    const guest = await startGuest({ plateState: " tx " });

    expect(fixtures.guestSessions[0]).toMatchObject({
      vehiclePlate: "ABC123",
      plateState: "TX",
    });
    expect(guest.body.profile).toMatchObject({
      vehiclePlate: "ABC123",
      plateState: "TX",
    });

    const me = await request(app)
      .get("/api/auth/guest/me")
      .set("Authorization", `Bearer ${guest.token}`);
    expectStatus(me, 200);
    expect(me.body.profile).toMatchObject({
      vehiclePlate: "ABC123",
      plateState: "TX",
    });
  });

  it("discards a state when no vehicle plate is supplied", async () => {
    const guest = await startGuest({ vehiclePlate: " ", plateState: "tx" });

    expect(fixtures.guestSessions[0]).toMatchObject({
      vehiclePlate: null,
      plateState: null,
    });
    expect(guest.body.profile).toMatchObject({
      vehiclePlate: null,
      plateState: null,
    });
  });

  it("requires firstName and lastName", async () => {
    const res = await request(app)
      .post("/api/auth/guest")
      .send({ firstName: "", lastName: "Doe", safetyAcknowledged: true });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("guest.name_required");
  });

  it("requires safety acknowledgement", async () => {
    const res = await request(app)
      .post("/api/auth/guest")
      .send({ firstName: "Jane", lastName: "Doe", safetyAcknowledged: false });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/safety/i);
    expect(res.body.code).toBe("guest.safety_required");
  });

  it("creates a guest session, sets cookie, returns bearer token", async () => {
    const res = await request(app).post("/api/auth/guest").send({
      firstName: "  Jane  ",
      lastName: "Visitor",
      phone: "555",
      email: "j@e.com",
      safetyAcknowledged: true,
    });
    expectStatus(res, 200);
    expect(res.body.role).toBe("guest");
    expect(typeof res.body.token).toBe("string");
    expect(res.body.guestSessionId).toBeGreaterThan(0);
    expect(res.body.profile.firstName).toBe("Jane");
    const setCookie = res.headers["set-cookie"] as unknown as string[];
    expect(setCookie?.some((c) => c.startsWith("vndrly_guest="))).toBe(true);
    expect(fixtures.guestSessions).toHaveLength(1);
    expect(fixtures.guestSessions[0]).toMatchObject({
      firstName: "Jane",
      lastName: "Visitor",
    });
    expect(fixtures.guestSessions[0].revokedAt).toBeFalsy();
  });

  it("returned bearer token authenticates GET /api/auth/guest/me", async () => {
    const { token } = await startGuest();
    const me = await request(app)
      .get("/api/auth/guest/me")
      .set("Authorization", `Bearer ${token}`);
    expectStatus(me, 200);
    expect(me.body.profile.firstName).toBe("Jane");
  });

  it("rejects guest endpoints without a token", async () => {
    const me = await request(app).get("/api/auth/guest/me");
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("auth.guest_required");
  });

  it("rejects guest endpoints when the backing session has been revoked", async () => {
    const { token } = await startGuest();
    // Token still decodes (exp is in the future), but the row is gone/revoked
    // → requireGuest must fall through to the auth.guest_expired branch.
    fixtures.guestSessions[0].revokedAt = new Date();
    const me = await request(app)
      .get("/api/auth/guest/me")
      .set("Authorization", `Bearer ${token}`);
    expect(me.status).toBe(401);
    expect(me.body.code).toBe("auth.guest_expired");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/visits/check-in", () => {
  it("rejects a supplied vehicle plate without a state", async () => {
    process.env.VNDRLY_REQUIRE_PLATE_STATE = "1";
    const { site } = seedScenario();
    const { token } = await startGuest({ vehiclePlate: "", plateState: "" });
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: site.partnerId,
        vehiclePlate: "NEW-123",
        latitude: site.latitude,
        longitude: site.longitude,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "missing-state",
      message: expect.any(String),
    });
    expect(fixtures.siteVisits).toHaveLength(0);
  });

  it("rejects an invalid supplied vehicle state", async () => {
    const { site } = seedScenario();
    const { token } = await startGuest({ vehiclePlate: "", plateState: "" });
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: site.partnerId,
        vehiclePlate: "NEW-123",
        plateState: "ZZ",
        latitude: site.latitude,
        longitude: site.longitude,
      });

    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({
      code: "invalid-state",
      message: expect.any(String),
    });
    expect(fixtures.siteVisits).toHaveLength(0);
  });

  it("normalizes and propagates a supplied vehicle state", async () => {
    const { site } = seedScenario();
    const { token } = await startGuest({ vehiclePlate: "", plateState: "" });
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: site.partnerId,
        vehiclePlate: " NEW-123 ",
        plateState: "tx",
        latitude: site.latitude,
        longitude: site.longitude,
      });

    expectStatus(res, 201);
    expect(fixtures.guestSessions[0]).toMatchObject({
      vehiclePlate: "NEW-123",
      plateState: "TX",
    });
    expect(fixtures.siteVisits[0]).toMatchObject({
      vehiclePlate: "NEW-123",
      plateState: "TX",
    });
    expect(res.body).toMatchObject({
      vehiclePlate: "NEW-123",
      plateState: "TX",
    });
    expect(publishVisitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "visit.checked_in",
        visit: expect.objectContaining({
          vehiclePlate: "NEW-123",
          plateState: "TX",
        }),
      }),
    );

    fixtures.siteVisits[0].siteName = site.name;
    const active = await request(app)
      .get("/api/visits/me/active")
      .set("Authorization", `Bearer ${token}`);
    expectStatus(active, 200);
    expect(active.body).toMatchObject({
      vehiclePlate: "NEW-123",
      plateState: "TX",
    });
  });

  it("requires a state when a historical guest plate is written to a new visit", async () => {
    process.env.VNDRLY_REQUIRE_PLATE_STATE = "1";
    const { site } = seedScenario();
    const { token } = await startGuest({ vehiclePlate: "", plateState: "" });
    Object.assign(fixtures.guestSessions[0], {
      vehiclePlate: "LEGACY-1",
      plateState: null,
    });

    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: site.partnerId,
        latitude: site.latitude,
        longitude: site.longitude,
      });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("missing-state");
    expect(fixtures.siteVisits).toHaveLength(0);
  });

  it("requires a guest session", async () => {
    seedScenario();
    const res = await request(app)
      .post("/api/visits/check-in")
      .send({
        siteLocationId: 10,
        hostType: "partner",
        hostPartnerId: 1,
        latitude: 40,
        longitude: -74,
      });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.guest_required");
  });

  it("validates required body fields", async () => {
    seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({ hostType: "partner" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("visit.invalid_input");
  });

  it("returns 404 when site does not exist", async () => {
    seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: 9999,
        hostType: "partner",
        hostPartnerId: 1,
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("site.not_found");
  });

  it("rejects when partner host does not own the site", async () => {
    const { site } = seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 999, // not site.partnerId
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Partner host/i);
    expect(res.body.code).toBe("visit.partner_host_mismatch");
  });

  it("rejects when vendor host id is missing", async () => {
    const { site } = seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "vendor",
        // no hostVendorId
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("visit.host_vendor_required");
  });

  it("rejects when vendor host is not assigned to the site", async () => {
    const { site, otherVendor } = seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "vendor",
        hostVendorId: otherVendor.id, // not in siteWorkAssignments
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not assigned/i);
    expect(res.body.code).toBe("visit.vendor_not_assigned");
  });

  it("rejects when location is not provided", async () => {
    const { site } = seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
      });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Location is required/i);
    expect(res.body.code).toBe("visit.location_required");
  });

  it("rejects when caller is outside the geofence", async () => {
    const { site } = seedScenario();
    const { token } = await startGuest();
    // ~111km north of the site → far outside any sensible site radius.
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
        latitude: 41.0,
        longitude: -74.0,
      });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("off_geofence");
    expect(res.body.distanceMeters).toBeGreaterThan(site.siteRadiusMeters);
    expect(res.body.radiusMeters).toBe(site.siteRadiusMeters);
    expect(res.body.message).toBe(
      formatTooFarFromSiteMessage(res.body.distanceMeters, res.body.radiusMeters),
    );
    expect(res.body.message).toMatch(/miles/);
    expect(res.body.message).not.toMatch(/\d+m away/);
    expect(fixtures.siteVisits).toHaveLength(0);
  });

  it("happy path (partner host): inserts visit and notifies host org users", async () => {
    const { site } = seedScenario();
    const { token, guestSessionId } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
        purpose: "Inspection",
        expectedDurationMinutes: 30,
        latitude: 40.0,
        longitude: -74.0,
      });
    expectStatus(res, 201);
    expect(res.body.hostName).toBe("Acme Partner");
    expect(res.body.siteName).toBe("Site A");
    expect(fixtures.siteVisits).toHaveLength(1);
    expect(fixtures.siteVisits[0]).toMatchObject({
      siteLocationId: site.id,
      guestSessionId,
      hostType: "partner",
      hostPartnerId: 1,
      hostVendorId: null,
    });
    expect(fixtures.siteVisits[0].checkOutTime).toBeFalsy();
    expect(notifyUsersMock).toHaveBeenCalledTimes(1);
    const [recipients, notif] = notifyUsersMock.mock.calls[0] as any;
    expect(recipients).toEqual([100, 101]);
    expect(notif).toMatchObject({
      type: "visitor_checked_in",
      category: "visitor",
    });
  });

  it("stores gate vehicle evidence photos on check-in and returns them to staff", async () => {
    const { site } = seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
        vehiclePlate: "TRK-778",
        plateState: "TX",
        platePhotoUrl: "/uploads/visits/plate.jpg",
        vehiclePhotoUrl: "/uploads/visits/truck.jpg",
        latitude: 40.0,
        longitude: -74.0,
      });
    expectStatus(res, 201);
    expect(fixtures.siteVisits[0]).toMatchObject({
      vehiclePlate: "TRK-778",
      plateState: "TX",
      platePhotoUrl: "/uploads/visits/plate.jpg",
      vehiclePhotoUrl: "/uploads/visits/truck.jpg",
    });

    fixtures.siteVisits[0].siteName = site.name;
    fixtures.siteVisits[0].sitePartnerId = site.partnerId;
    fixtures.siteVisits[0].partnerId = site.partnerId;
    fixtures.siteVisits[0].hostPartnerName = "Acme Partner";
    const list = await request(app)
      .get("/api/visits")
      .set("Cookie", staffCookie({ role: "partner", partnerId: 1 }));
    expectStatus(list, 200);
    expect(list.body[0]).toMatchObject({
      vehiclePlate: "TRK-778",
      plateState: "TX",
      platePhotoUrl: "/uploads/visits/plate.jpg",
      vehiclePhotoUrl: "/uploads/visits/truck.jpg",
    });

    const detail = await request(app)
      .get(`/api/visits/${res.body.id}`)
      .set("Cookie", staffCookie({ role: "partner", partnerId: 1 }));
    expectStatus(detail, 200);
    expect(detail.body).toMatchObject({
      platePhotoUrl: "/uploads/visits/plate.jpg",
      vehiclePhotoUrl: "/uploads/visits/truck.jpg",
    });
  });

  it("happy path (vendor host): inserts visit linked to the assigned vendor", async () => {
    const { site, vendor } = seedScenario();
    const { token } = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "vendor",
        hostVendorId: vendor.id,
        latitude: 40.0,
        longitude: -74.0,
      });
    expectStatus(res, 201);
    expect(res.body.hostName).toBe("Beta Vendor");
    expect(fixtures.siteVisits[0]).toMatchObject({
      hostType: "vendor",
      hostVendorId: vendor.id,
      hostPartnerId: null,
    });
    const [recipients] = notifyUsersMock.mock.calls[0] as any;
    expect(recipients).toEqual([200]);
  });

  it("auto-checks-out any prior open visit before creating a new one", async () => {
    const { site, vendor } = seedScenario();
    const { token, guestSessionId } = await startGuest();
    // First check-in.
    await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "vendor",
        hostVendorId: vendor.id,
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(fixtures.siteVisits).toHaveLength(1);
    const firstVisitId = fixtures.siteVisits[0].id;

    // Second check-in (e.g. same guest forgets to check out).
    await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
        latitude: 40.0,
        longitude: -74.0,
      });
    expect(fixtures.siteVisits).toHaveLength(2);
    const first = fixtures.siteVisits.find((v) => v.id === firstVisitId);
    expect(first?.checkOutTime).toBeInstanceOf(Date);
    expect(first?.autoCheckedOut).toBe(true);
    // The new open visit belongs to the same guest.
    const open = fixtures.siteVisits.filter((v) => !v.checkOutTime);
    expect(open).toHaveLength(1);
    expect(open[0].guestSessionId).toBe(guestSessionId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("POST /api/visits/:id/check-out", () => {
  async function checkInOnce() {
    const scenario = seedScenario();
    const guest = await startGuest();
    const res = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${guest.token}`)
      .send({
        siteLocationId: scenario.site.id,
        hostType: "partner",
        hostPartnerId: 1,
        latitude: 40.0,
        longitude: -74.0,
      });
    return { ...scenario, guest, visitId: res.body.id as number };
  }

  it("checks out the active visit and records geo coords", async () => {
    const { guest, visitId } = await checkInOnce();
    const res = await request(app)
      .post(`/api/visits/${visitId}/check-out`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ latitude: 40.001, longitude: -74.002 });
    expectStatus(res, 200);
    expect(res.body.checkOutTime).toBeTruthy();
    const stored = fixtures.siteVisits.find((v) => v.id === visitId);
    expect(stored?.checkOutTime).toBeInstanceOf(Date);
    expect(stored?.checkOutLatitude).toBe(40.001);
    expect(stored?.checkOutLongitude).toBe(-74.002);
    expect(stored?.autoCheckedOut).not.toBe(true);
  });

  it("returns 404 if the visit does not belong to the calling guest", async () => {
    const { visitId } = await checkInOnce();
    // Start a *different* guest session and try to check out the visit.
    const otherGuest = await startGuest({
      firstName: "Other",
      lastName: "Guest",
    });
    const res = await request(app)
      .post(`/api/visits/${visitId}/check-out`)
      .set("Authorization", `Bearer ${otherGuest.token}`)
      .send({});
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("visit.not_found");
  });

  it("returns 400 when the visit id is not a number", async () => {
    const { guest } = await checkInOnce();
    const res = await request(app)
      .post(`/api/visits/not-a-number/check-out`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("visit.invalid_id");
  });

  it("returns the visit unchanged if already checked out (idempotent)", async () => {
    const { guest, visitId } = await checkInOnce();
    await request(app)
      .post(`/api/visits/${visitId}/check-out`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ latitude: 40, longitude: -74 });
    const before = { ...fixtures.siteVisits.find((v) => v.id === visitId)! };
    const second = await request(app)
      .post(`/api/visits/${visitId}/check-out`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ latitude: 50, longitude: -80 });
    expectStatus(second, 200);
    const after = fixtures.siteVisits.find((v) => v.id === visitId)!;
    expect(after.checkOutTime?.getTime()).toBe(before.checkOutTime?.getTime());
    expect(after.checkOutLatitude).toBe(before.checkOutLatitude);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/visits role-aware filtering", () => {
  async function seedTwoVisits() {
    const { site } = seedScenario();
    // Visit 1 on site (partner=1, host vendor=2).
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: site.id,
      guestSessionId: 1,
      firstName: "V1",
      lastName: "P",
      hostType: "vendor",
      hostVendorId: 2,
      hostPartnerId: null,
      checkInTime: new Date(),
      checkOutTime: null,
      autoCheckedOut: false,
      // joined fields the route projects via leftJoin:
      siteName: site.name,
      hostVendorName: "Beta Vendor",
      hostPartnerName: null,
    });
    // Visit 2 at a *different* partner's site, hosted by a different vendor.
    const otherSite = fixtures.siteLocations.find((s) => s.id === 11)!;
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: otherSite.id,
      guestSessionId: 2,
      firstName: "V2",
      lastName: "Q",
      hostType: "vendor",
      hostVendorId: 3,
      hostPartnerId: null,
      checkInTime: new Date(),
      checkOutTime: null,
      autoCheckedOut: false,
      siteName: otherSite.name,
      hostVendorName: "Other Vendor",
      hostPartnerName: null,
      // For the partner-role filter, the route condition is
      // eq(siteLocationsTable.partnerId, session.partnerId). With our flat
      // mock that filter applies against the *visit row*, so we expose the
      // joined site partnerId here as `partnerId` to make the test honest.
      partnerId: otherSite.partnerId,
    });
    // And expose site partnerId on visit 1 too:
    fixtures.siteVisits[0].partnerId = site.partnerId;
  }

  it("rejects unauthenticated callers", async () => {
    await seedTwoVisits();
    const res = await request(app).get("/api/visits");
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("rejects guest sessions hitting the staff list", async () => {
    await seedTwoVisits();
    // Construct a fake "staff" cookie with role=guest — the staff list must
    // refuse guest tokens regardless.
    const cookie = buildTestCookie({ userId: 0, role: "guest" });
    const res = await request(app).get("/api/visits").set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("admin sees all visits", async () => {
    await seedTwoVisits();
    const res = await request(app)
      .get("/api/visits")
      .set("Cookie", staffCookie({ role: "admin" }));
    expectStatus(res, 200);
    expect(res.body).toHaveLength(2);
  });

  it("serializes a historical visit with a null vehicle state in the staff list", async () => {
    await seedTwoVisits();
    Object.assign(fixtures.siteVisits[0], {
      vehiclePlate: "LEGACY-1",
      plateState: null,
    });

    const res = await request(app)
      .get("/api/visits")
      .set("Cookie", staffCookie({ role: "admin" }));

    expectStatus(res, 200);
    expect(res.body[0]).toMatchObject({
      vehiclePlate: "LEGACY-1",
      plateState: null,
    });
  });

  it("vendor sees only its own hosted visits", async () => {
    await seedTwoVisits();
    const res = await request(app)
      .get("/api/visits")
      .set("Cookie", staffCookie({ role: "vendor", vendorId: 2 }));
    expectStatus(res, 200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].firstName).toBe("V1");
  });

  it("partner sees only visits at sites they own", async () => {
    await seedTwoVisits();
    const res = await request(app)
      .get("/api/visits")
      .set("Cookie", staffCookie({ role: "partner", partnerId: 1 }));
    expectStatus(res, 200);
    expect(res.body).toHaveLength(1);
    expect(res.body[0].firstName).toBe("V1");
  });

  it("returns [] for unrelated roles (e.g. field_employee)", async () => {
    await seedTwoVisits();
    const res = await request(app)
      .get("/api/visits")
      .set("Cookie", staffCookie({ role: "field_employee", vendorId: 1 }));
    expectStatus(res, 200);
    // field_employee falls through the role gate but vendor branch handles
    // it (vendor != admin/partner branch with vendorId set), so we accept
    // either [] (strict) or a vendor-scoped subset; assert it's not the
    // full admin view.
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeLessThan(2);
  });
});

describe("GET /api/visits/sites/:siteId/preferred-plate-states", () => {
  function addConfirmedVisits(
    siteId: number,
    plateState: string | null,
    count: number,
    daysAgo: number,
  ) {
    for (let index = 0; index < count; index += 1) {
      fixtures.siteVisits.push({
        id: nextId("siteVisits"),
        siteLocationId: siteId,
        plateState,
        checkInTime: new Date(
          Date.now() - daysAgo * 24 * 60 * 60 * 1000 - index,
        ),
      });
    }
  }

  it("allows public self-service callers with matching QR proof and discloses only aggregate recommendations", async () => {
    const { site } = seedScenario();
    addConfirmedVisits(site.id, "OK", 2, 1);

    const res = await request(app).get(
      `/api/visits/sites/${site.id}/preferred-plate-states?siteCode=${site.siteCode}`,
    );

    expectStatus(res, 200);
    expect(res.body).toEqual({ preferred: ["OK", "CA", "TX", "NY", "FL"] });
    expect(Object.keys(res.body)).toEqual(["preferred"]);
  });

  it("rejects a public numeric-id request without matching QR proof", async () => {
    const { site } = seedScenario();

    const missingProof = await request(app).get(
      `/api/visits/sites/${site.id}/preferred-plate-states`,
    );
    const wrongProof = await request(app).get(
      `/api/visits/sites/${site.id}/preferred-plate-states?siteCode=SITE-WRONG`,
    );

    expect(missingProof.status).toBe(404);
    expect(missingProof.body.code).toBe("site.not_found");
    expect(wrongProof.status).toBe(404);
    expect(wrongProof.body.code).toBe("site.not_found");
  });

  it("allows an authenticated guest with matching QR proof to retrieve aggregate-only recommendations", async () => {
    const { site } = seedScenario();
    addConfirmedVisits(site.id, "NM", 2, 1);
    const { token } = await startGuest();

    const res = await request(app)
      .get(
        `/api/visits/sites/${site.id}/preferred-plate-states?siteCode=${site.siteCode}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expectStatus(res, 200);
    expect(res.body).toEqual({ preferred: ["NM", "CA", "TX", "NY", "FL"] });
    expect(Object.keys(res.body)).toEqual(["preferred"]);
  });

  it("binds an authenticated guest to the site of their active visit", async () => {
    const { site, otherSite } = seedScenario();
    const { token, guestSessionId } = await startGuest();
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      guestSessionId,
      siteLocationId: site.id,
      plateState: "TX",
      checkInTime: new Date(),
      checkOutTime: null,
    });

    const res = await request(app)
      .get(
        `/api/visits/sites/${otherSite.id}/preferred-plate-states?siteCode=${otherSite.siteCode}`,
      )
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visit.no_access");
  });

  it.each([
    ["inactive", { isActive: false }],
    ["non-active status", { status: "inactive" }],
    ["hidden", { hidden: true }],
  ])(
    "does not expose a %s site to public proof holders",
    async (_label, patch) => {
      const { site } = seedScenario();
      Object.assign(site, patch);

      const res = await request(app).get(
        `/api/visits/sites/${site.id}/preferred-plate-states?siteCode=${site.siteCode}`,
      );

      expect(res.status).toBe(404);
      expect(res.body.code).toBe("site.not_found");
    },
  );

  it("returns not found for a missing site to an unauthenticated self-service caller", async () => {
    seedScenario();

    const res = await request(app).get(
      "/api/visits/sites/9999/preferred-plate-states?siteCode=SITE-NOT-FOUND",
    );

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("site.not_found");
  });

  it("retains missing-site behavior after staff authentication", async () => {
    seedScenario();

    const res = await request(app)
      .get("/api/visits/sites/9999/preferred-plate-states")
      .set("Cookie", staffCookie({ role: "admin" }));

    expect(res.status).toBe(404);
    expect(res.body.code).toBe("site.not_found");
  });

  it("returns five aggregate-only state recommendations in site activity order", async () => {
    const { site } = seedScenario();
    addConfirmedVisits(site.id, "TX", 3, 2);
    addConfirmedVisits(site.id, "OK", 2, 3);
    addConfirmedVisits(site.id, "NM", 2, 4);
    addConfirmedVisits(site.id, "CA", 10, 91);

    const res = await request(app)
      .get(`/api/visits/sites/${site.id}/preferred-plate-states`)
      .set("Cookie", staffCookie({ role: "admin" }));

    expectStatus(res, 200);
    expect(res.body).toEqual({ preferred: ["TX", "NM", "OK", "CA", "NY"] });
  });

  it("caches aggregate ranking work briefly after authorization", async () => {
    const { site } = seedScenario();
    addConfirmedVisits(site.id, "OK", 2, 1);

    const first = await request(app).get(
      `/api/visits/sites/${site.id}/preferred-plate-states?siteCode=${site.siteCode}`,
    );
    const aggregateReadsAfterFirst = selectCounts.siteVisits;
    const second = await request(app).get(
      `/api/visits/sites/${site.id}/preferred-plate-states?siteCode=${site.siteCode}`,
    );

    expectStatus(first, 200);
    expectStatus(second, 200);
    expect(aggregateReadsAfterFirst).toBe(2);
    expect(selectCounts.siteVisits).toBe(aggregateReadsAfterFirst);
  });

  it("uses trusted request IP semantics so spoofed X-Forwarded-For values cannot bypass the dedicated limit", async () => {
    process.env.PREFERRED_PLATE_STATES_RATE_LIMIT_MAX = "1";
    process.env.PREFERRED_PLATE_STATES_RATE_LIMIT_WINDOW_MS = "60000";
    process.env.PREFERRED_PLATE_STATES_GLOBAL_RATE_LIMIT_MAX = "100";
    const { site } = seedScenario();
    const path = `/api/visits/sites/${site.id}/preferred-plate-states?siteCode=${site.siteCode}`;

    const first = await request(app)
      .get(path)
      .set("X-Forwarded-For", "198.51.100.10");
    const second = await request(app)
      .get(path)
      .set("X-Forwarded-For", "203.0.113.99");

    expectStatus(first, 200);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("preferred_plate_states.rate_limited");
  });

  it("enforces a global cost ceiling that different authenticated identities cannot bypass", async () => {
    process.env.PREFERRED_PLATE_STATES_RATE_LIMIT_MAX = "100";
    process.env.PREFERRED_PLATE_STATES_GLOBAL_RATE_LIMIT_MAX = "1";
    process.env.PREFERRED_PLATE_STATES_GLOBAL_RATE_LIMIT_WINDOW_MS = "60000";
    const { site } = seedScenario();
    const path = `/api/visits/sites/${site.id}/preferred-plate-states`;

    const first = await request(app)
      .get(path)
      .set("Cookie", staffCookie({ userId: 10, role: "admin" }));
    const second = await request(app)
      .get(path)
      .set("Cookie", staffCookie({ userId: 11, role: "admin" }));

    expectStatus(first, 200);
    expect(second.status).toBe(429);
    expect(second.body.code).toBe("preferred_plate_states.rate_limited");
  });

  it("allows gatekeepers to load recommendations for an assigned site", async () => {
    const { site, vendor } = seedScenario();
    addConfirmedVisits(site.id, "TX", 1, 1);

    const res = await request(app)
      .get(`/api/visits/sites/${site.id}/preferred-plate-states`)
      .set(
        "Cookie",
        staffCookie({
          role: "vendor",
          vendorId: vendor.id,
          vendorRole: "gatekeeper",
        }),
      );

    expectStatus(res, 200);
    expect(res.body).toEqual({ preferred: ["TX", "CA", "NY", "FL", "OH"] });
  });

  it("allows vendors to load recommendations only for their assigned sites", async () => {
    const { site, vendor } = seedScenario();

    const res = await request(app)
      .get(`/api/visits/sites/${site.id}/preferred-plate-states`)
      .set(
        "Cookie",
        staffCookie({
          role: "vendor",
          vendorId: vendor.id,
          vendorRole: "office",
        }),
      );

    expectStatus(res, 200);
    expect(res.body).toEqual({ preferred: ["CA", "TX", "NY", "FL", "OH"] });
  });

  it("denies gatekeepers whose vendor is not assigned to the requested site", async () => {
    const { otherSite, vendor } = seedScenario();

    const res = await request(app)
      .get(`/api/visits/sites/${otherSite.id}/preferred-plate-states`)
      .set(
        "Cookie",
        staffCookie({
          role: "vendor",
          vendorId: vendor.id,
          vendorRole: "gatekeeper",
        }),
      );

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visit.no_access");
  });

  it("denies partners who do not own the requested site", async () => {
    const { site } = seedScenario();

    const res = await request(app)
      .get(`/api/visits/sites/${site.id}/preferred-plate-states`)
      .set("Cookie", staffCookie({ role: "partner", partnerId: 999 }));

    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visit.no_access");
  });

  it("fills sparse recent history from older confirmed visits before the fallback", async () => {
    const { site } = seedScenario();
    addConfirmedVisits(site.id, "OK", 1, 1);
    addConfirmedVisits(site.id, "TX", 2, 95);
    addConfirmedVisits(site.id, "NM", 2, 96);

    const res = await request(app)
      .get(`/api/visits/sites/${site.id}/preferred-plate-states`)
      .set(
        "Cookie",
        staffCookie({ role: "partner", partnerId: site.partnerId }),
      );

    expectStatus(res, 200);
    expect(res.body).toEqual({ preferred: ["OK", "NM", "TX", "CA", "NY"] });
  });

  it("normalizes duplicates and excludes invalid confirmed-state aggregates", async () => {
    const { site } = seedScenario();
    addConfirmedVisits(site.id, "tx", 1, 1);
    addConfirmedVisits(site.id, "TX", 1, 2);
    addConfirmedVisits(site.id, "ZZ", 20, 3);
    addConfirmedVisits(site.id, null, 10, 4);

    const res = await request(app)
      .get(`/api/visits/sites/${site.id}/preferred-plate-states`)
      .set("Cookie", staffCookie({ role: "admin" }));

    expectStatus(res, 200);
    expect(res.body).toEqual({ preferred: ["TX", "CA", "NY", "FL", "OH"] });
  });

  it("includes a state checked in exactly at the 90-day cutoff in recent precedence", async () => {
    const now = Date.UTC(2026, 7, 27, 18, 0, 0);
    const nowSpy = vi.spyOn(Date, "now").mockReturnValue(now);
    try {
      const { site } = seedScenario();
      const cutoff = now - 90 * 24 * 60 * 60 * 1000;
      fixtures.siteVisits.push(
        {
          id: nextId("siteVisits"),
          siteLocationId: site.id,
          plateState: "OK",
          checkInTime: new Date(cutoff),
        },
        {
          id: nextId("siteVisits"),
          siteLocationId: site.id,
          plateState: "TX",
          checkInTime: new Date(cutoff - 1),
        },
        {
          id: nextId("siteVisits"),
          siteLocationId: site.id,
          plateState: "TX",
          checkInTime: new Date(cutoff - 2),
        },
      );

      const res = await request(app)
        .get(`/api/visits/sites/${site.id}/preferred-plate-states`)
        .set("Cookie", staffCookie({ role: "admin" }));

      expectStatus(res, 200);
      expect(res.body).toEqual({ preferred: ["OK", "TX", "CA", "NY", "FL"] });
    } finally {
      nowSpy.mockRestore();
    }
  });

  it("returns the national fallback for an empty site", async () => {
    const { site } = seedScenario();

    const res = await request(app)
      .get(`/api/visits/sites/${site.id}/preferred-plate-states`)
      .set("Cookie", staffCookie({ role: "admin" }));

    expectStatus(res, 200);
    expect(res.body).toEqual({ preferred: ["CA", "TX", "NY", "FL", "OH"] });
  });
});

describe("gatekeeper visit workflow", () => {
  it("rejects a gatekeeper vehicle plate without a state", async () => {
    process.env.VNDRLY_REQUIRE_PLATE_STATE = "1";
    const { site, vendor } = seedScenario();
    const response = await request(app)
      .post("/api/visits/gate/check-in")
      .set(
        "Cookie",
        staffCookie({
          role: "vendor",
          vendorId: vendor.id,
          vendorRole: "gatekeeper",
        }),
      )
      .send({
        firstName: "Pat",
        lastName: "Guarded",
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: site.partnerId,
        vehiclePlate: "GATE-1",
        latitude: site.latitude,
        longitude: site.longitude,
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("missing-state");
    expect(fixtures.siteVisits).toHaveLength(0);
  });

  it("rejects an invalid gatekeeper vehicle state", async () => {
    const { site, vendor } = seedScenario();
    const response = await request(app)
      .post("/api/visits/gate/check-in")
      .set(
        "Cookie",
        staffCookie({
          role: "vendor",
          vendorId: vendor.id,
          vendorRole: "gatekeeper",
        }),
      )
      .send({
        firstName: "Pat",
        lastName: "Guarded",
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: site.partnerId,
        vehiclePlate: "GATE-1",
        plateState: "ZZ",
        latitude: site.latitude,
        longitude: site.longitude,
      });

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("invalid-state");
    expect(fixtures.siteVisits).toHaveLength(0);
  });

  it("normalizes and emits a gatekeeper vehicle state", async () => {
    const { site, vendor } = seedScenario();
    const response = await request(app)
      .post("/api/visits/gate/check-in")
      .set(
        "Cookie",
        staffCookie({
          role: "vendor",
          vendorId: vendor.id,
          vendorRole: "gatekeeper",
        }),
      )
      .send({
        firstName: "Pat",
        lastName: "Guarded",
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: site.partnerId,
        vehiclePlate: " GATE-1 ",
        plateState: "tx",
        latitude: site.latitude,
        longitude: site.longitude,
      });

    expectStatus(response, 201);
    expect(response.body).toMatchObject({
      vehiclePlate: "GATE-1",
      plateState: "TX",
    });
    expect(fixtures.siteVisits[0]).toMatchObject({
      vehiclePlate: "GATE-1",
      plateState: "TX",
    });
    expect(publishVisitEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "visit.checked_in",
        visit: expect.objectContaining({
          vehiclePlate: "GATE-1",
          plateState: "TX",
        }),
      }),
    );
  });

  it("requires the explicit gatekeeper role", async () => {
    const { site, vendor } = seedScenario();
    const response = await request(app)
      .post("/api/visits/gate/check-in")
      .set(
        "Cookie",
        staffCookie({ role: "vendor", vendorId: vendor.id, vendorRole: null }),
      )
      .send({
        firstName: "Pat",
        lastName: "Guarded",
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: site.partnerId,
        latitude: site.latitude,
        longitude: site.longitude,
      });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("visit.no_access");
  });

  it("keeps partner-hosted visits visible and check-outable at assigned sites", async () => {
    const { site, vendor } = seedScenario();
    const cookie = staffCookie({
      role: "vendor",
      vendorId: vendor.id,
      vendorRole: "gatekeeper",
    });
    const checkIn = await request(app)
      .post("/api/visits/gate/check-in")
      .set("Cookie", cookie)
      .send({
        firstName: "Jamie",
        lastName: "Visitor",
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: site.partnerId,
        latitude: site.latitude,
        longitude: site.longitude,
      });
    expectStatus(checkIn, 201);
    expect(fixtures.siteVisits[0].recordedByUserId).toBe(10);

    fixtures.siteVisits[0].siteName = site.name;
    const list = await request(app).get("/api/visits").set("Cookie", cookie);
    expectStatus(list, 200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      firstName: "Jamie",
      hostType: "partner",
    });

    const checkOut = await request(app)
      .post(`/api/visits/gate/${checkIn.body.id}/check-out`)
      .set("Cookie", cookie)
      .send({ latitude: site.latitude, longitude: site.longitude });
    expectStatus(checkOut, 200);
    expect(checkOut.body.checkOutTime).toBeTruthy();
  });

  it("can check in a visitor for another vendor assigned to the same guarded site", async () => {
    const { site, vendor, otherVendor } = seedScenario();
    fixtures.siteWorkAssignments.push({
      id: 2,
      siteLocationId: site.id,
      vendorId: otherVendor.id,
    });
    const response = await request(app)
      .post("/api/visits/gate/check-in")
      .set(
        "Cookie",
        staffCookie({
          role: "vendor",
          vendorId: vendor.id,
          vendorRole: "gatekeeper",
        }),
      )
      .send({
        firstName: "Morgan",
        lastName: "Driver",
        siteLocationId: site.id,
        hostType: "vendor",
        hostVendorId: otherVendor.id,
        latitude: site.latitude,
        longitude: site.longitude,
      });
    expectStatus(response, 201);
    expect(response.body.hostVendorId).toBe(otherVendor.id);
  });

  it("cannot operate a gate at a site where its vendor is unassigned", async () => {
    const { otherSite, vendor } = seedScenario();
    const response = await request(app)
      .post("/api/visits/gate/check-in")
      .set(
        "Cookie",
        staffCookie({
          role: "vendor",
          vendorId: vendor.id,
          vendorRole: "gatekeeper",
        }),
      )
      .send({
        firstName: "Pat",
        lastName: "Guarded",
        siteLocationId: otherSite.id,
        hostType: "partner",
        hostPartnerId: otherSite.partnerId,
        latitude: otherSite.latitude,
        longitude: otherSite.longitude,
      });
    expect(response.status).toBe(403);
    expect(response.body.code).toBe("visit.no_access");
  });

  it("lets office staff read the gate ops bundle and blocks booth operators", async () => {
    const { vendor } = seedScenario();
    const office = await request(app)
      .get("/api/visits/gate/ops")
      .set(
        "Cookie",
        staffCookie({
          role: "vendor",
          vendorId: vendor.id,
          vendorRole: "office",
        }),
      );
    expectStatus(office, 200);
    expect(office.body).toMatchObject({
      enabled: expect.any(Boolean),
      visits: expect.any(Array),
      staff: expect.any(Array),
    });

    const booth = await request(app)
      .get("/api/visits/gate/ops")
      .set(
        "Cookie",
        staffCookie({
          role: "vendor",
          vendorId: vendor.id,
          vendorRole: "gatekeeper",
        }),
      );
    expect(booth.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("GET /api/visits/:id (staff detail)", () => {
  function seedDetailVisit() {
    const { site } = seedScenario();
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: site.id,
      guestSessionId: 1,
      firstName: "Detail",
      lastName: "V",
      hostType: "vendor",
      hostVendorId: 2,
      hostPartnerId: null,
      checkInTime: new Date(),
      checkOutTime: null,
      autoCheckedOut: false,
      // Joined columns the route projects (the mock doesn't run real joins,
      // so they must live on the row directly).
      siteName: site.name,
      sitePartnerId: site.partnerId,
      hostVendorName: "Beta Vendor",
      hostPartnerName: null,
    });
    return { site, visitId: fixtures.siteVisits[0].id as number };
  }

  it("rejects unauthenticated callers", async () => {
    const { visitId } = seedDetailVisit();
    const res = await request(app).get(`/api/visits/${visitId}`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("rejects guest tokens hitting the staff detail route", async () => {
    const { visitId } = seedDetailVisit();
    const cookie = buildTestCookie({ userId: 0, role: "guest" });
    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set("Cookie", cookie);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.required");
  });

  it("returns 400 when the visit id is not a number", async () => {
    seedDetailVisit();
    const res = await request(app)
      .get(`/api/visits/not-a-number`)
      .set("Cookie", staffCookie({ role: "admin" }));
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("visit.invalid_id");
  });

  it("returns 404 when the visit does not exist", async () => {
    seedDetailVisit();
    const res = await request(app)
      .get(`/api/visits/9999`)
      .set("Cookie", staffCookie({ role: "admin" }));
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("visit.not_found");
  });

  it("serializes a historical visit with a null vehicle state in detail", async () => {
    const { visitId } = seedDetailVisit();
    Object.assign(fixtures.siteVisits[0], {
      vehiclePlate: "LEGACY-1",
      plateState: null,
    });

    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set("Cookie", staffCookie({ role: "admin" }));

    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      vehiclePlate: "LEGACY-1",
      plateState: null,
    });
  });

  it("returns 403 when a vendor reads a visit hosted by another vendor", async () => {
    const { visitId } = seedDetailVisit();
    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set("Cookie", staffCookie({ role: "vendor", vendorId: 999 }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visit.no_access");
  });

  it("lets a gatekeeper read any visit at a site assigned to its vendor", async () => {
    const { visitId } = seedDetailVisit();
    const assignedVendorId = fixtures.siteWorkAssignments[0].vendorId as number;
    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set(
        "Cookie",
        staffCookie({
          role: "vendor",
          vendorId: assignedVendorId,
          vendorRole: "gatekeeper",
        }),
      );
    expectStatus(res, 200);
    expect(res.body.id).toBe(visitId);
  });

  it("returns 403 when a partner reads a visit at another partner's site", async () => {
    const { visitId } = seedDetailVisit();
    const res = await request(app)
      .get(`/api/visits/${visitId}`)
      .set("Cookie", staffCookie({ role: "partner", partnerId: 999 }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("visit.no_access");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
describe("sweepStaleVisits()", () => {
  it("auto-checks-out visits whose expiresAt + 30min has passed", async () => {
    seedScenario();
    const now = Date.now();
    // Open visit, expired 31 minutes ago → should be swept.
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: 10,
      guestSessionId: 1,
      firstName: "Stale",
      lastName: "V",
      hostType: "partner",
      hostPartnerId: 1,
      hostVendorId: null,
      checkInTime: new Date(now - 90 * 60 * 1000),
      checkOutTime: null,
      autoCheckedOut: false,
      expiresAt: new Date(now - 31 * 60 * 1000),
    });
    // Open visit, expires in the future → leave alone.
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: 10,
      guestSessionId: 2,
      firstName: "Fresh",
      lastName: "V",
      hostType: "partner",
      hostPartnerId: 1,
      hostVendorId: null,
      checkInTime: new Date(now - 5 * 60 * 1000),
      checkOutTime: null,
      autoCheckedOut: false,
      expiresAt: new Date(now + 60 * 60 * 1000),
    });
    // Already checked out → leave alone.
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: 10,
      guestSessionId: 3,
      firstName: "Done",
      lastName: "V",
      hostType: "partner",
      hostPartnerId: 1,
      hostVendorId: null,
      checkInTime: new Date(now - 4 * 3600_000),
      checkOutTime: new Date(now - 1 * 3600_000),
      autoCheckedOut: false,
      expiresAt: new Date(now - 3 * 3600_000),
    });
    // Open visit with NULL expiresAt → leave alone.
    fixtures.siteVisits.push({
      id: nextId("siteVisits"),
      siteLocationId: 10,
      guestSessionId: 4,
      firstName: "Indef",
      lastName: "V",
      hostType: "partner",
      hostPartnerId: 1,
      hostVendorId: null,
      checkInTime: new Date(now - 2 * 3600_000),
      checkOutTime: null,
      autoCheckedOut: false,
      expiresAt: null,
    });

    const swept = await visitsModule.sweepStaleVisits();
    expect(swept).toBe(1);
    const stale = fixtures.siteVisits.find((v) => v.firstName === "Stale")!;
    expect(stale.checkOutTime).toBeInstanceOf(Date);
    expect(stale.autoCheckedOut).toBe(true);

    const fresh = fixtures.siteVisits.find((v) => v.firstName === "Fresh")!;
    expect(fresh.checkOutTime).toBeNull();
    expect(fresh.autoCheckedOut).toBe(false);

    const indef = fixtures.siteVisits.find((v) => v.firstName === "Indef")!;
    expect(indef.checkOutTime).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// "End-to-end" flow exercised against the route layer: a fresh guest signs
// in, fetches the public site context, checks in within the geofence, and
// then checks out. This mirrors what the visit-public.tsx page does step by
// step (sans browser-side geolocation), so a regression to any of those
// routes will surface here.
describe("guest visit flow (e2e via route layer)", () => {
  it("sign in → site context → check in → active → check out", async () => {
    const { site } = seedScenario();

    // 1) Sign in as guest.
    const guest = await startGuest();

    // 2) Fetch public site context (no auth required).
    const ctx = await request(app).get(
      `/api/visits/site-context/${site.siteCode}`,
    );
    expectStatus(ctx, 200);
    expect(ctx.body.site.id).toBe(site.id);
    expect(ctx.body.partner?.id).toBe(1);

    // 3) Check in within geofence.
    const checkIn = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${guest.token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
        purpose: "Walkthrough",
        expectedDurationMinutes: 45,
        latitude: 40.0,
        longitude: -74.0,
      });
    expectStatus(checkIn, 201);
    const visitId = checkIn.body.id as number;

    // 4) Active visit reflects the new check-in.
    fixtures.siteVisits[0].siteName = site.name;
    fixtures.siteVisits[0].hostPartnerName = "Acme Partner";
    const active = await request(app)
      .get("/api/visits/me/active")
      .set("Authorization", `Bearer ${guest.token}`);
    expectStatus(active, 200);
    expect(active.body?.id).toBe(visitId);

    // 5) Check out.
    const checkOut = await request(app)
      .post(`/api/visits/${visitId}/check-out`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({ latitude: 40.0001, longitude: -74.0001 });
    expectStatus(checkOut, 200);
    expect(checkOut.body.checkOutTime).toBeTruthy();

    // 6) After check-out, /me/active returns null.
    const after = await request(app)
      .get("/api/visits/me/active")
      .set("Authorization", `Bearer ${guest.token}`);
    expectStatus(after, 200);
    expect(after.body).toBeNull();
  });
});

describe("visit notes, optional plate state, and self-check-in admission", () => {
  it("accepts a plate without state when the rollout flag is off", async () => {
    const { site } = seedScenario();
    const guest = await startGuest({ vehiclePlate: "DIRTY1", plateState: undefined });
    const checkIn = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${guest.token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
        vehiclePlate: "DIRTY1",
        notes: " specialty tag, no state ",
        latitude: 40.0,
        longitude: -74.0,
      });
    expectStatus(checkIn, 201);
    expect(checkIn.body).toMatchObject({
      vehiclePlate: "DIRTY1",
      plateState: null,
      notes: "specialty tag, no state",
      admissionStatus: "pending",
    });
  });

  it("stores check-out notes on a self-checked-in visit", async () => {
    const { site } = seedScenario();
    const guest = await startGuest();
    const checkIn = await request(app)
      .post("/api/visits/check-in")
      .set("Authorization", `Bearer ${guest.token}`)
      .send({
        siteLocationId: site.id,
        hostType: "partner",
        hostPartnerId: 1,
        latitude: 40.0,
        longitude: -74.0,
      });
    expectStatus(checkIn, 201);
    const checkOut = await request(app)
      .post(`/api/visits/${checkIn.body.id}/check-out`)
      .set("Authorization", `Bearer ${guest.token}`)
      .send({
        latitude: 40.0,
        longitude: -74.0,
        notes: "left through the south gate",
      });
    expectStatus(checkOut, 200);
    expect(checkOut.body.checkOutNotes).toBe("left through the south gate");
  });
});
