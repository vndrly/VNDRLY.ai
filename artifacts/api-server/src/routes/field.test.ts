import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// Coverage for Task #735 — DELETE /api/field-employees/:id/login
// (the field-employee unassign endpoint) MUST sign the removed
// employee out by bumping `users.sessionVersion`. The work happens
// inside `removeMembership()` (see lib/membership-sync.ts), but
// without a regression test pinning the field-employee path down a
// future refactor could quietly stop calling `removeMembership()`
// and we'd only notice when a removed field employee kept submitting
// tickets with their old token. The partner/vendor side has the
// equivalent coverage in orgMembers.test.ts under the
// "DELETE /api/orgs/:orgType/:orgId/members/:membershipId" describe
// block — this test file mirrors those assertions for the
// field-employee unassign route.
//
// Implementation notes:
//   * The route deletes the underlying `users` row at the end of the
//     same handler call (it's a "disable credentials" endpoint, not a
//     pure membership-removal endpoint), so by the time the test sees
//     a response the user fixture is gone. To assert the bump landed
//     we capture deleted users in a side-channel (`deletedUsers`)
//     during the in-memory delete and read `sessionVersion` from
//     there. This intentionally exercises the production order of
//     operations: removeMembership() runs first (and bumps), then
//     the row is deleted.
//   * The drizzle / @workspace/db mock is a trimmed-down version of
//     the predicate-aware store used in orgMembers.test.ts — only the
//     tables this endpoint actually reads/writes (users,
//     user_org_memberships, vendor_people, vendors) are wired up.

type Row = Record<string, any>;
type ColRef = { __table: string; __col: string };
type Pred =
  | { kind: "eq"; col: ColRef; val: any }
  | { kind: "isNull"; col: ColRef }
  | { kind: "isNotNull"; col: ColRef }
  | { kind: "inArray"; col: ColRef; arr: any[] }
  | { kind: "and"; preds: Pred[] }
  | { kind: "true" };

function tableTag(name: string, cols: string[]) {
  const t: any = { __name: name };
  for (const c of cols) t[c] = { __table: name, __col: c };
  return t;
}

const tables = {
  users: tableTag("users", [
    "id",
    "username",
    "passwordHash",
    "role",
    "displayName",
    "preferredLanguage",
    "activeMembershipId",
    "sessionVersion",
    "createdAt",
  ]),
  userOrgMemberships: tableTag("userOrgMemberships", [
    "id",
    "userId",
    "orgType",
    "partnerId",
    "vendorId",
    "role",
    "vendorPeopleId",
    "createdAt",
  ]),
  vendors: tableTag("vendors", ["id", "name", "logoUrl"]),
  vendorPeople: tableTag("vendorPeople", [
    "id",
    "vendorId",
    "userId",
    "firstName",
    "lastName",
    "email",
    "isActive",
    "deletedAt",
  ]),
};

const fixtures: Record<string, Row[]> = {
  users: [],
  userOrgMemberships: [],
  vendors: [],
  vendorPeople: [],
};

// Side-channel for deleted users so the bump assertion still works
// even though the route deletes the user row at the end of the
// handler. See the file-level comment for context.
let deletedUsers: Row[] = [];

const idCounters: Record<string, number> = {};
function nextId(t: string) {
  idCounters[t] = (idCounters[t] ?? 0) + 1;
  return idCounters[t];
}

type TaggedRow = Record<string, Row | null>;

function readFromTagged(row: TaggedRow, c: ColRef | undefined): any {
  if (!c || typeof c !== "object") return undefined;
  const tableRow = row[c.__table];
  if (tableRow == null) return undefined;
  return tableRow[c.__col];
}

function evalPred(pred: Pred | undefined, row: TaggedRow): boolean {
  if (!pred) return true;
  switch (pred.kind) {
    case "true":
      return true;
    case "eq": {
      const lhs = readFromTagged(row, pred.col);
      const rhs =
        pred.val && typeof pred.val === "object" && pred.val.__col
          ? readFromTagged(row, pred.val as ColRef)
          : pred.val;
      if (lhs == null && rhs == null) return false;
      return lhs === rhs;
    }
    case "isNull":
      return readFromTagged(row, pred.col) == null;
    case "isNotNull":
      return readFromTagged(row, pred.col) != null;
    case "inArray": {
      const v = readFromTagged(row, pred.col);
      return pred.arr.includes(v);
    }
    case "and":
      return pred.preds.every((p) => evalPred(p, row));
  }
}

function projectRow(
  row: TaggedRow,
  cols: Record<string, ColRef> | undefined,
): Row {
  if (!cols) {
    const keys = Object.keys(row);
    return keys.length ? { ...(row[keys[0]] ?? {}) } : {};
  }
  const out: Row = {};
  for (const [k, c] of Object.entries(cols)) {
    out[k] = readFromTagged(row, c);
  }
  return out;
}

interface JoinSpec {
  type: "inner" | "left";
  table: string;
  on: Pred;
}

function makeQuery(
  initialTable: string,
  cols: Record<string, ColRef> | undefined,
) {
  const joins: JoinSpec[] = [];
  let where: Pred | undefined;
  let orderBy: { col: ColRef; dir: "asc" | "desc" }[] = [];
  let limitN: number | undefined;

  const run = () => {
    let combined: TaggedRow[] = (fixtures[initialTable] ?? []).map((r) => ({
      [initialTable]: r,
    }));
    for (const j of joins) {
      const next: TaggedRow[] = [];
      for (const left of combined) {
        let matched = false;
        for (const right of fixtures[j.table] ?? []) {
          const trial: TaggedRow = { ...left, [j.table]: right };
          if (evalPred(j.on, trial)) {
            next.push(trial);
            matched = true;
          }
        }
        if (j.type === "left" && !matched) {
          next.push({ ...left, [j.table]: null });
        }
      }
      combined = next;
    }
    let filtered = combined.filter((r) => evalPred(where, r));
    if (orderBy.length) {
      filtered.sort((a, b) => {
        for (const ob of orderBy) {
          const av = readFromTagged(a, ob.col);
          const bv = readFromTagged(b, ob.col);
          if (av == null && bv == null) continue;
          if (av == null) return ob.dir === "asc" ? -1 : 1;
          if (bv == null) return ob.dir === "asc" ? 1 : -1;
          if (av < bv) return ob.dir === "asc" ? -1 : 1;
          if (av > bv) return ob.dir === "asc" ? 1 : -1;
        }
        return 0;
      });
    }
    if (limitN != null) filtered = filtered.slice(0, limitN);
    return filtered.map((r) => projectRow(r, cols));
  };

  const q: any = {
    leftJoin: (t: any, on: Pred) => {
      joins.push({ type: "left", table: t.__name, on });
      return q;
    },
    innerJoin: (t: any, on: Pred) => {
      joins.push({ type: "inner", table: t.__name, on });
      return q;
    },
    where: (p: Pred) => {
      where = p;
      return q;
    },
    orderBy: (...args: any[]) => {
      for (const a of args) {
        if (a && a.__orderBy) orderBy.push(a.__orderBy);
        else if (a && a.__col) orderBy.push({ col: a, dir: "asc" });
      }
      return q;
    },
    limit: (n: number) => {
      limitN = n;
      return q;
    },
    then: (resolve: any, reject?: any) =>
      Promise.resolve(run()).then(resolve, reject),
    catch: (reject: any) => Promise.resolve(run()).catch(reject),
  };
  return q;
}

function applyDefaults(tableName: string, v: Row): Row {
  const defaults: Row = {};
  if (tableName === "userOrgMemberships") {
    defaults.partnerId = v.partnerId ?? null;
    defaults.vendorId = v.vendorId ?? null;
    defaults.vendorPeopleId = v.vendorPeopleId ?? null;
    defaults.createdAt = new Date();
  }
  if (tableName === "users") {
    defaults.activeMembershipId = v.activeMembershipId ?? null;
    defaults.preferredLanguage = v.preferredLanguage ?? null;
    defaults.displayName = v.displayName ?? v.username ?? "";
    defaults.sessionVersion = v.sessionVersion ?? 1;
    defaults.createdAt = new Date();
  }
  return { ...defaults, ...v };
}

function makeInsert(t: any) {
  const tableName = t.__name;
  return {
    values: (v: Row | Row[]) => {
      const valsArr = Array.isArray(v) ? v : [v];
      let returningCols: Record<string, ColRef> | undefined;

      const doRun = () => {
        const inserted: Row[] = [];
        for (const raw of valsArr) {
          const row = applyDefaults(tableName, raw);
          row.id = nextId(tableName);
          fixtures[tableName].push(row);
          inserted.push(row);
        }
        if (returningCols) {
          return inserted.map((r) => {
            const out: Row = {};
            for (const [k, c] of Object.entries(returningCols!)) {
              out[k] = r[c.__col];
            }
            return out;
          });
        }
        return inserted;
      };

      const chain: any = {
        returning: (cols?: Record<string, ColRef>) => {
          returningCols = cols;
          return Promise.resolve(doRun());
        },
        onConflictDoNothing: (_target?: any) => chain,
        then: (resolve: any, reject?: any) =>
          Promise.resolve(doRun()).then(resolve, reject),
      };
      return chain;
    },
  };
}

function makeUpdate(t: any) {
  const tableName = t.__name;
  return {
    set: (s: Row) => {
      const where = (p?: Pred) => {
        let resolved = false;
        let updated: Row[] = [];
        const ensure = () => {
          if (!resolved) {
            updated = (fixtures[tableName] ?? []).filter((r) =>
              evalPred(p, { [tableName]: r }),
            );
            for (const m of updated) {
              const resolvedSet: Row = {};
              for (const [k, v] of Object.entries(s)) {
                if (
                  v &&
                  typeof v === "object" &&
                  (v as { kind?: string }).kind === "increment"
                ) {
                  const inc = v as unknown as { col: ColRef; by: number };
                  const cur = (m[inc.col.__col] as number | null) ?? 0;
                  resolvedSet[k] = cur + inc.by;
                } else {
                  resolvedSet[k] = v;
                }
              }
              Object.assign(m, resolvedSet);
            }
            resolved = true;
          }
          return updated;
        };
        const ret: any = {
          returning: (_cols?: any) => Promise.resolve(ensure()),
          then: (resolve: any, reject?: any) =>
            Promise.resolve(ensure()).then(resolve, reject),
          catch: (reject: any) => Promise.resolve(ensure()).catch(reject),
        };
        return ret;
      };
      return { where };
    },
  };
}

function makeDelete(t: any) {
  const tableName = t.__name;
  return {
    where: (p?: Pred) => {
      let resolved = false;
      let removedRows: Row[] = [];
      const ensure = () => {
        if (!resolved) {
          const before = fixtures[tableName] ?? [];
          const remaining: Row[] = [];
          for (const r of before) {
            if (evalPred(p, { [tableName]: r })) {
              removedRows.push(r);
            } else {
              remaining.push(r);
            }
          }
          fixtures[tableName] = remaining;
          // Mirror the production FK ON DELETE SET NULL on
          // users.activeMembershipId so removeMembership()'s
          // re-pointing branch behaves the same way it does in
          // production.
          if (tableName === "userOrgMemberships") {
            const removedIds = new Set(removedRows.map((r) => r.id));
            for (const u of fixtures.users ?? []) {
              if (
                u.activeMembershipId != null &&
                removedIds.has(u.activeMembershipId)
              ) {
                u.activeMembershipId = null;
              }
            }
          }
          // Remember every deleted user row so the post-handler test
          // can still inspect the user's `sessionVersion` value as it
          // stood at the moment removeMembership() bumped it. The
          // route deletes the user immediately after that bump, so
          // without this side-channel the assertion would have
          // nothing to read.
          if (tableName === "users") {
            for (const r of removedRows) deletedUsers.push(r);
          }
          resolved = true;
        }
        return removedRows;
      };
      const ret: any = {
        returning: (_cols?: any) => Promise.resolve(ensure()),
        then: (resolve: any, reject?: any) =>
          Promise.resolve(ensure()).then(resolve, reject),
      };
      return ret;
    },
  };
}

function buildDb() {
  const db: any = {
    select: (cols?: Record<string, ColRef>) => ({
      from: (t: any) => makeQuery(t.__name, cols),
    }),
    insert: (t: any) => makeInsert(t),
    update: (t: any) => makeUpdate(t),
    delete: (t: any) => makeDelete(t),
    transaction: async <T,>(cb: (tx: any) => Promise<T>): Promise<T> => {
      // Simple in-memory transaction: no rollback semantics needed
      // for this test — the unassign endpoint's transaction body
      // just delete-then-update against the same fixtures we already
      // mutate elsewhere.
      return cb(db);
    },
  };
  return db;
}

const mockedDb = buildDb();

vi.mock("@workspace/db", () => ({
  db: mockedDb,
  pool: { query: vi.fn(async () => ({ rows: [] })) },
  usersTable: tables.users,
  userOrgMembershipsTable: tables.userOrgMemberships,
  vendorsTable: tables.vendors,
  vendorPeopleTable: tables.vendorPeople,
  // Provide tagged stubs for the other tables `field.ts` imports so
  // module load doesn't blow up. None of them are touched by the
  // unassign endpoint under test.
  siteLocationsTable: tableTag("siteLocations", []),
  partnersTable: tableTag("partners", []),
  siteWorkAssignmentsTable: tableTag("siteWorkAssignments", []),
  workTypesTable: tableTag("workTypes", []),
  ticketsTable: tableTag("tickets", []),
  gpsLogsTable: tableTag("gpsLogs", []),
  fieldPushTokensTable: tableTag("fieldPushTokens", []),
  // Task #51 — referenced by unread-comments.ts subqueries that the
  // tickets/field router imports. Unused by the unassign endpoint
  // under test; supplied so module load doesn't blow up.
  ticketNoteLogsTable: tableTag("ticketNoteLogs", []),
  hotlistCommentsTable: tableTag("hotlistComments", []),
  commentReadReceiptsTable: tableTag("commentReadReceipts", []),
}));

vi.mock("drizzle-orm", () => {
  const passthrough = (..._args: any[]) => ({ kind: "true" } as Pred);
  const eq = (col: ColRef, val: any): Pred => ({ kind: "eq", col, val });
  const isNull = (col: ColRef): Pred => ({ kind: "isNull", col });
  const isNotNull = (col: ColRef): Pred => ({ kind: "isNotNull", col });
  const inArray = (col: ColRef, arr: any[]): Pred => ({
    kind: "inArray",
    col,
    arr,
  });
  const and = (...preds: Pred[]): Pred => ({
    kind: "and",
    preds: preds.filter(Boolean) as Pred[],
  });
  const asc = (col: ColRef) => ({ __orderBy: { col, dir: "asc" as const } });
  const desc = (col: ColRef) => ({ __orderBy: { col, dir: "desc" as const } });
  const sqlTag: any = (strings: any, ...values: any[]) => {
    if (Array.isArray(strings) && (strings as any).raw !== undefined) {
      // Recognize the `${col} + N` increment pattern used by
      // removeMembership() to bump users.sessionVersion. Resolved
      // per-row in makeUpdate.
      if (
        (strings as string[]).length === 2 &&
        values.length === 1 &&
        values[0] &&
        typeof values[0].__col === "string"
      ) {
        const incMatch = (strings as string[])[1].match(/^\s*\+\s*(\d+)\s*$/);
        if (incMatch) {
          return {
            kind: "increment",
            col: values[0] as ColRef,
            by: Number(incMatch[1]),
          };
        }
      }
    }
    return { kind: "true" };
  };
  sqlTag.raw = passthrough;
  return {
    eq,
    and,
    isNull,
    isNotNull,
    inArray,
    asc,
    desc,
    sql: sqlTag,
    ne: passthrough,
    lt: passthrough,
    gte: passthrough,
  };
});

// The unassign endpoint never sends push notifications, but the
// router file imports the helper unconditionally — stub it so the
// module load doesn't try to talk to Expo.
vi.mock("../lib/expo-push", () => ({
  sendPushToFieldEmployee: vi.fn(async () => undefined),
}));

// Bcrypt is imported by the same file but not exercised by this
// endpoint — stub it so module load doesn't pull in the real binary.
vi.mock("bcryptjs", () => ({
  default: {
    hashSync: (pw: string) => `hashed:${pw}`,
    compare: async (pw: string, hash: string) => hash === `hashed:${pw}`,
  },
  hashSync: (pw: string) => `hashed:${pw}`,
  compare: async (pw: string, hash: string) => hash === `hashed:${pw}`,
}));

function adminCookie(userId = 1) {
  return buildTestCookie({
    userId,
    role: "admin",
    partnerId: null,
    vendorId: null,
  });
}

function vendorCookie(userId: number, vendorId: number) {
  return buildTestCookie({
    userId,
    role: "vendor",
    partnerId: null,
    vendorId,
    membershipRole: "admin",
  });
}

let app: express.Express;

beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  for (const k of Object.keys(idCounters)) idCounters[k] = 0;
  deletedUsers = [];

  vi.resetModules();
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

// ─────────────────────────────────────────────────────────────────────────────
// Seed helpers — seed a vendor, a field-employee row, the underlying
// `users` login row, and a field_employee membership linking them.
// Mirrors what POST /api/field-employees/:id/login produces in
// production so the DELETE handler's queries find the same shape it
// would in real life.

function seedVendor(id: number, name = `Vendor ${id}`) {
  const v = { id, name, logoUrl: null };
  fixtures.vendors.push(v);
  return v;
}

function seedFieldEmployeeWithLogin(opts: {
  vendorId: number;
  email: string;
  firstName?: string;
  lastName?: string;
}) {
  const user: Row = {
    id: nextId("users"),
    username: opts.email,
    passwordHash: `hashed:${opts.email}-pw`,
    role: "field_employee",
    displayName: `${opts.firstName ?? "Field"} ${opts.lastName ?? "Worker"}`,
    activeMembershipId: null,
    preferredLanguage: null,
    sessionVersion: 1,
    createdAt: new Date(),
  };
  fixtures.users.push(user);
  const employee: Row = {
    id: nextId("vendorPeople"),
    vendorId: opts.vendorId,
    userId: user.id,
    firstName: opts.firstName ?? "Field",
    lastName: opts.lastName ?? "Worker",
    email: opts.email,
    isActive: true,
    deletedAt: null,
  };
  fixtures.vendorPeople.push(employee);
  const membership: Row = {
    id: nextId("userOrgMemberships"),
    userId: user.id,
    orgType: "vendor",
    partnerId: null,
    vendorId: opts.vendorId,
    role: "field_employee",
    vendorPeopleId: employee.id,
    createdAt: new Date(),
  };
  fixtures.userOrgMemberships.push(membership);
  user.activeMembershipId = membership.id;
  return { user, employee, membership };
}

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/field-employees/:id/login — the field-employee unassign
// endpoint. The same flow exists for partner/vendor org members in
// orgMembers.test.ts; these tests pin down that the field-employee
// path also bumps users.sessionVersion via removeMembership() so a
// removed field employee's cached session token is rejected on the
// next request.

describe("DELETE /api/field-employees/:id/login (unassign signs the user out)", () => {
  it("bumps users.sessionVersion on the unassigned field employee so existing session tokens are invalidated", async () => {
    // Drive the vendor-session permission branch (not the system-admin
    // short-circuit) so the test exercises the same path a real vendor
    // admin would hit when removing a field employee from their
    // crew.
    const vendor = seedVendor(800, "Bump On Unassign Co");
    const vendorAdminUser: Row = {
      id: nextId("users"),
      username: "vendor-admin@example.com",
      passwordHash: "hashed:vendor-admin-pw",
      role: "vendor",
      displayName: "Vendor Admin",
      activeMembershipId: null,
      preferredLanguage: null,
      sessionVersion: 1,
      createdAt: new Date(),
    };
    fixtures.users.push(vendorAdminUser);
    const { user: fieldUser, employee, membership } =
      seedFieldEmployeeWithLogin({
        vendorId: vendor.id,
        email: "unassign-target@example.com",
        firstName: "Unassign",
        lastName: "Target",
      });
    // Sanity: the seed helper starts the field employee at
    // sessionVersion 1 (matching the production schema default), so any
    // post-DELETE value other than 2 means the increment didn't happen
    // — or happened twice.
    expect(fieldUser.sessionVersion).toBe(1);

    const delRes = await request(app)
      .delete(`/api/field-employees/${employee.id}/login`)
      .set("Cookie", vendorCookie(vendorAdminUser.id, vendor.id));
    expectStatus(delRes, 204);

    // The membership row was removed by removeMembership() — without
    // this we couldn't be sure the bump was the work of removeMembership
    // and not some unrelated update path.
    expect(
      fixtures.userOrgMemberships.find((m) => m.id === membership.id),
    ).toBeUndefined();

    // The route deletes the user row at the end of the handler, so the
    // bump's effect is visible in the side-channel snapshot taken at
    // delete time. Exactly one bump (1 → 2) — not zero, not two.
    const removedFieldUser = deletedUsers.find((u) => u.id === fieldUser.id);
    expect(removedFieldUser).toBeDefined();
    expect(removedFieldUser?.sessionVersion).toBe(2);

    // The vendor admin who triggered the unassignment is unaffected —
    // only the user whose access was revoked should be signed out.
    const refreshedAdmin = fixtures.users.find(
      (u) => u.id === vendorAdminUser.id,
    );
    expect(refreshedAdmin?.sessionVersion).toBe(1);

    // The vendor_people row is preserved (the employee still exists in
    // the directory), but its userId pointer is cleared so the now-
    // orphan login can't be resolved back to this person.
    const refreshedEmployee = fixtures.vendorPeople.find(
      (e) => e.id === employee.id,
    );
    expect(refreshedEmployee?.userId).toBeNull();
  });

  it("bumps users.sessionVersion even when the removed membership was the field employee's only one", async () => {
    // Sole-membership corner case mirroring the partner/vendor coverage
    // in orgMembers.test.ts. After the unassign the user has no
    // memberships left and the user row itself is deleted; even on this
    // path the bump must fire so any cached token issued before the
    // delete is rejected on the next request (the per-request session
    // guard compares the token's sessionVersion against the column).
    const vendor = seedVendor(801, "Sole Membership Co");
    const { user: fieldUser, employee, membership } =
      seedFieldEmployeeWithLogin({
        vendorId: vendor.id,
        email: "only-membership@example.com",
        firstName: "Only",
        lastName: "Membership",
      });
    // Confirm we set up the "only one" scenario — one membership for
    // this user before the call.
    expect(
      fixtures.userOrgMemberships.filter((m) => m.userId === fieldUser.id),
    ).toHaveLength(1);
    expect(fieldUser.sessionVersion).toBe(1);

    const delRes = await request(app)
      .delete(`/api/field-employees/${employee.id}/login`)
      .set("Cookie", adminCookie());
    expectStatus(delRes, 204);

    // No memberships remain for this user.
    expect(
      fixtures.userOrgMemberships.filter((m) => m.userId === fieldUser.id),
    ).toHaveLength(0);
    // …and the bump still fired on the way out so the cached token is
    // rejected on the next request — even though the user row itself
    // is now gone.
    expect(membership).toBeDefined();
    const removedFieldUser = deletedUsers.find((u) => u.id === fieldUser.id);
    expect(removedFieldUser).toBeDefined();
    expect(removedFieldUser?.sessionVersion).toBe(2);
  });
});
