import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware, expectStatus } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";

// ── Predicate-aware in-memory store with joins, projection, and unique-index
// enforcement.
//
// These regression tests verify that the routes which "find users in an
// org" (`findPartnerUserIds`, `findVendorUserIds`, the `GET
// /orgs/:orgType/:orgId/members` listing) all read from
// `user_org_memberships` rather than the legacy `users.partner_id` /
// `users.vendor_id` columns. To make that guarantee meaningful the mock
// MUST distinguish between columns of the `users` table and columns of
// the `user_org_memberships` table — if a future change re-introduces
// e.g. `eq(usersTable.partnerId, orgId)` we want the test to fail
// because the `users` fixture rows have no `partnerId` field.

type Row = Record<string, any>;
type ColRef = { __table: string; __col: string };
type Pred =
  | { kind: "eq"; col: ColRef; val: any }
  | { kind: "isNull"; col: ColRef }
  | { kind: "isNotNull"; col: ColRef }
  | { kind: "inArray"; col: ColRef; arr: any[] }
  | { kind: "ciEq"; col: ColRef; val: string }
  | { kind: "and"; preds: Pred[] }
  | { kind: "true" };

type TaggedRow = Record<string, Row | null>;

function tableTag(name: string, cols: string[]) {
  const t: any = { __name: name };
  for (const c of cols) t[c] = { __table: name, __col: c };
  return t;
}

const tables = {
  // NOTE: `partnerId` and `vendorId` are intentionally exposed on the
  // `users` tag even though the production schema dropped them. This lets a
  // regression that re-introduces e.g. `eq(usersTable.partnerId, orgId)`
  // actually compile and run inside the mock — and then return zero matches
  // because our user fixtures never set those fields. The test that follows
  // *does* seed stale `partnerId`/`vendorId` values on a fixture row to prove
  // the route ignores them entirely.
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
    "partnerId",
    "vendorId",
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
  partners: tableTag("partners", ["id", "name", "logoUrl"]),
  vendors: tableTag("vendors", ["id", "name", "logoUrl"]),
  vendorPeople: tableTag("vendorPeople", [
    "id",
    "userId",
    "vendorId",
    "vendorRole",
    "roles",
    "deletedAt",
  ]),
  partnerContacts: tableTag("partnerContacts", [
    "id",
    "partnerId",
    "jobTitle",
    "name",
    "email",
    "roles",
    "deletedAt",
  ]),
  notifications: tableTag("notifications", [
    "id",
    "userId",
    "type",
    "category",
    "dedupeKey",
    "title",
    "body",
    "link",
    "isRead",
    "createdAt",
  ]),
  notificationPreferences: tableTag("notificationPreferences", [
    "userId",
    "ticketsEnabled",
    "hotlistEnabled",
    "complianceEnabled",
    "crewEnabled",
    "systemEnabled",
    "visitorEnabled",
    "pushEnabled",
    "dndStartHour",
    "dndEndHour",
  ]),
  fieldPushTokens: tableTag("fieldPushTokens", []),
  // Tables required so comments.ts / hotlist.ts / rules-engine.ts can be
  // module-loaded and exercise their real fan-out call sites.
  tickets: tableTag("tickets", [
    "id",
    "vendorId",
    "siteLocationId",
    "fieldEmployeeId",
    "status",
    "checkInTime",
    "checkOutTime",
    "updatedAt",
    "createdAt",
  ]),
  ticketCrew: tableTag("ticketCrew", ["ticketId", "employeeId", "removedAt"]),
  siteLocations: tableTag("siteLocations", ["id", "partnerId", "name"]),
  fieldEmployees: tableTag("fieldEmployees", ["id", "userId"]),
  ticketNoteLogs: tableTag("ticketNoteLogs", [
    "id",
    "ticketId",
    "content",
    "attachments",
    "mentions",
    "editHistory",
    "deletedAt",
    "deletedById",
    "createdById",
    "createdAt",
    "updatedAt",
  ]),
  hotlistJobs: tableTag("hotlistJobs", [
    "id",
    "partnerId",
    "title",
    "description",
    "status",
    "latitude",
    "longitude",
    "awardedBidId",
    "awardedVendorId",
    "createdAt",
  ]),
  hotlistBids: tableTag("hotlistBids", [
    "id",
    "jobId",
    "vendorId",
    "amountUsd",
    "etaDays",
    "notes",
    "status",
    "createdAt",
  ]),
  hotlistComments: tableTag("hotlistComments", [
    "id",
    "jobId",
    "content",
    "attachments",
    "mentions",
    "editHistory",
    "deletedAt",
    "createdById",
    "createdAt",
    "updatedAt",
  ]),
  commentReadReceipts: tableTag("commentReadReceipts", [
    "id",
    "source",
    "commentId",
    "userId",
    "seenAt",
  ]),
  employeeCertifications: tableTag("employeeCertifications", []),
  vendorWorkTypes: tableTag("vendorWorkTypes", []),
  workTypes: tableTag("workTypes", []),
  vendorRatings: tableTag("vendorRatings", []),
};

const fixtures: Record<string, Row[]> = {
  users: [],
  userOrgMemberships: [],
  partners: [],
  vendors: [],
  vendorPeople: [],
  partnerContacts: [],
  notifications: [],
  notificationPreferences: [],
  fieldPushTokens: [],
  tickets: [],
  siteLocations: [],
  fieldEmployees: [],
  ticketNoteLogs: [],
  hotlistJobs: [],
  hotlistBids: [],
  hotlistComments: [],
  commentReadReceipts: [],
  employeeCertifications: [],
  vendorWorkTypes: [],
  workTypes: [],
  vendorRatings: [],
};

const idCounters: Record<string, number> = {};
function nextId(t: string) {
  idCounters[t] = (idCounters[t] ?? 0) + 1;
  return idCounters[t];
}

function readFromTagged(row: TaggedRow, c: ColRef | undefined): any {
  // Defensive: if a route accidentally references a non-existent column
  // (e.g. `usersTable.partnerId` after the legacy column was dropped)
  // drizzle would emit `undefined` here. Treat that as "no value" so
  // the predicate never matches and the test still fails — but with
  // an `expect` assertion message rather than a TypeError stack.
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
      // eq's RHS may itself be a column ref (used as a join condition,
      // e.g. eq(usersTable.id, userOrgMembershipsTable.userId)).
      const rhs =
        pred.val && typeof pred.val === "object" && pred.val.__col
          ? readFromTagged(row, pred.val as ColRef)
          : pred.val;
      // Treat undefined / null as "no value" — used by IS NULL semantics.
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
    case "ciEq": {
      const v = readFromTagged(row, pred.col);
      return typeof v === "string" && v.toLowerCase() === pred.val.toLowerCase();
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
    // Caller did `.select()` with no projection — returns the primary
    // table's row. With our wrap-then-project model we don't actually
    // hit this for the routes under test.
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
  distinct = false,
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
    let projected = filtered.map((r) => projectRow(r, cols));
    if (distinct) {
      const seen = new Set<string>();
      projected = projected.filter((p) => {
        const k = JSON.stringify(p);
        if (seen.has(k)) return false;
        seen.add(k);
        return true;
      });
    }
    return projected;
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

// Unique-index enforcement: (userId, partnerId) and (userId, vendorId)
// on `user_org_memberships`. Mirrors the schema check so
// `onConflictDoNothing` returns no inserted row when a duplicate is
// attempted, just like real Postgres.
function findExistingMembership(values: Row): Row | null {
  for (const r of fixtures.userOrgMemberships) {
    if (r.userId !== values.userId) continue;
    if (
      values.partnerId != null &&
      r.partnerId === values.partnerId
    ) {
      return r;
    }
    if (
      values.vendorId != null &&
      r.vendorId === values.vendorId
    ) {
      return r;
    }
  }
  return null;
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
  if (tableName === "notifications") {
    defaults.isRead = false;
    defaults.body = v.body ?? null;
    defaults.link = v.link ?? null;
    defaults.dedupeKey = v.dedupeKey ?? null;
    defaults.createdAt = new Date();
  }
  if (tableName === "ticketNoteLogs" || tableName === "hotlistComments") {
    defaults.attachments = v.attachments ?? null;
    defaults.mentions = v.mentions ?? null;
    defaults.editHistory = null;
    defaults.deletedAt = null;
    defaults.deletedById = null;
    defaults.createdAt = new Date();
    defaults.updatedAt = new Date();
  }
  return { ...defaults, ...v };
}

function makeInsert(t: any) {
  const tableName = t.__name;
  return {
    values: (v: Row | Row[]) => {
      const valsArr = Array.isArray(v) ? v : [v];
      let conflictMode: "none" | "doNothing" = "none";
      let returningCols: Record<string, ColRef> | undefined;

      const doRun = () => {
        const inserted: Row[] = [];
        for (const raw of valsArr) {
          const row = applyDefaults(tableName, raw);
          if (
            tableName === "userOrgMemberships" &&
            conflictMode === "doNothing"
          ) {
            const existing = findExistingMembership(row);
            if (existing) continue; // suppressed by onConflictDoNothing
          }
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
        onConflictDoNothing: (_target?: any) => {
          conflictMode = "doNothing";
          return chain;
        },
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
              // Resolve `sql\`${col} + N\`` increment markers per-row
              // so counter bumps such as `users.sessionVersion + 1`
              // produce numeric values that tests can assert on.
              const resolvedSet: Row = {};
              for (const [k, v] of Object.entries(s)) {
                if (
                  v &&
                  typeof v === "object" &&
                  (v as { kind?: string }).kind === "increment"
                ) {
                  const inc = v as unknown as {
                    col: ColRef;
                    by: number;
                  };
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
          // Simulate FK ON DELETE SET NULL: when a
          // `user_org_memberships` row is removed, any
          // `users.activeMembershipId` pointing at it gets nulled out
          // by Postgres. `removeMembership()` relies on this cascade
          // when deciding whether to repoint at the next remaining
          // membership, so the mock must mirror it for the tests
          // around the membership-removal flow to be accurate.
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
      from: (t: any) => makeQuery(t.__name, cols, false),
    }),
    selectDistinct: (cols?: Record<string, ColRef>) => ({
      from: (t: any) => makeQuery(t.__name, cols, true),
    }),
    insert: (t: any) => makeInsert(t),
    update: (t: any) => makeUpdate(t),
    delete: (t: any) => makeDelete(t),
    transaction: async <T,>(cb: (tx: any) => Promise<T>): Promise<T> => {
      // Simple in-memory transaction: run the callback against the
      // shared db. For these tests we don't need rollback semantics.
      return cb(db);
    },
    // The visit-notifier helpers go through `db.execute(sql\`…\`)` for raw
    // partner_contacts / vendor_people lookups. The sqlTag mock above
    // tags those queries with kind: "rawQuery" so we can replay them
    // here against the in-memory fixture rows. Anything we don't
    // recognize falls through to an empty result, which forces callers
    // down the fallback branch (e.g. findPartnerUserIds /
    // findVendorUserIds) — that fallback path is covered by other tests.
    execute: async (q?: any) => {
      if (q && q.kind === "rawQuery") {
        if (q.queryType === "partnerVisitNotifier") {
          const out: { id: number }[] = [];
          const seen = new Set<number>();
          for (const m of fixtures.userOrgMemberships) {
            if (m.orgType !== "partner") continue;
            if (m.partnerId !== q.partnerId) continue;
            const u = fixtures.users.find((u) => u.id === m.userId);
            if (!u || typeof u.username !== "string") continue;
            const pc = fixtures.partnerContacts.find(
              (pc) =>
                pc.partnerId === m.partnerId &&
                pc.deletedAt == null &&
                typeof pc.email === "string" &&
                pc.email.toLowerCase() === u.username.toLowerCase() &&
                Array.isArray(pc.roles) &&
                pc.roles.includes(q.role),
            );
            if (pc && !seen.has(m.userId)) {
              seen.add(m.userId);
              out.push({ id: m.userId });
            }
          }
          return { rows: out };
        }
        if (q.queryType === "vendorVisitNotifier") {
          const out: { id: number }[] = [];
          const seen = new Set<number>();
          for (const m of fixtures.userOrgMemberships) {
            if (m.orgType !== "vendor") continue;
            if (m.vendorId !== q.vendorId) continue;
            const vp = fixtures.vendorPeople.find(
              (vp) =>
                vp.vendorId === m.vendorId &&
                vp.deletedAt == null &&
                (vp.id === m.vendorPeopleId || vp.userId === m.userId) &&
                Array.isArray(vp.roles) &&
                vp.roles.includes(q.role),
            );
            if (vp && !seen.has(m.userId)) {
              seen.add(m.userId);
              out.push({ id: m.userId });
            }
          }
          return { rows: out };
        }
      }
      return { rows: [] };
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
  partnersTable: tables.partners,
  vendorsTable: tables.vendors,
  vendorPeopleTable: tables.vendorPeople,
  notificationsTable: tables.notifications,
  notificationPreferencesTable: tables.notificationPreferences,
  fieldPushTokensTable: tables.fieldPushTokens,
  ticketsTable: tables.tickets,
  ticketCrewTable: tables.ticketCrew,
  siteLocationsTable: tables.siteLocations,
  fieldEmployeesTable: tables.fieldEmployees,
  ticketNoteLogsTable: tables.ticketNoteLogs,
  hotlistJobsTable: tables.hotlistJobs,
  hotlistBidsTable: tables.hotlistBids,
  hotlistCommentsTable: tables.hotlistComments,
  commentReadReceiptsTable: tables.commentReadReceipts,
  employeeCertificationsTable: tables.employeeCertifications,
  vendorWorkTypesTable: tables.vendorWorkTypes,
  workTypesTable: tables.workTypes,
  vendorRatingsTable: tables.vendorRatings,
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
      const joined = (strings as string[]).join(" ");
      // Recognize the case-insensitive username comparison used by
      // /auth/login and POST /orgs/:type/:id/members:
      //   sql`lower(${usersTable.username}) = lower(${email})`
      if (
        /lower\(/.test(joined) &&
        values.length === 2 &&
        values[0] &&
        typeof values[0].__col === "string" &&
        typeof values[1] === "string"
      ) {
        return { kind: "ciEq", col: values[0] as ColRef, val: values[1] };
      }
      // Recognize findPartnerVisitNotifierUserIds raw SQL — the helper
      // joins user_org_memberships → users → partner_contacts and gates
      // by `<role> = ANY(pc.roles)`. Capture the partnerId + role so
      // db.execute below can replay the lookup against fixture rows.
      if (
        joined.includes("partner_contacts pc") &&
        joined.includes("ANY(pc.roles)") &&
        values.length === 2 &&
        typeof values[0] === "number" &&
        typeof values[1] === "string"
      ) {
        return {
          kind: "rawQuery",
          queryType: "partnerVisitNotifier",
          partnerId: values[0] as number,
          role: values[1] as string,
        };
      }
      // Recognize findVendorVisitNotifierUserIds raw SQL.
      if (
        joined.includes("vendor_people vp") &&
        joined.includes("ANY(vp.roles)") &&
        values.length === 2 &&
        typeof values[0] === "number" &&
        typeof values[1] === "string"
      ) {
        return {
          kind: "rawQuery",
          queryType: "vendorVisitNotifier",
          vendorId: values[0] as number,
          role: values[1] as string,
        };
      }
      // Recognize the `${column} + <number>` increment pattern used by
      // routes that bump counters such as `users.sessionVersion`. The
      // makeUpdate mock evaluates this per-row so tests can assert
      // numeric increment behavior instead of just "field was touched".
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
    lt: passthrough,
    gte: passthrough,
  };
});

// Avoid pulling in pino + transport configuration.
vi.mock("../lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Push fan-out is not exercised here; stub it so notifications.ts can
// import it without trying to talk to Expo or Postgres.
vi.mock("../lib/expo-push", () => ({
  sendPushToUser: vi.fn(async () => undefined),
}));

// Bcrypt — make hashing deterministic and fast and treat any non-empty
// password as valid. The membership flow only uses `bcrypt.hashSync`,
// the auth tests don't need to verify a real hash.
vi.mock("bcryptjs", () => ({
  default: {
    hashSync: (pw: string) => `hashed:${pw}`,
    compare: async (pw: string, hash: string) => hash === `hashed:${pw}`,
  },
  hashSync: (pw: string) => `hashed:${pw}`,
  compare: async (pw: string, hash: string) => hash === `hashed:${pw}`,
}));



function adminCookie(userId = 1) {
  // System admin: session.role === "admin" satisfies the early-return
  // in requireOrgAdmin so we don't need to set up an org membership for
  // the caller.
  const session = {
    userId,
    role: "admin",
    partnerId: null,
    vendorId: null,
  };
  return buildTestCookie(session);
}

function partnerCookie(userId: number, partnerId: number, displayName = "Partner Owner") {
  const session = {
    userId,
    role: "partner",
    partnerId,
    vendorId: null,
    displayName,
  };
  return buildTestCookie(session);
}

let app: express.Express;
let orgMembers: typeof import("./orgMembers");
let auth: typeof import("./auth");
let notifications: typeof import("./notifications");
let comments: typeof import("./comments");
let hotlist: typeof import("./hotlist");
let rulesEngine: typeof import("../lib/rules-engine");

beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  for (const k of Object.keys(idCounters)) idCounters[k] = 0;
  vi.resetModules();

  orgMembers = await import("./orgMembers");
  auth = await import("./auth");
  notifications = await import("./notifications");
  comments = await import("./comments");
  hotlist = await import("./hotlist");
  rulesEngine = await import("../lib/rules-engine");

  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", orgMembers.default);
  app.use("/api", auth.default);
  app.use("/api", comments.default);
  app.use("/api", hotlist.default);
  attachTestErrorMiddleware(app);
});

afterEach(() => {
  vi.clearAllMocks();
});

// ─────────────────────────────────────────────────────────────────────────────
// Seed helpers

function seedSystemAdmin() {
  const u: Row = {
    id: nextId("users"),
    username: "sysadmin@vndrly.test",
    passwordHash: "hashed:admin-pw",
    role: "admin",
    displayName: "System Admin",
    activeMembershipId: null,
    preferredLanguage: null,
    sessionVersion: 1,
    createdAt: new Date(),
  };
  fixtures.users.push(u);
  return u;
}

function seedPartner(id: number, name = `Partner ${id}`) {
  const p = { id, name, logoUrl: null };
  fixtures.partners.push(p);
  return p;
}

function seedVendor(id: number, name = `Vendor ${id}`) {
  const v = { id, name, logoUrl: null };
  fixtures.vendors.push(v);
  return v;
}

// ─────────────────────────────────────────────────────────────────────────────
// Partner membership flow

describe("partner membership flow (regression)", () => {
  it("POST → user listed by GET, returned by findPartnerUserIds, no legacy column written", async () => {
    seedSystemAdmin();
    const partner = seedPartner(10, "Acme Partner");

    // Add a brand-new partner user.
    const addRes = await request(app)
      .post(`/api/orgs/partner/${partner.id}/members`)
      .set("Cookie", adminCookie())
      .send({
        email: "newpartner@example.com",
        password: "supersecret",
        displayName: "New Partner",
        role: "member",
      });
    expectStatus(addRes, 201);
    expect(addRes.body.createdUser).toBe(true);
    expect(addRes.body.username).toBe("newpartner@example.com");
    expect(typeof addRes.body.userId).toBe("number");
    expect(typeof addRes.body.membershipId).toBe("number");
    const newUserId: number = addRes.body.userId;

    // Sanity: the user exists in the users table…
    const userRow = fixtures.users.find((u) => u.id === newUserId);
    expect(userRow).toBeDefined();
    // …and the LEGACY columns are NOT populated. This is the central
    // invariant: every reader downstream must resolve via
    // `user_org_memberships`, not via `users.partner_id`.
    expect(userRow!.partnerId).toBeUndefined();
    expect(userRow!.vendorId).toBeUndefined();

    // The membership row IS written and references the partner.
    const memberships = fixtures.userOrgMemberships.filter(
      (m) => m.userId === newUserId,
    );
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      orgType: "partner",
      partnerId: partner.id,
      vendorId: null,
      role: "member",
    });

    // GET listing surfaces them via the user_org_memberships join.
    const listRes = await request(app)
      .get(`/api/orgs/partner/${partner.id}/members`)
      .set("Cookie", adminCookie());
    expectStatus(listRes, 200);
    expect(listRes.body.orgType).toBe("partner");
    expect(listRes.body.orgId).toBe(partner.id);
    const listedIds = listRes.body.members.map((m: any) => m.userId);
    expect(listedIds).toContain(newUserId);
    const listed = listRes.body.members.find(
      (m: any) => m.userId === newUserId,
    );
    expect(listed).toMatchObject({
      username: "newpartner@example.com",
      role: "member",
    });

    // findPartnerUserIds — the helper that gates visitor-checkin
    // notification fan-out and is reused by hotlist/comments/rules-engine.
    const partnerUserIds = await notifications.findPartnerUserIds(partner.id);
    expect(partnerUserIds).toContain(newUserId);

    // Cross-check: the same helper for a DIFFERENT partner must not
    // include this user.
    seedPartner(11, "Other Partner");
    const otherIds = await notifications.findPartnerUserIds(11);
    expect(otherIds).not.toContain(newUserId);
  });

  it("findPartnerVisitNotifierUserIds falls back to all partner users when no contacts are tagged", async () => {
    seedSystemAdmin();
    const partner = seedPartner(20);

    const addRes = await request(app)
      .post(`/api/orgs/partner/${partner.id}/members`)
      .set("Cookie", adminCookie())
      .send({
        email: "partner2@example.com",
        password: "supersecret",
        role: "member",
      });
    expectStatus(addRes, 201);
    const newUserId: number = addRes.body.userId;

    // The visit-notifier helper runs raw SQL via `db.execute` to look
    // up tagged contacts; our mock returns no rows, so it MUST fall
    // back to findPartnerUserIds and still include the brand-new user.
    const ids = await notifications.findPartnerVisitNotifierUserIds(
      partner.id,
    );
    expect(ids).toContain(newUserId);
  });

  it("re-adding the same email is idempotent (uses onConflictDoNothing)", async () => {
    seedSystemAdmin();
    const partner = seedPartner(30);

    const first = await request(app)
      .post(`/api/orgs/partner/${partner.id}/members`)
      .set("Cookie", adminCookie())
      .send({
        email: "dup@example.com",
        password: "supersecret",
        role: "member",
      });
    expectStatus(first, 201);

    const second = await request(app)
      .post(`/api/orgs/partner/${partner.id}/members`)
      .set("Cookie", adminCookie())
      .send({
        email: "dup@example.com",
        password: "anotherpw",
        role: "admin",
      });
    expectStatus(second, 200);
    expect(second.body.createdUser).toBe(false);
    expect(second.body.userId).toBe(first.body.userId);

    // Only one membership row total.
    const memberships = fixtures.userOrgMemberships.filter(
      (m) => m.userId === first.body.userId,
    );
    expect(memberships).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Vendor membership flow (symmetric with partner)

describe("vendor membership flow (regression)", () => {
  it("POST → user listed by GET, returned by findVendorUserIds, no legacy column written", async () => {
    seedSystemAdmin();
    const vendor = seedVendor(50, "Beta Vendor");

    const addRes = await request(app)
      .post(`/api/orgs/vendor/${vendor.id}/members`)
      .set("Cookie", adminCookie())
      .send({
        email: "newvendor@example.com",
        password: "supersecret",
        role: "member",
      });
    expectStatus(addRes, 201);
    expect(addRes.body.createdUser).toBe(true);
    const newUserId: number = addRes.body.userId;

    const userRow = fixtures.users.find((u) => u.id === newUserId);
    expect(userRow).toBeDefined();
    expect(userRow!.partnerId).toBeUndefined();
    expect(userRow!.vendorId).toBeUndefined();

    const membership = fixtures.userOrgMemberships.find(
      (m) => m.userId === newUserId,
    );
    expect(membership).toMatchObject({
      orgType: "vendor",
      vendorId: vendor.id,
      partnerId: null,
    });

    const listRes = await request(app)
      .get(`/api/orgs/vendor/${vendor.id}/members`)
      .set("Cookie", adminCookie());
    expectStatus(listRes, 200);
    const listedIds = listRes.body.members.map((m: any) => m.userId);
    expect(listedIds).toContain(newUserId);

    const vendorUserIds = await notifications.findVendorUserIds(vendor.id);
    expect(vendorUserIds).toContain(newUserId);

    seedVendor(51);
    const otherIds = await notifications.findVendorUserIds(51);
    expect(otherIds).not.toContain(newUserId);
  });

  it("findVendorVisitNotifierUserIds falls back to all vendor users when no people are tagged", async () => {
    seedSystemAdmin();
    const vendor = seedVendor(60);

    const addRes = await request(app)
      .post(`/api/orgs/vendor/${vendor.id}/members`)
      .set("Cookie", adminCookie())
      .send({
        email: "vendor2@example.com",
        password: "supersecret",
        role: "member",
      });
    expectStatus(addRes, 201);
    const newUserId: number = addRes.body.userId;

    const ids = await notifications.findVendorVisitNotifierUserIds(vendor.id);
    expect(ids).toContain(newUserId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Visitor-notifier helpers — PRIMARY (role-tagged) path
//
// The fallback path above kicks in when nobody is role-tagged. The primary
// path — restricting fan-out to ONLY the tagged subset — runs raw SQL via
// `db.execute`. Without coverage, a future change that broadens the
// recipient set (e.g. dropping the `<role> = ANY(pc.roles)` gate) or that
// joins on the wrong column would ship silently and visitor check-in
// notifications would suddenly hit every member of the partner / vendor
// org. These tests exercise the in-memory db.execute shim that replays the
// helper's join against fixture rows.

describe("findPartnerVisitNotifierUserIds — primary (role-tagged) path", () => {
  it("returns ONLY the user whose partner_contact has the visitor role", async () => {
    seedSystemAdmin();
    const partner = seedPartner(120, "Tagged Partner");

    const taggedUserId = await addPartnerMember(
      partner.id,
      "tagged@example.com",
    );
    const untaggedUserId = await addPartnerMember(
      partner.id,
      "untagged@example.com",
    );

    // Only the tagged user has a partner_contacts row carrying the
    // visitor role. The untagged user belongs to the same org but has
    // no contact row at all — they MUST be excluded.
    fixtures.partnerContacts.push({
      id: nextId("partnerContacts"),
      partnerId: partner.id,
      jobTitle: "Site Lead",
      name: "Tagged Lead",
      email: "tagged@example.com",
      roles: [notifications.VISIT_NOTIFICATIONS_ROLE],
      deletedAt: null,
    });

    const ids = await notifications.findPartnerVisitNotifierUserIds(
      partner.id,
    );
    expect(ids).toEqual([taggedUserId]);
    expect(ids).not.toContain(untaggedUserId);
  });

  it("excludes a partner contact whose roles array does not include the visitor role", async () => {
    // Negative-control variant: the untagged user DOES have a contact
    // row, but its roles array carries an unrelated role. The helper
    // must still exclude them — proving the gate is on the role value
    // and not merely on the existence of a contact row.
    seedSystemAdmin();
    const partner = seedPartner(121, "Partner With Mixed Tags");

    const taggedUserId = await addPartnerMember(
      partner.id,
      "lead@example.com",
    );
    const untaggedUserId = await addPartnerMember(
      partner.id,
      "office@example.com",
    );

    fixtures.partnerContacts.push(
      {
        id: nextId("partnerContacts"),
        partnerId: partner.id,
        jobTitle: "Site Lead",
        name: "Lead",
        email: "lead@example.com",
        roles: [notifications.VISIT_NOTIFICATIONS_ROLE],
        deletedAt: null,
      },
      {
        id: nextId("partnerContacts"),
        partnerId: partner.id,
        jobTitle: "Office Manager",
        name: "Office",
        email: "office@example.com",
        roles: ["Some Other Role"],
        deletedAt: null,
      },
    );

    const ids = await notifications.findPartnerVisitNotifierUserIds(
      partner.id,
    );
    expect(ids).toEqual([taggedUserId]);
    expect(ids).not.toContain(untaggedUserId);
  });

  it("excludes a soft-deleted partner_contacts row and falls back to all partner users", async () => {
    // Regression guard for the `pc.deleted_at is null` gate in
    // findPartnerVisitNotifierUserIds. If a future change drops that
    // gate, soft-deleted contacts would silently start receiving
    // visitor alerts again — exactly the leak the role-tag check was
    // added to prevent.
    seedSystemAdmin();
    const partner = seedPartner(122, "Partner With Soft-Deleted Tag");

    const formerLeadUserId = await addPartnerMember(
      partner.id,
      "former-lead@example.com",
    );
    const officeUserId = await addPartnerMember(
      partner.id,
      "office2@example.com",
    );

    // The only tagged contact for this partner has been soft-deleted.
    // The shim mirrors the production `pc.deleted_at is null` gate, so
    // the primary path must return zero rows. The helper should then
    // fall back to findPartnerUserIds (all members), NOT return only
    // the soft-deleted user.
    fixtures.partnerContacts.push({
      id: nextId("partnerContacts"),
      partnerId: partner.id,
      jobTitle: "Former Lead",
      name: "Former Lead",
      email: "former-lead@example.com",
      roles: [notifications.VISIT_NOTIFICATIONS_ROLE],
      deletedAt: new Date(),
    });

    const ids = await notifications.findPartnerVisitNotifierUserIds(
      partner.id,
    );
    // Fallback semantics: ALL partner users, including the office user
    // who has no contact row at all. If the deleted_at gate were
    // dropped, ids would equal [formerLeadUserId] only and this
    // assertion would fail because officeUserId would be missing.
    expect(ids.slice().sort()).toEqual(
      [formerLeadUserId, officeUserId].sort(),
    );
    expect(ids).toContain(officeUserId);
  });
});

describe("findVendorVisitNotifierUserIds — primary (role-tagged) path", () => {
  it("returns ONLY the user whose vendor_people row has the visitor role", async () => {
    seedSystemAdmin();
    const vendor = seedVendor(220, "Tagged Vendor");

    const taggedUserId = await addVendorMember(
      vendor.id,
      "tagged-v@example.com",
    );
    const untaggedUserId = await addVendorMember(
      vendor.id,
      "untagged-v@example.com",
    );

    // The tagged user is matched via vendor_people.user_id, which is
    // the legacy join branch the helper supports alongside the
    // membership.vendor_people_id branch. Either way the gate is the
    // role array on vendor_people.
    fixtures.vendorPeople.push({
      id: nextId("vendorPeople"),
      userId: taggedUserId,
      vendorId: vendor.id,
      vendorRole: "field_employee",
      roles: [notifications.VISIT_NOTIFICATIONS_ROLE],
      deletedAt: null,
    });

    const ids = await notifications.findVendorVisitNotifierUserIds(vendor.id);
    expect(ids).toEqual([taggedUserId]);
    expect(ids).not.toContain(untaggedUserId);
  });

  it("excludes a vendor person whose roles array does not include the visitor role", async () => {
    seedSystemAdmin();
    const vendor = seedVendor(221, "Vendor With Mixed Tags");

    const taggedUserId = await addVendorMember(
      vendor.id,
      "tagged-v2@example.com",
    );
    const untaggedUserId = await addVendorMember(
      vendor.id,
      "untagged-v2@example.com",
    );

    fixtures.vendorPeople.push(
      {
        id: nextId("vendorPeople"),
        userId: taggedUserId,
        vendorId: vendor.id,
        vendorRole: "field_employee",
        roles: [notifications.VISIT_NOTIFICATIONS_ROLE],
        deletedAt: null,
      },
      {
        id: nextId("vendorPeople"),
        userId: untaggedUserId,
        vendorId: vendor.id,
        vendorRole: "field_employee",
        roles: ["Some Other Role"],
        deletedAt: null,
      },
    );

    const ids = await notifications.findVendorVisitNotifierUserIds(vendor.id);
    expect(ids).toEqual([taggedUserId]);
    expect(ids).not.toContain(untaggedUserId);
  });

  it("matches a member via user_org_memberships.vendor_people_id when vendor_people.user_id is null", async () => {
    // The helper's join supports TWO ways of linking a membership to a
    // vendor_people row:
    //   (vp.id = m.vendor_people_id OR vp.user_id = m.user_id)
    // Every other test in this block (and the fallback test above)
    // exercises the legacy `vp.user_id = m.user_id` branch by seeding
    // vendor_people with userId set to the membership's user. This test
    // pins down the NEWER branch — used when a membership is created
    // against an explicit vendor_people row (e.g. via the
    // field-employee onboarding flow that pre-creates a vendor_people
    // row, then attaches a user via membership.vendor_people_id).
    //
    // We deliberately leave vendor_people.user_id null so the legacy
    // branch can NOT match. If a future refactor drops the
    // `vp.id = m.vendor_people_id` clause from the join, the helper
    // would return an empty set and fall back to findVendorUserIds —
    // making this test fail because the assertion below pins the
    // exact tagged-only result rather than the all-members fallback.
    seedSystemAdmin();
    const vendor = seedVendor(223, "Vendor Linked Via vendor_people_id");

    // Control user: a vendor member with NO vendor_people row at all.
    // If the gate accidentally widened, this user would slip into the
    // recipient list and the toEqual assertion below would fail.
    const untaggedUserId = await addVendorMember(
      vendor.id,
      "untagged-vp-link@example.com",
    );

    // Tagged user: created directly so we can wire the membership's
    // vendor_people_id to a vendor_people row whose user_id is null.
    const taggedUserId = nextId("users");
    fixtures.users.push({
      id: taggedUserId,
      username: "tagged-vp-link@example.com",
      passwordHash: "hashed:supersecret",
      role: "field_employee",
      displayName: "VP-Link Crew",
      activeMembershipId: null,
      preferredLanguage: null,
      createdAt: new Date(),
    });
    const vendorPersonId = nextId("vendorPeople");
    fixtures.vendorPeople.push({
      id: vendorPersonId,
      // user_id intentionally null — proves the helper can resolve
      // this row without relying on the legacy vp.user_id = m.user_id
      // branch.
      userId: null,
      vendorId: vendor.id,
      vendorRole: "field_employee",
      roles: [notifications.VISIT_NOTIFICATIONS_ROLE],
      deletedAt: null,
    });
    fixtures.userOrgMemberships.push({
      id: nextId("userOrgMemberships"),
      userId: taggedUserId,
      orgType: "vendor",
      partnerId: null,
      vendorId: vendor.id,
      role: "member",
      // Explicit linkage — this is the column the new join branch
      // exists to honor.
      vendorPeopleId: vendorPersonId,
      createdAt: new Date(),
    });

    const ids = await notifications.findVendorVisitNotifierUserIds(vendor.id);
    expect(ids).toEqual([taggedUserId]);
    expect(ids).not.toContain(untaggedUserId);
  });

  it("excludes a soft-deleted vendor_people row and falls back to all vendor users", async () => {
    // Symmetric guard for the `vp.deleted_at is null` gate in
    // findVendorVisitNotifierUserIds. A regression that drops it would
    // re-route visitor alerts to off-boarded crew the org thought it
    // had removed.
    seedSystemAdmin();
    const vendor = seedVendor(222, "Vendor With Soft-Deleted Tag");

    const formerCrewUserId = await addVendorMember(
      vendor.id,
      "former-crew@example.com",
    );
    const otherCrewUserId = await addVendorMember(
      vendor.id,
      "other-crew@example.com",
    );

    fixtures.vendorPeople.push({
      id: nextId("vendorPeople"),
      userId: formerCrewUserId,
      vendorId: vendor.id,
      vendorRole: "field_employee",
      roles: [notifications.VISIT_NOTIFICATIONS_ROLE],
      deletedAt: new Date(),
    });

    const ids = await notifications.findVendorVisitNotifierUserIds(vendor.id);
    // Fallback semantics: ALL vendor users. If the deleted_at gate
    // were dropped, ids would equal [formerCrewUserId] only and this
    // assertion would fail because otherCrewUserId would be missing.
    expect(ids.slice().sort()).toEqual(
      [formerCrewUserId, otherCrewUserId].sort(),
    );
    expect(ids).toContain(otherCrewUserId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/orgs/:orgType/:orgId/members — error paths.
//
// These pin down the user-facing error UX so a future refactor can't
// silently swap a 409 for a 200, drop a guard, or relabel a `code`. Each
// test asserts BOTH the HTTP status AND the response `code` because the
// web/mobile clients branch on the `code` (not the prose) to decide
// whether to surface a specific inline message vs a generic toast.

describe("POST /api/orgs/:orgType/:orgId/members error paths", () => {
  it("409 when an existing login already belongs to a field employee", async () => {
    // Setup: a field employee user already exists with this email. The
    // POST handler must refuse to attach an org membership to them — the
    // field-employee onboarding flow at `/field-employees/:id/login` is
    // the only thing allowed to manage those memberships.
    seedSystemAdmin();
    const partner = seedPartner(800, "Field Refusal Co");
    const fieldUser: Row = {
      id: nextId("users"),
      username: "fielder@example.com",
      passwordHash: "hashed:fielder-pw",
      role: "field_employee",
      displayName: "Field Worker",
      activeMembershipId: null,
      preferredLanguage: null,
      createdAt: new Date(),
    };
    fixtures.users.push(fieldUser);

    const res = await request(app)
      .post(`/api/orgs/partner/${partner.id}/members`)
      .set("Cookie", adminCookie())
      .send({
        // Note: a different case than the seeded username — the route
        // matches case-insensitively, so the guard must still trip.
        email: "Fielder@example.com",
        password: "supersecret",
        role: "member",
      });
    expect(res.status).toBe(409);
    // Distinct from the catch-all `members.add_failed` so the web /
    // mobile clients can render a specific, actionable message
    // ("That login belongs to a field employee — use the field
    // employee tools instead") instead of a generic toast. Sharing the
    // generic code with weak-password / transactional failures used to
    // make this branch indistinguishable on the client.
    expect(res.body.code).toBe("members.is_field_employee");

    // No membership row was attached — the transaction rolled back.
    expect(
      fixtures.userOrgMemberships.filter((m) => m.userId === fieldUser.id),
    ).toHaveLength(0);
  });

  it("404 when the partner in the URL doesn't exist", async () => {
    seedSystemAdmin();
    // No partner is seeded for id 9999 on purpose.

    const res = await request(app)
      .post(`/api/orgs/partner/9999/members`)
      .set("Cookie", adminCookie())
      .send({
        email: "ghost@example.com",
        password: "supersecret",
      });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("members.org_not_found");

    // Belt-and-braces: no orphan user / membership got created.
    expect(
      fixtures.users.find((u) => u.username === "ghost@example.com"),
    ).toBeUndefined();
    expect(fixtures.userOrgMemberships).toHaveLength(0);
  });

  it("404 when the vendor in the URL doesn't exist", async () => {
    // Symmetric to the partner case — the route has separate `partner`
    // and `vendor` branches that each do their own existence check, and
    // both must surface the same error code.
    seedSystemAdmin();

    const res = await request(app)
      .post(`/api/orgs/vendor/9999/members`)
      .set("Cookie", adminCookie())
      .send({
        email: "ghost-vendor@example.com",
        password: "supersecret",
      });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("members.org_not_found");

    expect(
      fixtures.users.find((u) => u.username === "ghost-vendor@example.com"),
    ).toBeUndefined();
    expect(fixtures.userOrgMemberships).toHaveLength(0);
  });

  it("400 when the body has no email", async () => {
    seedSystemAdmin();
    const partner = seedPartner(810, "Empty Body Co");

    const res = await request(app)
      .post(`/api/orgs/partner/${partner.id}/members`)
      .set("Cookie", adminCookie())
      .send({ password: "supersecret", role: "member" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("members.missing_email");

    // The guard fires before any DB writes — no orphan rows.
    expect(fixtures.users.filter((u) => u.role !== "admin")).toHaveLength(0);
    expect(fixtures.userOrgMemberships).toHaveLength(0);
  });

  it("400 when creating a brand-new user with a password under 8 characters", async () => {
    // Existing users can be attached without re-supplying a password —
    // this guard is specifically for the "create-on-the-fly" branch.
    seedSystemAdmin();
    const partner = seedPartner(820, "Weak Pw Co");

    const res = await request(app)
      .post(`/api/orgs/partner/${partner.id}/members`)
      .set("Cookie", adminCookie())
      .send({
        email: "weakpw@example.com",
        password: "short", // 5 chars — under the 8-char minimum
        role: "member",
      });
    expect(res.status).toBe(400);
    // Distinct from the catch-all `members.add_failed` so the web admin
    // form can highlight the password input inline instead of showing a
    // generic banner. Previously this case shared a code with the
    // field-employee 409 and other transactional failures, leaving the
    // form unable to tell them apart.
    expect(res.body.code).toBe("members.weak_password");

    // The thrown error rolled back the transaction, so neither the user
    // row nor any membership were persisted.
    expect(
      fixtures.users.find((u) => u.username === "weakpw@example.com"),
    ).toBeUndefined();
    expect(fixtures.userOrgMemberships).toHaveLength(0);
  });

  it("401 with auth.not_authenticated when no session cookie is present", async () => {
    // POST shares the same `requireOrgAdmin` guard as GET. The 401
    // branch (no session cookie) is covered for GET above; mirror it
    // here for POST so a future refactor of the guard can't quietly
    // start letting anonymous callers create memberships. Param parse
    // passes (partner / numeric id) and the org row exists, so the
    // route falls through to requireOrgAdmin which sees no cookie.
    const partner = seedPartner(830, "Anonymous POST Co");

    const res = await request(app)
      .post(`/api/orgs/partner/${partner.id}/members`)
      .send({
        email: "anon@example.com",
        password: "supersecret",
        role: "member",
      });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.not_authenticated");

    // Rejected before any DB writes — no orphan user / membership rows.
    expect(
      fixtures.users.find((u) => u.username === "anon@example.com"),
    ).toBeUndefined();
    expect(fixtures.userOrgMemberships).toHaveLength(0);
  });

  it("403 with auth.forbidden when an admin from another org tries to add a member", async () => {
    // Caller is an admin of partner A; they POST a new member to
    // partner B. requireOrgAdmin's membership-lookup branch must
    // reject because no admin row exists for partner B under this
    // user. This is the central authorization invariant — without it,
    // a partner admin could provision logins inside any other
    // partner's org.
    const partnerA = seedPartner(840, "A Co");
    const partnerB = seedPartner(841, "B Co");
    const { user: aAdmin } = seedPartnerUser(
      "a-admin-add@example.com",
      "admin",
      partnerA.id,
    );

    const res = await request(app)
      .post(`/api/orgs/partner/${partnerB.id}/members`)
      .set("Cookie", partnerCookie(aAdmin.id, partnerA.id))
      .send({
        email: "intruder@example.com",
        password: "supersecret",
        role: "member",
      });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.forbidden");

    // No new user got created and no membership rows were attached to
    // partner B (only the seeded org admin's own membership in partner
    // A is allowed to exist).
    expect(
      fixtures.users.find((u) => u.username === "intruder@example.com"),
    ).toBeUndefined();
    expect(
      fixtures.userOrgMemberships.filter(
        (m) => m.partnerId === partnerB.id,
      ),
    ).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Auth resolveContext for system admins

describe("GET /api/auth/me — resolveContext", () => {
  it("admin user with zero memberships gets null context, ignoring stale legacy partnerId/vendorId on the users row", async () => {
    // This admin has NO membership rows at all but DOES have legacy-style
    // partnerId / vendorId values left over on the users fixture row — the
    // exact shape that existed pre-migration (see #194). resolveContext
    // must ignore those columns entirely and return null. If a regression
    // re-introduces a fallback that says "if no membership found, look at
    // users.partnerId" the assertions below fail because we'll get 999/888
    // back from the API.
    const admin = seedSystemAdmin();
    admin.partnerId = 999; // intentionally stale
    admin.vendorId = 888; // intentionally stale

    const res = await request(app)
      .get("/api/auth/me")
      .set("Cookie", adminCookie(admin.id));

    expectStatus(res, 200);
    expect(res.body.role).toBe("admin");
    expect(res.body.partnerId).toBeNull();
    expect(res.body.vendorId).toBeNull();
    expect(res.body.activeMembershipId).toBeNull();
    expect(res.body.availableMemberships).toEqual([]);
    expect(res.body.requiresContextChoice).toBe(false);
    // Belt-and-braces: nothing in the response should leak the stale ids.
    const serialised = JSON.stringify(res.body);
    expect(serialised).not.toContain("999");
    expect(serialised).not.toContain("888");
  });

  it("admin user with one partner membership picks it up via resolveContext", async () => {
    // Positive control for the previous test — proves the null result
    // above is genuinely "no memberships found" rather than a broken
    // mock that hides every membership.
    const admin = seedSystemAdmin();
    const partner = seedPartner(70, "Acme");
    const membership = {
      id: nextId("userOrgMemberships"),
      userId: admin.id,
      orgType: "partner",
      partnerId: partner.id,
      vendorId: null,
      role: "admin",
      vendorPeopleId: null,
      createdAt: new Date(),
    };
    fixtures.userOrgMemberships.push(membership);
    admin.activeMembershipId = membership.id;

    const res = await request(app)
      .get("/api/auth/me")
      .set("Cookie", adminCookie(admin.id));

    expectStatus(res, 200);
    expect(res.body.role).toBe("partner");
    expect(res.body.partnerId).toBe(partner.id);
    expect(res.body.vendorId).toBeNull();
    expect(res.body.activeMembershipId).toBe(membership.id);
    expect(res.body.availableMemberships).toHaveLength(1);
    expect(res.body.availableMemberships[0]).toMatchObject({
      orgType: "partner",
      orgId: partner.id,
      orgName: "Acme",
      role: "admin",
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Real fan-out call sites: prove that newly-membership-created users actually
// land in the recipient sets computed by comments.ts, hotlist.ts, and the
// rules-engine. These are the REGRESSION SURFACES that matter — any future
// patch which bypasses findPartnerUserIds / findVendorUserIds in any of these
// callers (e.g. by re-introducing a direct query against the deprecated
// `users.partner_id` / `users.vendor_id` columns) will exclude the newly
// created user from the inserted notifications and fail these tests.

async function addPartnerMember(partnerId: number, email: string): Promise<number> {
  const res = await request(app)
    .post(`/api/orgs/partner/${partnerId}/members`)
    .set("Cookie", adminCookie())
    .send({ email, password: "supersecret", role: "member" });
  expectStatus(res, 201);
  return res.body.userId as number;
}

async function addVendorMember(vendorId: number, email: string): Promise<number> {
  const res = await request(app)
    .post(`/api/orgs/vendor/${vendorId}/members`)
    .set("Cookie", adminCookie())
    .send({ email, password: "supersecret", role: "member" });
  expectStatus(res, 201);
  return res.body.userId as number;
}

describe("real fan-out call sites (regression)", () => {
  it("comments.ts POST /api/tickets/:id/comments fans out to membership-only partner + vendor users", async () => {
    // Setup: an admin posts a comment on a ticket. The ticket is wired to
    // a vendor (directly) and a partner (via siteLocation.partnerId). Both
    // partner and vendor each have one user that exists ONLY through
    // `user_org_memberships` — no legacy `users.partner_id` /
    // `users.vendor_id` is set on either fixture row.
    const admin = seedSystemAdmin();
    const partner = seedPartner(100, "Acme");
    const vendor = seedVendor(200, "Beta");

    const partnerUserId = await addPartnerMember(partner.id, "p100@example.com");
    const vendorUserId = await addVendorMember(vendor.id, "v200@example.com");

    // Defensive sanity: neither user has the legacy columns populated.
    const pUser = fixtures.users.find((u) => u.id === partnerUserId)!;
    const vUser = fixtures.users.find((u) => u.id === vendorUserId)!;
    expect(pUser.partnerId).toBeUndefined();
    expect(vUser.vendorId).toBeUndefined();

    const site = { id: 1, partnerId: partner.id, name: "HQ" };
    fixtures.siteLocations.push(site);
    const ticket = {
      id: 1,
      vendorId: vendor.id,
      siteLocationId: site.id,
      fieldEmployeeId: null,
      status: "in_progress",
      checkInTime: new Date(),
      checkOutTime: null,
      updatedAt: new Date(),
      createdAt: new Date(),
    };
    fixtures.tickets.push(ticket);

    const postRes = await request(app)
      .post(`/api/tickets/${ticket.id}/comments`)
      .set("Cookie", adminCookie(admin.id))
      .send({ content: "Status update from admin" });
    expectStatus(postRes, 201);

    // The recipient set comes from ticketParticipantUserIds → which calls
    // findPartnerUserIds(site.partnerId) + findVendorUserIds(ticket.vendorId)
    // and unions the result. Both newly-created users MUST be there.
    const recipientUserIds = fixtures.notifications.map((n) => n.userId);
    expect(recipientUserIds).toContain(partnerUserId);
    expect(recipientUserIds).toContain(vendorUserId);
    // The author must NOT be notified for their own comment.
    expect(recipientUserIds).not.toContain(admin.id);
    // Every queued notification is the comment_added type.
    expect(
      fixtures.notifications.every((n) => n.type === "comment_added"),
    ).toBe(true);
  });

  it("hotlist.ts POST /api/hotlist/bids/:id/award fans out to membership-only vendor user", async () => {
    // Setup: a partner-owned hotlist job with one open bid from a vendor
    // whose only user was created via `user_org_memberships`. Awarding
    // the bid must notify that user via `findVendorUserIds`.
    const partnerOwnerUser = seedSystemAdmin();
    partnerOwnerUser.role = "partner";
    const partner = seedPartner(300, "Owner Partner");
    const vendor = seedVendor(400, "Bidding Vendor");

    // Partner owner needs a membership so resolveContext is consistent —
    // not strictly required by the route (it trusts the cookie payload)
    // but mirrors the production setup.
    fixtures.userOrgMemberships.push({
      id: nextId("userOrgMemberships"),
      userId: partnerOwnerUser.id,
      orgType: "partner",
      partnerId: partner.id,
      vendorId: null,
      role: "admin",
      vendorPeopleId: null,
      createdAt: new Date(),
    });

    const vendorUserId = await addVendorMember(vendor.id, "winner@example.com");
    const vUser = fixtures.users.find((u) => u.id === vendorUserId)!;
    expect(vUser.vendorId).toBeUndefined(); // legacy column NOT written

    const job = {
      id: 1,
      partnerId: partner.id,
      title: "Roof repair",
      description: null,
      status: "open",
      latitude: 0,
      longitude: 0,
      awardedBidId: null,
      awardedVendorId: null,
      createdAt: new Date(),
    };
    fixtures.hotlistJobs.push(job);
    const bid = {
      id: 1,
      jobId: job.id,
      vendorId: vendor.id,
      amountUsd: "500.00",
      etaDays: 3,
      notes: null,
      status: "pending",
      createdAt: new Date(),
    };
    fixtures.hotlistBids.push(bid);

    const awardRes = await request(app)
      .post(`/api/hotlist/bids/${bid.id}/award`)
      .set("Cookie", partnerCookie(partnerOwnerUser.id, partner.id));
    expectStatus(awardRes, 200);

    const awarded = fixtures.notifications.filter(
      (n) => n.type === "job_awarded",
    );
    expect(awarded.length).toBeGreaterThan(0);
    expect(awarded.map((n) => n.userId)).toContain(vendorUserId);
  });

  it("rules-engine runRulesEngine notifies membership-only partner + vendor users for stale pending tickets", async () => {
    // Setup: a single ticket that has been pending review for >30 days.
    // `rulePendingTicketsLong` joins tickets→siteLocations and fans out
    // via findPartnerUserIds + findVendorUserIds. Both newly-created
    // membership-only users must receive the notification.
    seedSystemAdmin();
    const partner = seedPartner(500);
    const vendor = seedVendor(600);
    const partnerUserId = await addPartnerMember(partner.id, "p500@example.com");
    const vendorUserId = await addVendorMember(vendor.id, "v600@example.com");

    const site = { id: 1, partnerId: partner.id, name: "HQ" };
    fixtures.siteLocations.push(site);
    const stale = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    fixtures.tickets.push({
      id: 1,
      vendorId: vendor.id,
      siteLocationId: site.id,
      fieldEmployeeId: null,
      status: "pending_review",
      checkInTime: null,
      checkOutTime: null,
      updatedAt: stale,
      createdAt: stale,
    });

    const summary = await rulesEngine.runRulesEngine();
    const pending = summary.find((s) => s.rule === "pending_tickets_long");
    expect(pending).toBeDefined();
    expect(pending!.error).toBeUndefined();
    expect(pending!.inserted).toBeGreaterThan(0);

    const pendingNotifs = fixtures.notifications.filter(
      (n) => n.type === "ticket_pending_long",
    );
    const recipients = pendingNotifs.map((n) => n.userId);
    expect(recipients).toContain(partnerUserId);
    expect(recipients).toContain(vendorUserId);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/orgs/:orgType/:orgId/members/:membershipId — invariants the
// route is responsible for, plus the active-membership re-pointing that
// `removeMembership()` handles when the deleted row was the user's active one.

function seedMembership(
  userId: number,
  orgType: OrgType,
  orgId: number,
  role: MembershipRole,
): Row {
  const m: Row = {
    id: nextId("userOrgMemberships"),
    userId,
    orgType,
    partnerId: orgType === "partner" ? orgId : null,
    vendorId: orgType === "vendor" ? orgId : null,
    role,
    vendorPeopleId: null,
    createdAt: new Date(),
  };
  fixtures.userOrgMemberships.push(m);
  return m;
}

function seedPartnerUser(
  username: string,
  orgRole: "admin" | "member",
  partnerId: number,
): { user: Row; membership: Row } {
  const user: Row = {
    id: nextId("users"),
    username,
    passwordHash: `hashed:${username}-pw`,
    role: "partner",
    displayName: username,
    activeMembershipId: null,
    preferredLanguage: null,
    sessionVersion: 1,
    createdAt: new Date(),
  };
  fixtures.users.push(user);
  const membership = seedMembership(user.id, "partner", partnerId, orgRole);
  user.activeMembershipId = membership.id;
  return { user, membership };
}

// Type alias mirrors the route's MembershipRole / OrgType shape without
// importing the source module (the seed helpers above are typed as plain
// strings to avoid pulling production types into the mock setup).
type OrgType = "partner" | "vendor";
type MembershipRole = "admin" | "member" | "ap" | "field_employee";

describe("DELETE /api/orgs/:orgType/:orgId/members/:membershipId", () => {
  it("system admin can remove an org member; row is gone and 204 returned", async () => {
    seedSystemAdmin();
    const partner = seedPartner(700, "Acme");

    // Create a brand-new partner member through the POST endpoint so we
    // exercise the same code path that real callers use to add members.
    const addRes = await request(app)
      .post(`/api/orgs/partner/${partner.id}/members`)
      .set("Cookie", adminCookie())
      .send({ email: "doomed@example.com", password: "supersecret" });
    expectStatus(addRes, 201);
    const membershipId: number = addRes.body.membershipId;

    const delRes = await request(app)
      .delete(`/api/orgs/partner/${partner.id}/members/${membershipId}`)
      .set("Cookie", adminCookie());
    expectStatus(delRes, 204);

    const remaining = fixtures.userOrgMemberships.find(
      (m) => m.id === membershipId,
    );
    expect(remaining).toBeUndefined();
  });

  it("org admin (non-system) can remove another member of their own org — exercises requireOrgAdmin", async () => {
    // The `system admin` short-circuit in `requireOrgAdmin` is already
    // covered above — this test specifically forces the membership-lookup
    // branch by signing in with a non-admin session role.
    const partner = seedPartner(710, "OrgAdmin Co");
    const { user: orgAdmin } = seedPartnerUser(
      "orgadmin@example.com",
      "admin",
      partner.id,
    );
    const { user: target, membership: targetMembership } = seedPartnerUser(
      "victim@example.com",
      "member",
      partner.id,
    );

    const cookie = partnerCookie(orgAdmin.id, partner.id);
    const delRes = await request(app)
      .delete(`/api/orgs/partner/${partner.id}/members/${targetMembership.id}`)
      .set("Cookie", cookie);
    expectStatus(delRes, 204);

    expect(
      fixtures.userOrgMemberships.find((m) => m.id === targetMembership.id),
    ).toBeUndefined();
    // The org admin's own membership is untouched.
    expect(
      fixtures.userOrgMemberships.find((m) => m.userId === orgAdmin.id),
    ).toBeDefined();
    // And the target user row itself is preserved (they may belong to
    // other orgs the caller can't see).
    expect(fixtures.users.find((u) => u.id === target.id)).toBeDefined();
  });

  it("403 when an org admin from another org tries to delete cross-org", async () => {
    // Caller is admin of partner A; target membership belongs to partner B.
    // requireOrgAdmin must reject because the caller has no admin row
    // for partner B — the membership-lookup branch returns "no match".
    const partnerA = seedPartner(720, "A Co");
    const partnerB = seedPartner(721, "B Co");
    const { user: aAdmin } = seedPartnerUser(
      "a-admin@example.com",
      "admin",
      partnerA.id,
    );
    const { membership: bMembership } = seedPartnerUser(
      "b-member@example.com",
      "member",
      partnerB.id,
    );

    const cookie = partnerCookie(aAdmin.id, partnerA.id);
    const delRes = await request(app)
      .delete(`/api/orgs/partner/${partnerB.id}/members/${bMembership.id}`)
      .set("Cookie", cookie);
    expect(delRes.status).toBe(403);
    expect(delRes.body.code).toBe("auth.forbidden");

    // The target membership row is untouched.
    expect(
      fixtures.userOrgMemberships.find((m) => m.id === bMembership.id),
    ).toBeDefined();
  });

  it("401 with auth.not_authenticated when no session cookie is present", async () => {
    // DELETE shares the same `requireOrgAdmin` guard as GET and POST.
    // GET and POST already have dedicated 401 coverage; mirror it here
    // for DELETE so a future refactor of the guard can't quietly start
    // letting anonymous callers tear down org memberships. Param parse
    // passes (partner / numeric id / numeric membership id) and the
    // org row exists, so the route falls through to requireOrgAdmin
    // which sees no cookie.
    const partner = seedPartner(722, "Anonymous DELETE Co");
    const { membership } = seedPartnerUser(
      "anon-delete-target@example.com",
      "member",
      partner.id,
    );

    const delRes = await request(app).delete(
      `/api/orgs/partner/${partner.id}/members/${membership.id}`,
    );
    expect(delRes.status).toBe(401);
    expect(delRes.body.code).toBe("auth.not_authenticated");

    // The targeted membership row is still present — the guard rejected
    // before reaching removeMembership.
    expect(
      fixtures.userOrgMemberships.find((m) => m.id === membership.id),
    ).toBeDefined();
  });

  it("400 when an org admin tries to remove their own membership (would lock themselves out)", async () => {
    const partner = seedPartner(730, "SoloAdmin Co");
    const { user: orgAdmin, membership } = seedPartnerUser(
      "self@example.com",
      "admin",
      partner.id,
    );

    const cookie = partnerCookie(orgAdmin.id, partner.id);
    const delRes = await request(app)
      .delete(`/api/orgs/partner/${partner.id}/members/${membership.id}`)
      .set("Cookie", cookie);
    expect(delRes.status).toBe(400);
    expect(delRes.body.code).toBe("members.cant_remove_self");

    // The membership is still there — the lockout guard rejected before
    // calling removeMembership.
    expect(
      fixtures.userOrgMemberships.find((m) => m.id === membership.id),
    ).toBeDefined();
  });

  it("a SYSTEM admin removing themselves is allowed (the self-lockout guard is for org admins only)", async () => {
    // Positive control for the previous test: the guard is keyed on
    // `!auth.isSystemAdmin`, so a system admin can still tear down a row
    // that happens to be their own. This protects refactors that move
    // the check earlier or drop the isSystemAdmin clause.
    const sysAdmin = seedSystemAdmin();
    const partner = seedPartner(731, "Cleanup Co");
    const membership = seedMembership(
      sysAdmin.id,
      "partner",
      partner.id,
      "admin",
    );

    const delRes = await request(app)
      .delete(`/api/orgs/partner/${partner.id}/members/${membership.id}`)
      .set("Cookie", adminCookie(sysAdmin.id));
    expectStatus(delRes, 204);
    expect(
      fixtures.userOrgMemberships.find((m) => m.id === membership.id),
    ).toBeUndefined();
  });

  it("400 for field-employee memberships — they're managed via the field-employee tools", async () => {
    seedSystemAdmin();
    const vendor = seedVendor(740, "Field Co");
    // Seed a user + a field_employee role membership directly; the POST
    // endpoint refuses field_employee logins, so we set up the row by
    // hand to test the DELETE-side guard in isolation.
    const fieldUser: Row = {
      id: nextId("users"),
      username: "field@example.com",
      passwordHash: "hashed:field",
      role: "field_employee",
      displayName: "Field Worker",
      activeMembershipId: null,
      preferredLanguage: null,
      createdAt: new Date(),
    };
    fixtures.users.push(fieldUser);
    const membership = seedMembership(
      fieldUser.id,
      "vendor",
      vendor.id,
      "field_employee",
    );

    const delRes = await request(app)
      .delete(`/api/orgs/vendor/${vendor.id}/members/${membership.id}`)
      .set("Cookie", adminCookie());
    expect(delRes.status).toBe(400);
    expect(delRes.body.code).toBe("members.field_only");

    // The membership row is untouched — the guard rejected before
    // reaching removeMembership.
    expect(
      fixtures.userOrgMemberships.find((m) => m.id === membership.id),
    ).toBeDefined();
  });

  it("404 when the membership belongs to a different org than the URL", async () => {
    seedSystemAdmin();
    const partnerA = seedPartner(750);
    const partnerB = seedPartner(751);
    const { membership: bMembership } = seedPartnerUser(
      "stray@example.com",
      "member",
      partnerB.id,
    );

    // System admin is allowed to manage any org but the route still
    // validates that the membershipId belongs to the URL's org so an
    // attacker can't enumerate by guessing ids across orgs.
    const delRes = await request(app)
      .delete(`/api/orgs/partner/${partnerA.id}/members/${bMembership.id}`)
      .set("Cookie", adminCookie());
    expect(delRes.status).toBe(404);
    expect(delRes.body.code).toBe("members.not_found");

    expect(
      fixtures.userOrgMemberships.find((m) => m.id === bMembership.id),
    ).toBeDefined();
  });

  it("removing a user's currently-active membership re-points activeMembershipId at the next remaining one", async () => {
    // The user belongs to two partner orgs; the active context is the
    // one we're about to delete. removeMembership() must pick the other
    // membership (lowest id wins) so the next login skips the picker
    // and lands directly in the surviving org.
    seedSystemAdmin();
    const partnerA = seedPartner(760);
    const partnerB = seedPartner(761);
    const user: Row = {
      id: nextId("users"),
      username: "two-orgs@example.com",
      passwordHash: "hashed:pw",
      role: "partner",
      displayName: "Two Orgs",
      activeMembershipId: null,
      preferredLanguage: null,
      createdAt: new Date(),
    };
    fixtures.users.push(user);
    const aMembership = seedMembership(
      user.id,
      "partner",
      partnerA.id,
      "member",
    );
    const bMembership = seedMembership(
      user.id,
      "partner",
      partnerB.id,
      "member",
    );
    user.activeMembershipId = aMembership.id;

    const delRes = await request(app)
      .delete(`/api/orgs/partner/${partnerA.id}/members/${aMembership.id}`)
      .set("Cookie", adminCookie());
    expectStatus(delRes, 204);

    const refreshed = fixtures.users.find((u) => u.id === user.id)!;
    expect(refreshed.activeMembershipId).toBe(bMembership.id);
    // The user row itself is preserved.
    expect(refreshed.username).toBe("two-orgs@example.com");
  });

  it("removing a user's only membership leaves activeMembershipId null so resolveContext returns null", async () => {
    // Sole membership case: nothing to re-point at, so activeMembershipId
    // stays null after the FK SET NULL cascade. This is what makes the
    // user's next login resolve to the no-context state.
    seedSystemAdmin();
    const partner = seedPartner(770);
    const user: Row = {
      id: nextId("users"),
      username: "lonely@example.com",
      passwordHash: "hashed:pw",
      role: "partner",
      displayName: "Lonely",
      activeMembershipId: null,
      preferredLanguage: null,
      createdAt: new Date(),
    };
    fixtures.users.push(user);
    const membership = seedMembership(
      user.id,
      "partner",
      partner.id,
      "member",
    );
    user.activeMembershipId = membership.id;

    const delRes = await request(app)
      .delete(`/api/orgs/partner/${partner.id}/members/${membership.id}`)
      .set("Cookie", adminCookie());
    expectStatus(delRes, 204);

    const refreshed = fixtures.users.find((u) => u.id === user.id)!;
    expect(refreshed.activeMembershipId).toBeNull();
    // No memberships remain for this user.
    expect(
      fixtures.userOrgMemberships.filter((m) => m.userId === user.id),
    ).toHaveLength(0);
  });

  it("bumps users.sessionVersion on the removed user so existing session tokens are invalidated immediately", async () => {
    // Mirrors the PATCH-side bump test. Without this, an admin who
    // removes a teammate from an org leaves a window in which the
    // removed user's cached Bearer token (encoding the old
    // partnerId/vendorId/role) keeps working until expiry. The bump
    // lives inside removeMembership() so it benefits every caller of
    // that helper (orgMembers DELETE, field-employee unassign, etc.).
    const partner = seedPartner(780, "Bump On Remove Co");
    const { user: orgAdmin } = seedPartnerUser(
      "remove-admin@example.com",
      "admin",
      partner.id,
    );
    const { user: teammate, membership: targetMembership } = seedPartnerUser(
      "remove-target@example.com",
      "member",
      partner.id,
    );
    // Sanity: seedPartnerUser starts users at sessionVersion 1, so any
    // post-DELETE value other than 2 means the increment didn't happen
    // — or happened twice.
    expect(teammate.sessionVersion).toBe(1);

    const delRes = await request(app)
      .delete(`/api/orgs/partner/${partner.id}/members/${targetMembership.id}`)
      .set("Cookie", partnerCookie(orgAdmin.id, partner.id));
    expectStatus(delRes, 204);

    // The removed teammate's sessionVersion column was incremented by
    // exactly one. The org admin who triggered the removal is
    // unaffected — only the user whose access changed should be signed
    // out.
    const refreshedTeammate = fixtures.users.find((u) => u.id === teammate.id);
    expect(refreshedTeammate?.sessionVersion).toBe(2);
    const refreshedAdmin = fixtures.users.find((u) => u.id === orgAdmin.id);
    expect(refreshedAdmin?.sessionVersion).toBe(1);
  });

  it("bumps users.sessionVersion even when the removed membership was the user's last one", async () => {
    // Last-membership corner case: after the delete the user has no
    // memberships left, so an old session token would resolve to
    // "no context" — but it would still authenticate the user.
    // The bump must happen on this path too so any cached token can no
    // longer pass the per-request session-version guard, regardless of
    // whether the user has another org to fall back to.
    seedSystemAdmin();
    const partner = seedPartner(781, "Last Membership Co");
    const user: Row = {
      id: nextId("users"),
      username: "last-membership@example.com",
      passwordHash: "hashed:pw",
      role: "partner",
      displayName: "Last Membership",
      activeMembershipId: null,
      preferredLanguage: null,
      sessionVersion: 1,
      createdAt: new Date(),
    };
    fixtures.users.push(user);
    const membership = seedMembership(
      user.id,
      "partner",
      partner.id,
      "member",
    );
    user.activeMembershipId = membership.id;

    const delRes = await request(app)
      .delete(`/api/orgs/partner/${partner.id}/members/${membership.id}`)
      .set("Cookie", adminCookie());
    expectStatus(delRes, 204);

    // No memberships remain — and the bump still fires so the cached
    // token is rejected on the next request.
    expect(
      fixtures.userOrgMemberships.filter((m) => m.userId === user.id),
    ).toHaveLength(0);
    const refreshed = fixtures.users.find((u) => u.id === user.id);
    expect(refreshed?.sessionVersion).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/orgs/:orgType/:orgId/members/:membershipId — role changes.
//
// The new PATCH handler lets an org admin promote a teammate to AP
// (Accounts Payable) or move them back to plain `member` without
// recreating the login. The cases below pin down the happy path plus
// the cross-org / self-demotion / role-validation guards that are easy
// to break inadvertently when the route is refactored. Each test asserts
// BOTH the HTTP status AND the response `code` because clients branch on
// the `code` (not the prose) to decide which UX to render.

describe("PATCH /api/orgs/:orgType/:orgId/members/:membershipId", () => {
  it("org admin upgrades a partner member from member → ap; response and DB row both reflect the new role", async () => {
    // Drive the membership-lookup branch of requireOrgAdmin (not the
    // system-admin short-circuit) so this test exercises the same
    // permission path a real partner admin would hit.
    const partner = seedPartner(900, "Promote Co");
    const { user: orgAdmin } = seedPartnerUser(
      "promote-admin@example.com",
      "admin",
      partner.id,
    );
    const { membership: targetMembership } = seedPartnerUser(
      "teammate@example.com",
      "member",
      partner.id,
    );

    const res = await request(app)
      .patch(`/api/orgs/partner/${partner.id}/members/${targetMembership.id}`)
      .set("Cookie", partnerCookie(orgAdmin.id, partner.id))
      .send({ role: "ap" });
    expectStatus(res, 200);
    expect(res.body).toMatchObject({
      membershipId: targetMembership.id,
      userId: targetMembership.userId,
      role: "ap",
    });

    // The DB row was actually mutated — guards against a regression
    // that quietly returns the requested role in the body without
    // persisting the update.
    const refreshed = fixtures.userOrgMemberships.find(
      (m) => m.id === targetMembership.id,
    );
    expect(refreshed?.role).toBe("ap");
  });

  it("bumps users.sessionVersion when a teammate's role changes so existing tokens are invalidated", async () => {
    // Without this bump, a freshly demoted teammate keeps their old
    // role's permissions until their session token expires — an admin
    // who needs to revoke access right now would have to delete the
    // membership and recreate it. Mirrors the same bump the POST
    // handler does when it mutates an existing membership's role.
    const partner = seedPartner(920, "Token Bump Co");
    const { user: orgAdmin } = seedPartnerUser(
      "bump-admin@example.com",
      "admin",
      partner.id,
    );
    const { user: teammate, membership: targetMembership } = seedPartnerUser(
      "bump-target@example.com",
      "member",
      partner.id,
    );
    // Sanity: seeded users start at sessionVersion 1 (matches the
    // production schema default), so any post-PATCH value other than 2
    // means the increment didn't happen — or happened twice.
    expect(teammate.sessionVersion).toBe(1);

    const res = await request(app)
      .patch(`/api/orgs/partner/${partner.id}/members/${targetMembership.id}`)
      .set("Cookie", partnerCookie(orgAdmin.id, partner.id))
      .send({ role: "ap" });
    expectStatus(res, 200);

    // The teammate's sessionVersion column was incremented by exactly
    // one. The org admin who made the change is unaffected — only the
    // user whose role changed should be signed out.
    const refreshedTeammate = fixtures.users.find((u) => u.id === teammate.id);
    expect(refreshedTeammate?.sessionVersion).toBe(2);
    const refreshedAdmin = fixtures.users.find((u) => u.id === orgAdmin.id);
    expect(refreshedAdmin?.sessionVersion).toBe(1);
  });

  it("does NOT bump users.sessionVersion on the no-op short-circuit (role unchanged)", async () => {
    // The PATCH handler short-circuits when the requested role matches
    // the current one. Bumping sessionVersion on that path would sign
    // teammates out for purely cosmetic re-saves (e.g. a UI that
    // re-PATCHes on every blur), so the bump must be tied to an actual
    // role change.
    const partner = seedPartner(921, "No-op Co");
    const { user: orgAdmin } = seedPartnerUser(
      "noop-admin@example.com",
      "admin",
      partner.id,
    );
    const { user: teammate, membership: targetMembership } = seedPartnerUser(
      "noop-target@example.com",
      "member",
      partner.id,
    );
    expect(teammate.sessionVersion).toBe(1);

    const res = await request(app)
      .patch(`/api/orgs/partner/${partner.id}/members/${targetMembership.id}`)
      .set("Cookie", partnerCookie(orgAdmin.id, partner.id))
      .send({ role: "member" });
    expectStatus(res, 200);

    const refreshedTeammate = fixtures.users.find((u) => u.id === teammate.id);
    expect(refreshedTeammate?.sessionVersion).toBe(1);
  });

  it("400 members.invalid_role when an unknown role is sent on a partner org", async () => {
    // Sanity guard for the parseMemberRole allowlist on partner orgs:
    // anything outside admin/member/ap must be rejected before we ever
    // hit the membership lookup.
    seedSystemAdmin();
    const partner = seedPartner(901, "Bad Role Co");
    const { membership } = seedPartnerUser(
      "bad-role-target@example.com",
      "member",
      partner.id,
    );

    const res = await request(app)
      .patch(`/api/orgs/partner/${partner.id}/members/${membership.id}`)
      .set("Cookie", adminCookie())
      .send({ role: "superuser" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("members.invalid_role");

    // The membership row is untouched — the guard fired before any
    // update happened.
    const refreshed = fixtures.userOrgMemberships.find(
      (m) => m.id === membership.id,
    );
    expect(refreshed?.role).toBe("member");
  });

  it("400 members.invalid_role when ap is requested for a vendor org (AP is partner-only)", async () => {
    // The "ap" role only exists on the partner side — vendor orgs
    // have no Accounts Payable concept. parseMemberRole gates this so
    // a vendor admin can't hand out a role that has no UI surface and
    // no semantic meaning in vendor-land.
    seedSystemAdmin();
    const vendor = seedVendor(902, "Vendor No AP Co");
    // Seed a vendor user directly so we don't have to rely on the
    // partner-only seedPartnerUser helper. The membership row is the
    // only thing the PATCH handler reads.
    const vendorUser: Row = {
      id: nextId("users"),
      username: "vendor-target@example.com",
      passwordHash: "hashed:vt",
      role: "vendor",
      displayName: "Vendor Target",
      activeMembershipId: null,
      preferredLanguage: null,
      createdAt: new Date(),
    };
    fixtures.users.push(vendorUser);
    const membership = seedMembership(
      vendorUser.id,
      "vendor",
      vendor.id,
      "member",
    );

    const res = await request(app)
      .patch(`/api/orgs/vendor/${vendor.id}/members/${membership.id}`)
      .set("Cookie", adminCookie())
      .send({ role: "ap" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("members.invalid_role");

    const refreshed = fixtures.userOrgMemberships.find(
      (m) => m.id === membership.id,
    );
    expect(refreshed?.role).toBe("member");
  });

  it("400 members.field_only when targeting a field-employee membership", async () => {
    // Field-employee memberships are managed via the field-employee
    // tools (the /field-employees/:id/login flow) — the org-members
    // PATCH route refuses to touch them so org admins can't quietly
    // promote a field crew login into an Accounts Payable role.
    seedSystemAdmin();
    const vendor = seedVendor(903, "Field Refusal Co");
    const fieldUser: Row = {
      id: nextId("users"),
      username: "field-target@example.com",
      passwordHash: "hashed:ft",
      role: "field_employee",
      displayName: "Field Worker",
      activeMembershipId: null,
      preferredLanguage: null,
      createdAt: new Date(),
    };
    fixtures.users.push(fieldUser);
    const membership = seedMembership(
      fieldUser.id,
      "vendor",
      vendor.id,
      "field_employee",
    );

    const res = await request(app)
      .patch(`/api/orgs/vendor/${vendor.id}/members/${membership.id}`)
      .set("Cookie", adminCookie())
      .send({ role: "member" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("members.field_only");

    // The membership row keeps its original field_employee role.
    const refreshed = fixtures.userOrgMemberships.find(
      (m) => m.id === membership.id,
    );
    expect(refreshed?.role).toBe("field_employee");
  });

  it("400 members.cant_demote_self when an org admin tries to demote their own admin row", async () => {
    // Self-lockout guard: if the only org admin demotes themselves,
    // the org is left without anyone who can manage memberships. The
    // route MUST refuse — even though parseMemberRole accepts the
    // target role, the demotion is rejected with a distinct code so
    // the client can render an actionable inline message instead of a
    // generic toast.
    const partner = seedPartner(904, "Self Demote Co");
    const { user: orgAdmin, membership } = seedPartnerUser(
      "self-demote@example.com",
      "admin",
      partner.id,
    );

    const res = await request(app)
      .patch(`/api/orgs/partner/${partner.id}/members/${membership.id}`)
      .set("Cookie", partnerCookie(orgAdmin.id, partner.id))
      .send({ role: "member" });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("members.cant_demote_self");

    // Row is unchanged — they're still admin.
    const refreshed = fixtures.userOrgMemberships.find(
      (m) => m.id === membership.id,
    );
    expect(refreshed?.role).toBe("admin");
  });

  it("404 members.not_found when the membership id belongs to a different org than the URL", async () => {
    // Cross-org guard: even a system admin (who can manage any org)
    // must not be able to mutate a membership that lives in partner B
    // by addressing it through partner A's URL — the route validates
    // that the membership row's partnerId/vendorId matches the URL's
    // org so an attacker can't enumerate or hijack rows by guessing
    // ids across orgs.
    seedSystemAdmin();
    const partnerA = seedPartner(905, "A Co");
    const partnerB = seedPartner(906, "B Co");
    const { membership: bMembership } = seedPartnerUser(
      "stray-patch@example.com",
      "member",
      partnerB.id,
    );

    const res = await request(app)
      .patch(`/api/orgs/partner/${partnerA.id}/members/${bMembership.id}`)
      .set("Cookie", adminCookie())
      .send({ role: "ap" });
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("members.not_found");

    // Partner B's membership row is untouched.
    const refreshed = fixtures.userOrgMemberships.find(
      (m) => m.id === bMembership.id,
    );
    expect(refreshed?.role).toBe("member");
    expect(refreshed?.partnerId).toBe(partnerB.id);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/orgs/:orgType/:orgId/members — error and authorization branches.
//
// The happy path is exercised indirectly by the partner / vendor membership
// flow tests above, but the route's own guard branches (param validation,
// unauthenticated, cross-org admin) had no dedicated coverage. Without these
// tests, a refactor of `requireOrgAdmin` could quietly let a partner admin
// list another partner's members. Each test asserts BOTH the HTTP status
// AND the response `code` because clients branch on `code` (not the prose)
// to decide which error UX to show.

describe("GET /api/orgs/:orgType/:orgId/members error and auth paths", () => {
  it("400 with members.invalid_org when orgType is not partner|vendor", async () => {
    // requireOrgAdmin should never even be consulted — the param parse
    // guard fires first, so we don't need to seed a session cookie. We
    // do send one anyway to prove the guard's error code wins over auth.
    seedSystemAdmin();

    const res = await request(app)
      .get(`/api/orgs/bogus/1/members`)
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("members.invalid_org");
  });

  it("400 with members.invalid_org when orgId is not numeric", async () => {
    // The same guard rejects a non-numeric `orgId`. Pinning this down
    // protects against a future change that swaps `Number.isFinite` for
    // a looser check (e.g. parseInt) and would silently treat
    // `notanumber` as NaN passed downstream.
    seedSystemAdmin();

    const res = await request(app)
      .get(`/api/orgs/partner/notanumber/members`)
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("members.invalid_org");
  });

  it("401 with auth.not_authenticated when no session cookie is present", async () => {
    // Param parse passes (partner / numeric id), so the route falls
    // through to requireOrgAdmin which sees no cookie and returns 401.
    seedPartner(900, "Anonymous Co");

    const res = await request(app).get(`/api/orgs/partner/900/members`);
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("auth.not_authenticated");
  });

  it("403 with auth.forbidden when an admin from another org tries to list", async () => {
    // Caller is an admin of partner A; they request the member list for
    // partner B. requireOrgAdmin's membership-lookup branch must reject
    // because no admin row exists for partner B under this user. This is
    // the central authorization invariant — without it, a partner admin
    // could enumerate every other partner's user list.
    const partnerA = seedPartner(910, "A Co");
    const partnerB = seedPartner(911, "B Co");
    const { user: aAdmin } = seedPartnerUser(
      "a-admin-list@example.com",
      "admin",
      partnerA.id,
    );
    // Seed at least one member in partner B so a regression that drops
    // the auth check would visibly leak data — the response would
    // contain that user's username. We assert below that no leakage
    // happens regardless.
    seedPartnerUser("b-member-list@example.com", "member", partnerB.id);

    const res = await request(app)
      .get(`/api/orgs/partner/${partnerB.id}/members`)
      .set("Cookie", partnerCookie(aAdmin.id, partnerA.id));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("auth.forbidden");
    // Belt-and-braces: the response must not leak partner B's members
    // even in the prose body.
    expect(JSON.stringify(res.body)).not.toContain("b-member-list@example.com");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/orgs/:orgType/:orgId/members/:membershipId — URL-param guard.
//
// GET has dedicated tests for the `orgType`/`orgId` parse guard above; DELETE
// uses the same `parseOrgType` + `Number.isFinite` shape and must reject the
// same garbage. Without these tests, a future refactor that loosens or shares
// the param parser could silently let DELETE accept e.g. `/orgs/bogus/abc/...`
// and pass NaN / unknown orgType down to the membership lookup, where it
// might quietly match nothing (404) or — worse — match across orgs. Each
// test asserts BOTH the HTTP status AND the response `code` because clients
// branch on the `code` (not the prose) to decide which error UX to show.

describe("DELETE /api/orgs/:orgType/:orgId/members/:membershipId param guard", () => {
  it("400 with members.invalid_org when orgType is not partner|vendor", async () => {
    // requireOrgAdmin should never even be consulted — the param parse
    // guard fires first, so we don't need to seed a session cookie. We
    // do send one anyway to prove the guard's error code wins over auth.
    seedSystemAdmin();

    const res = await request(app)
      .delete(`/api/orgs/bogus/1/members/1`)
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("members.invalid_org");
  });

  it("400 with members.invalid_org when orgId is not numeric", async () => {
    // The same guard rejects a non-numeric `orgId`. Pinning this down
    // protects against a future change that swaps `Number.isFinite` for
    // a looser check (e.g. parseInt) and would silently treat
    // `notanumber` as NaN passed downstream into the membership lookup.
    seedSystemAdmin();

    const res = await request(app)
      .delete(`/api/orgs/partner/notanumber/members/1`)
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("members.invalid_org");
  });

  it("400 with members.invalid_params when membershipId is not numeric", async () => {
    // The org params parse fine here, so the guard falls through to the
    // membershipId check, which keeps the broader `invalid_params` code
    // since clients don't have a more specific UX for a bad membership id.
    seedSystemAdmin();

    const res = await request(app)
      .delete(`/api/orgs/partner/1/members/notanumber`)
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("members.invalid_params");
  });

  it("400 with members.invalid_params when membershipId is not numeric", async () => {
    // The DELETE guard also covers `membershipId` (GET has no such
    // param). Without this test, a refactor that splits the guard or
    // swaps `Number.isFinite` for a looser parser could silently let
    // `NaN` reach the membership lookup — at best returning a confusing
    // 404, at worst matching unintended rows across orgs. We seed the
    // system admin cookie so the param guard's error code wins over
    // auth, proving the guard fires before requireOrgAdmin.
    seedSystemAdmin();

    const res = await request(app)
      .delete(`/api/orgs/partner/1/members/abc`)
      .set("Cookie", adminCookie());
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("members.invalid_params");
  });
});
