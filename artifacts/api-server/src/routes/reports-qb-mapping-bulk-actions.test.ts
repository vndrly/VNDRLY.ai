import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import {
  fixtures,
  makeDrizzleMock,
  makeReportsDbMock,
  resetMockDb,
} from "../test/mock-reports-db";

// Tests for GET /reports/qb-account-mapping/bulk-actions. The handler
// returns recent bulk-apply / CSV-import actions, computes per-row
// `hasNewerOverlap` + `overlappingActionIds` from the loaded snapshots,
// and resolves `undoneByDisplayName` / `undoneByUsername` via a second
// users lookup. These tests pin down the snapshot-shape and scope-key
// logic so a future change to either silently regress the warning admins
// rely on before clicking Undo.
//
// The mock db treats `orderBy` as a no-op, so fixture rows must be
// pushed in newest-first order to mirror the handler's
// `desc(createdAt)` query. The handler trusts that order — its overlap
// detection assumes "smaller index = newer". The leftJoin on
// `usersTable` for the *actor* is also a no-op in the mock; tests that
// care about actor display name set those fields directly on the
// fixture row so they pass through. The undoneBy lookup is a real
// second `select().from(usersTable).where(inArray(...))` round-trip,
// which the mock supports — seeding `fixtures.users` resolves it.

vi.mock("@workspace/db", () => makeReportsDbMock());
vi.mock("drizzle-orm", () => makeDrizzleMock());



function adminCookie(userId = 7): string {
  const payload = {
    userId,
    role: "admin",
    displayName: "Admin User",
  };
  return buildTestCookie(payload);
}

let app: express.Express;

beforeEach(async () => {
  resetMockDb();
  vi.resetModules();
  const router = (await import("./reports")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

// Helper: build a snapshot entry for a single (vendor, partner, lineType)
// cell. `previous` is null to mirror the "bulk write inserted a brand-new
// row" path, which is the cheapest shape that still exercises snapshotKey.
function snap(
  vendorId: number | null,
  partnerId: number | null,
  lineType: string,
) {
  return {
    vendorId,
    partnerId,
    lineType,
    previous: null,
    applied: { accountName: "Acct", accountNumber: null },
  };
}

// Seed five rows in newest-first order:
//   id=10  Action A  scope {v=1,labor}            (newest)
//   id=9   Action B  scope {v=2,labor}            (no overlap with anything)
//   id=8   Action C  scope {v=1,labor}            (overlaps with A — newer)
//   id=7   Action D  scope {v=3,labor}            (no overlap with anything)
//   id=6   Action E  scope {v=1,labor}, undone    (overlap NOT computed)
//
// This shape covers every branch the task calls out: ordering, the
// overlap flag + ids, that undone rows skip overlap, and that the
// undoneBy user lookup populates display name + username.
function seedActions() {
  const base = Date.now();
  fixtures.qbAccountMappingBulkActions.push(
    {
      id: 10,
      kind: "bulk_apply",
      summary: "Action A",
      snapshots: [snap(1, null, "labor_regular")],
      actorUserId: 100,
      actorRole: "admin",
      actorDisplayName: "Alice Admin",
      actorUsername: "alice",
      createdAt: new Date(base - 1_000),
      undoneAt: null,
      undoneByUserId: null,
    },
    {
      id: 9,
      kind: "csv_import",
      summary: "Action B",
      snapshots: [snap(2, null, "labor_regular")],
      actorUserId: 100,
      actorRole: "admin",
      actorDisplayName: "Alice Admin",
      actorUsername: "alice",
      createdAt: new Date(base - 2_000),
      undoneAt: null,
      undoneByUserId: null,
    },
    {
      id: 8,
      kind: "bulk_apply",
      summary: "Action C",
      snapshots: [snap(1, null, "labor_regular")],
      actorUserId: 100,
      actorRole: "admin",
      actorDisplayName: "Alice Admin",
      actorUsername: "alice",
      createdAt: new Date(base - 3_000),
      undoneAt: null,
      undoneByUserId: null,
    },
    {
      id: 7,
      kind: "bulk_apply",
      summary: "Action D",
      snapshots: [snap(3, null, "labor_regular")],
      actorUserId: 100,
      actorRole: "admin",
      actorDisplayName: "Alice Admin",
      actorUsername: "alice",
      createdAt: new Date(base - 4_000),
      undoneAt: null,
      undoneByUserId: null,
    },
    {
      id: 6,
      kind: "bulk_apply",
      summary: "Action E (undone)",
      snapshots: [snap(1, null, "labor_regular")],
      actorUserId: 100,
      actorRole: "admin",
      actorDisplayName: "Alice Admin",
      actorUsername: "alice",
      createdAt: new Date(base - 5_000),
      undoneAt: new Date(base - 500),
      undoneByUserId: 200,
    },
  );
  fixtures.users.push(
    { id: 100, displayName: "Alice Admin", username: "alice" },
    { id: 200, displayName: "Bob Undoer", username: "bob" },
  );
}

describe("GET /api/reports/qb-account-mapping/bulk-actions", () => {
  it("returns rows in newest-first order with the right ids", async () => {
    seedActions();
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    expect(res.body.rows.map((r: { id: number }) => r.id)).toEqual([
      10, 9, 8, 7, 6,
    ]);
  });

  it("flags hasNewerOverlap=true on the older overlapping action and lists the newer action's id", async () => {
    seedActions();
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    const rowsById = new Map<
      number,
      { hasNewerOverlap: boolean; overlappingActionIds: number[] }
    >(
      res.body.rows.map(
        (r: {
          id: number;
          hasNewerOverlap: boolean;
          overlappingActionIds: number[];
        }) => [
          r.id,
          {
            hasNewerOverlap: r.hasNewerOverlap,
            overlappingActionIds: r.overlappingActionIds,
          },
        ],
      ),
    );
    // Action C (id=8) shares scope {v=1,labor_regular} with the newer
    // Action A (id=10), so overlap warns and points back to A.
    expect(rowsById.get(8)).toEqual({
      hasNewerOverlap: true,
      overlappingActionIds: [10],
    });
  });

  it("does NOT flag overlap on actions whose scope no newer action touches", async () => {
    seedActions();
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    const rowsById = new Map<
      number,
      { hasNewerOverlap: boolean; overlappingActionIds: number[] }
    >(
      res.body.rows.map(
        (r: {
          id: number;
          hasNewerOverlap: boolean;
          overlappingActionIds: number[];
        }) => [
          r.id,
          {
            hasNewerOverlap: r.hasNewerOverlap,
            overlappingActionIds: r.overlappingActionIds,
          },
        ],
      ),
    );
    // Newest action: nothing newer to overlap with.
    expect(rowsById.get(10)).toEqual({
      hasNewerOverlap: false,
      overlappingActionIds: [],
    });
    // Action B: scope {v=2} — A is newer but on {v=1}, so no overlap.
    expect(rowsById.get(9)).toEqual({
      hasNewerOverlap: false,
      overlappingActionIds: [],
    });
    // Action D: scope {v=3} — nothing else uses it.
    expect(rowsById.get(7)).toEqual({
      hasNewerOverlap: false,
      overlappingActionIds: [],
    });
  });

  it("never carries overlap on rows that have already been undone", async () => {
    seedActions();
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    const undone = res.body.rows.find(
      (r: { id: number }) => r.id === 6,
    ) as {
      id: number;
      undoneAt: string | null;
      hasNewerOverlap: boolean;
      overlappingActionIds: number[];
    };
    // Action E (id=6) shares scope with A and C, but because it was
    // already undone the handler must skip overlap computation entirely.
    expect(undone.undoneAt).not.toBeNull();
    expect(undone.hasNewerOverlap).toBe(false);
    expect(undone.overlappingActionIds).toEqual([]);
  });

  it("resolves undoneByDisplayName and undoneByUsername from the users table", async () => {
    seedActions();
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", adminCookie());
    expectStatus(res, 200);
    const undone = res.body.rows.find((r: { id: number }) => r.id === 6) as {
      undoneByUserId: number | null;
      undoneByDisplayName: string | null;
      undoneByUsername: string | null;
    };
    expect(undone.undoneByUserId).toBe(200);
    expect(undone.undoneByDisplayName).toBe("Bob Undoer");
    expect(undone.undoneByUsername).toBe("bob");

    // Non-undone rows must report null for the undoneBy fields even
    // though the same users row exists.
    const aliveRow = res.body.rows.find(
      (r: { id: number }) => r.id === 10,
    ) as {
      undoneByUserId: number | null;
      undoneByDisplayName: string | null;
      undoneByUsername: string | null;
    };
    expect(aliveRow.undoneByUserId).toBeNull();
    expect(aliveRow.undoneByDisplayName).toBeNull();
    expect(aliveRow.undoneByUsername).toBeNull();
  });

  // The "Show in mapping table" jump in the UI relies on the handler
  // reporting the unique vendor + partner ids snapshotted by each
  // action so the mapping card can pre-filter its dropdowns. We seed a
  // single action with snapshots that cover every interesting scope —
  // a non-null vendor, a non-null partner, the same vendor twice (to
  // exercise dedup), and a global (null,null) cell — and assert the
  // response carries:
  //   - ascending de-duplicated vendor / partner id lists
  //   - the includesGlobalVendor / includesGlobalPartner booleans set
  //     when at least one snapshot row scoped that side to NULL
  it("exposes deduplicated affected vendor/partner ids and the includesGlobal flags", async () => {
    const base = Date.now();
    fixtures.qbAccountMappingBulkActions.push({
      id: 11,
      kind: "bulk_apply",
      summary: "Mixed-scope action",
      snapshots: [
        snap(2, null, "labor_regular"),
        snap(1, null, "labor_regular"),
        snap(1, 5, "labor_regular"),
        snap(null, 7, "labor_regular"),
        snap(null, null, "labor_regular"),
      ],
      actorUserId: 100,
      actorRole: "admin",
      actorDisplayName: "Alice Admin",
      actorUsername: "alice",
      createdAt: new Date(base - 1_000),
      undoneAt: null,
      undoneByUserId: null,
    });
    fixtures.users.push({
      id: 100,
      displayName: "Alice Admin",
      username: "alice",
    });
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(200);
    const row = res.body.rows.find(
      (r: { id: number }) => r.id === 11,
    ) as {
      affectedVendorIds: number[];
      affectedPartnerIds: number[];
      affectedIncludesGlobalVendor: boolean;
      affectedIncludesGlobalPartner: boolean;
    };
    expect(row.affectedVendorIds).toEqual([1, 2]);
    expect(row.affectedPartnerIds).toEqual([5, 7]);
    expect(row.affectedIncludesGlobalVendor).toBe(true);
    expect(row.affectedIncludesGlobalPartner).toBe(true);
  });

  it("reports empty affected id lists and false includesGlobal flags when only one side is scoped", async () => {
    const base = Date.now();
    fixtures.qbAccountMappingBulkActions.push({
      id: 12,
      kind: "csv_import",
      summary: "Vendor-only CSV import",
      snapshots: [
        snap(4, null, "labor_regular"),
        snap(4, null, "labor_overtime"),
      ],
      actorUserId: 100,
      actorRole: "admin",
      actorDisplayName: "Alice Admin",
      actorUsername: "alice",
      createdAt: new Date(base - 1_000),
      undoneAt: null,
      undoneByUserId: null,
    });
    fixtures.users.push({
      id: 100,
      displayName: "Alice Admin",
      username: "alice",
    });
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(200);
    const row = res.body.rows.find(
      (r: { id: number }) => r.id === 12,
    ) as {
      affectedVendorIds: number[];
      affectedPartnerIds: number[];
      affectedIncludesGlobalVendor: boolean;
      affectedIncludesGlobalPartner: boolean;
    };
    // The vendor side was always scoped to vendor 4 (never null), so
    // includesGlobalVendor is false. The partner side was always
    // null, so the dropdown filter would fall back to "All partners":
    // affectedPartnerIds is empty and includesGlobalPartner is true.
    expect(row.affectedVendorIds).toEqual([4]);
    expect(row.affectedPartnerIds).toEqual([]);
    expect(row.affectedIncludesGlobalVendor).toBe(false);
    expect(row.affectedIncludesGlobalPartner).toBe(true);
  });

  it("rejects non-admins with 403", async () => {
    seedActions();
    const cookie = buildTestCookie({
      userId: 9,
      role: "vendor",
      vendorId: 1,
    });
    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", cookie);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.admin_required");
  });
});

// ─── Retention-window precedence on the list endpoint ─────────────
//
// The handler resolves `retentionDays` via the shared
// `getBulkActionRetentionDays()` helper, which prefers
// `platform_settings.qbBulkActionRetentionDays` over the env var, then
// the 90-day default. The UI's "Undo available for N more day(s)" copy
// is keyed off the value returned in `body.retentionDays` (and per-row
// `expiresAt`/`isExpired`/`expiresSoon` are derived from the same
// number), so a regression where the route silently dropped the DB
// override would leave the UI promising 90 days of undo while the
// cleanup worker was actually pruning at 7 — exactly the desync the
// task is meant to prevent.
//
// The mocked db's `select(cols)` returns full rows rather than
// projected columns, so we seed the retention value under the column
// alias the route reads (`days`), not the schema field name. See the
// comment in mock-reports-db.ts.
describe("GET /api/reports/qb-account-mapping/bulk-actions retention precedence", () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    originalEnv = process.env.QB_BULK_ACTION_RETENTION_DAYS;
  });

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.QB_BULK_ACTION_RETENTION_DAYS;
    } else {
      process.env.QB_BULK_ACTION_RETENTION_DAYS = originalEnv;
    }
  });

  it("returns the platform_settings override when set, beating env and the 90-day default", async () => {
    process.env.QB_BULK_ACTION_RETENTION_DAYS = "30";
    // Seed the singleton row with an admin-set 7-day window. The mock
    // doesn't project columns, so we expose the value under `days` —
    // the alias the resolver reads off the row.
    fixtures.platformSettings.push({ id: 1, days: 7 });
    seedActions();

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.retentionDays).toBe(7);
  });

  it("falls back to the env var when no platform_settings override exists", async () => {
    process.env.QB_BULK_ACTION_RETENTION_DAYS = "45";
    // No row inserted into platformSettings — the resolver should drop
    // through to the env-var fallback.
    seedActions();

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.retentionDays).toBe(45);
  });

  it("falls back to the 90-day default when both override and env are unset", async () => {
    delete process.env.QB_BULK_ACTION_RETENTION_DAYS;
    seedActions();

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.retentionDays).toBe(90);
  });

  it("treats a NULL platform_settings override as cleared (env wins)", async () => {
    // Admin had set a value, then cleared it back to "use the default".
    // The DB row still exists, but the override field is NULL. The
    // resolver must NOT treat NULL as 0 / clamp it / etc — it must
    // simply fall through to the env var.
    process.env.QB_BULK_ACTION_RETENTION_DAYS = "21";
    fixtures.platformSettings.push({ id: 1, days: null });
    seedActions();

    const res = await request(app)
      .get("/api/reports/qb-account-mapping/bulk-actions")
      .set("Cookie", adminCookie());
    expect(res.status).toBe(200);
    expect(res.body.retentionDays).toBe(21);
  });
});
