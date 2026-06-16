import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { attachTestErrorMiddleware } from "../test-utils/route-app";
import { buildTestCookie } from "../test-utils/session";
import { MAJIK_DEFAULT_CIRCLE_ID, MAJIK_STALE_MS } from "@workspace/majik";

// ── In-memory Majik store with join-aware predicate evaluation ───────────────

type Row = Record<string, unknown>;
type ColRef = { __table: string; __col: string };
type Pred =
  | { kind: "eq"; col: ColRef; val: unknown }
  | { kind: "and"; preds: Pred[] }
  | { kind: "true" };
type TaggedRow = Record<string, Row | null>;

function tableTag(name: string, cols: string[]) {
  const t: Record<string, ColRef | string> = { __name: name };
  for (const c of cols) t[c] = { __table: name, __col: c };
  return t as { __name: string } & Record<string, ColRef | string>;
}

const tables = {
  majikCircles: tableTag("majikCircles", ["id", "name", "maxMembers"]),
  majikCircleMembers: tableTag("majikCircleMembers", ["circleId", "userId"]),
  majikPresence: tableTag("majikPresence", ["circleId", "userId", "isUp", "updatedAt"]),
  users: tableTag("users", ["id", "displayName", "username", "email", "role"]),
};

const fixtures: Record<string, Row[]> = {
  majikCircles: [],
  majikCircleMembers: [],
  majikPresence: [],
  users: [],
};

function readFromTagged(row: TaggedRow, c: ColRef | undefined): unknown {
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
        pred.val && typeof pred.val === "object" && (pred.val as ColRef).__col
          ? readFromTagged(row, pred.val as ColRef)
          : pred.val;
      if (lhs == null && rhs == null) return false;
      return lhs === rhs;
    }
    case "and":
      return pred.preds.every((p) => evalPred(p, row));
  }
}

function projectRow(
  row: TaggedRow,
  cols: Record<string, ColRef | { __count: true }> | undefined,
): Row {
  if (!cols) {
    const keys = Object.keys(row);
    return keys.length ? { ...(row[keys[0]] ?? {}) } : {};
  }
  const out: Row = {};
  for (const [k, c] of Object.entries(cols)) {
    if (c && typeof c === "object" && "__count" in c) continue;
    out[k] = readFromTagged(row, c as ColRef);
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
  cols: Record<string, ColRef | { __count: true }> | undefined,
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
      filtered = [...filtered].sort((a, b) => {
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

    const hasCount = cols
      ? Object.values(cols).some(
          (c) => c && typeof c === "object" && "__count" in c,
        )
      : false;
    if (hasCount && cols) {
      const out: Row = {};
      for (const [k, c] of Object.entries(cols)) {
        if (c && typeof c === "object" && "__count" in c) {
          out[k] = filtered.length;
        }
      }
      return [out];
    }

    return filtered.map((r) => projectRow(r, cols));
  };

  const q: {
    leftJoin: (t: { __name: string }, on: Pred) => typeof q;
    innerJoin: (t: { __name: string }, on: Pred) => typeof q;
    where: (p: Pred) => typeof q;
    orderBy: (...args: unknown[]) => typeof q;
    limit: (n: number) => typeof q;
    then: (
      resolve: (value: Row[]) => unknown,
      reject?: (reason: unknown) => unknown,
    ) => Promise<unknown>;
  } = {
    leftJoin: (t, on) => {
      joins.push({ type: "left", table: t.__name, on });
      return q;
    },
    innerJoin: (t, on) => {
      joins.push({ type: "inner", table: t.__name, on });
      return q;
    },
    where: (p) => {
      where = p;
      return q;
    },
    orderBy: (...args) => {
      for (const a of args) {
        if (a && typeof a === "object" && "__orderBy" in a) {
          orderBy.push((a as { __orderBy: { col: ColRef; dir: "asc" | "desc" } }).__orderBy);
        }
      }
      return q;
    },
    limit: (n) => {
      limitN = n;
      return q;
    },
    then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
  };
  return q;
}

function makeInsert(tableName: string) {
  return {
    values: (v: Row | Row[]) => {
      const valsArr = Array.isArray(v) ? v : [v];
      let conflictTarget: ColRef[] | null = null;
      let conflictSet: Row | null = null;
      let conflictDoNothing = false;

      const apply = () => {
        const inserted: Row[] = [];
        for (const raw of valsArr) {
          const row = { ...raw };
          if (conflictTarget && conflictTarget.length > 0) {
            const existing = (fixtures[tableName] ?? []).find((r) =>
              conflictTarget!.every((c) => r[c.__col] === row[c.__col]),
            );
            if (existing) {
              if (conflictDoNothing) continue;
              if (conflictSet) Object.assign(existing, conflictSet);
              inserted.push(existing);
              continue;
            }
          }
          if (tableName === "majikCircleMembers") {
            const dup = (fixtures.majikCircleMembers ?? []).some(
              (m) =>
                m.circleId === row.circleId ||
                m.userId === row.userId,
            );
            if (dup) {
              throw new Error("duplicate key value violates unique constraint");
            }
          }
          fixtures[tableName].push(row);
          inserted.push(row);
        }
        return inserted;
      };

      const chain = {
        onConflictDoUpdate: (args: { target: ColRef[]; set: Row }) => {
          conflictTarget = args.target;
          conflictSet = args.set;
          return chain;
        },
        onConflictDoNothing: (args?: { target?: ColRef[] }) => {
          conflictTarget = args?.target ?? [];
          conflictDoNothing = true;
          return chain;
        },
        then: (
          resolve: (value: undefined) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(apply()).then(() => undefined).then(resolve, reject),
      };
      return chain;
    },
  };
}

const publishMajikEventMock = vi.fn();

vi.mock("../lib/majik-events", () => ({
  publishMajikEvent: publishMajikEventMock,
  subscribeMajikEvents: vi.fn(() => () => {}),
  getCurrentMajikEventSeq: vi.fn(async () => 0),
}));

vi.mock("../lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("@workspace/db", () => ({
  db: {
    select: (cols?: Record<string, ColRef | { __count: true }>) => ({
      from: (t: { __name: string }) => makeQuery(t.__name, cols),
    }),
    insert: (t: { __name: string }) => makeInsert(t.__name),
    delete: () => ({
      where: async () => undefined,
    }),
  },
  majikCirclesTable: tables.majikCircles,
  majikCircleMembersTable: tables.majikCircleMembers,
  majikPresenceTable: tables.majikPresence,
  usersTable: tables.users,
}));

vi.mock("drizzle-orm", () => ({
  and: (...preds: Pred[]) => ({ kind: "and", preds: preds.filter(Boolean) }),
  eq: (col: ColRef, val: unknown) => ({ kind: "eq", col, val }),
  asc: (col: ColRef) => ({ __orderBy: { col, dir: "asc" as const } }),
  count: () => ({ __count: true }),
  sql: () => ({ kind: "true" }),
}));

let app: express.Express;

beforeEach(async () => {
  for (const k of Object.keys(fixtures)) fixtures[k] = [];
  publishMajikEventMock.mockClear();
  vi.resetModules();
  const router = (await import("./majik")).default;
  app = express();
  app.use(cookieParser());
  app.use(express.json());
  app.use("/api", router);
  attachTestErrorMiddleware(app, { logErrors: false });
});

afterEach(() => {
  vi.clearAllMocks();
});

function memberCookie(
  overrides: Partial<{ userId: number; role: string; displayName: string }> = {},
) {
  return buildTestCookie({
    userId: 1,
    role: "admin",
    displayName: "Alice",
    ...overrides,
  });
}

function seedCircle(maxMembers = 8) {
  fixtures.majikCircles = [
    { id: MAJIK_DEFAULT_CIRCLE_ID, name: "Majik", maxMembers },
  ];
}

function seedMember(userId: number, displayName: string) {
  fixtures.users.push({ id: userId, displayName });
  fixtures.majikCircleMembers.push({
    circleId: MAJIK_DEFAULT_CIRCLE_ID,
    userId,
  });
}

describe("GET /api/majik/circle", () => {
  it("returns 403 when user is not a Majik member", async () => {
    seedCircle();
    const res = await request(app)
      .get("/api/majik/circle")
      .set("Cookie", memberCookie({ userId: 99, displayName: "Outsider" }));
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("majik.not_member");
  });

  it("marks presence older than 4 hours as stale on the snapshot", async () => {
    seedCircle();
    seedMember(1, "Alice");
    const staleAt = new Date(Date.now() - MAJIK_STALE_MS - 60_000);
    fixtures.majikPresence.push({
      circleId: MAJIK_DEFAULT_CIRCLE_ID,
      userId: 1,
      isUp: true,
      updatedAt: staleAt,
    });

    const res = await request(app)
      .get("/api/majik/circle")
      .set("Cookie", memberCookie({ userId: 1 }));

    expect(res.status).toBe(200);
    expect(res.body.members).toHaveLength(1);
    expect(res.body.members[0]).toMatchObject({
      userId: 1,
      isUp: true,
      effectiveUp: false,
      state: "stale",
    });
    expect(res.body.upCount).toBe(0);
  });
});

describe("GET /api/majik/me", () => {
  it("reports isMember true for circle members", async () => {
    seedCircle();
    seedMember(2, "Bob");

    const res = await request(app)
      .get("/api/majik/me")
      .set("Cookie", memberCookie({ userId: 2, displayName: "Bob" }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: 2,
      displayName: "Bob",
      isMember: true,
    });
  });

  it("reports isMember false for non-members", async () => {
    seedCircle();

    const res = await request(app)
      .get("/api/majik/me")
      .set("Cookie", memberCookie({ userId: 42, displayName: "Guest" }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      userId: 42,
      isMember: false,
    });
  });
});

describe("POST /api/majik/up", () => {
  it("publishes presence with effectiveUp true", async () => {
    seedCircle();
    seedMember(3, "Carol");

    const res = await request(app)
      .post("/api/majik/up")
      .set("Cookie", memberCookie({ userId: 3, displayName: "Carol" }));

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      ok: true,
      isUp: true,
      effectiveUp: true,
      state: "up",
    });
    expect(publishMajikEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "majik.presence_updated",
        circleId: MAJIK_DEFAULT_CIRCLE_ID,
        userId: 3,
        isUp: true,
        effectiveUp: true,
        state: "up",
      }),
    );
  });
});

describe("POST /api/admin/majik/members", () => {
  it("rejects the 9th member with majik.team_full", async () => {
    seedCircle(8);
    for (let i = 1; i <= 8; i++) {
      seedMember(i, `Member ${i}`);
    }
    fixtures.users.push({ id: 99, displayName: "Ninth" });

    const res = await request(app)
      .post("/api/admin/majik/members")
      .set("Cookie", memberCookie({ userId: 1, role: "admin" }))
      .send({ userId: 99 });

    expect(res.status).toBe(400);
    expect(res.body.code).toBe("majik.team_full");
  });
});
