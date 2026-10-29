import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { buildTestCookie } from "../test-utils/session";
const state = vi.hoisted(() => ({ people: [] as any[], memberships: [] as any[], accounts: [] as any[], writes: [] as string[] }));
vi.mock("@workspace/db", async () => {
  const schema = await vi.importActual<typeof import("@workspace/db/schema")>("@workspace/db/schema");
  const dialect = new PgDialect();
  const query = (mode: string, initial?: any) => {
    let table = initial, values: any, condition: any;
    const builder: any = {
      from(t: any) { table = t; return builder; }, where(c: any) { condition = c; return builder; },
      limit() { return builder; }, for() { return builder; }, returning() { return builder; },
      set(v: any) { values = v; return builder; }, values(v: any) { values = v; return builder; },
      then(resolve: any, reject: any) {
        try {
          const name = getTableName(table), params = condition ? dialect.sqlToQuery(condition).params : [];
          if (mode === "select") {
            const rows = name === "user_org_memberships" ? state.memberships.filter(m => params.includes(m.userId) && params.includes(m.vendorId)) : name === "users" ? state.accounts.filter(u => params.includes(u.id)) : state.people.filter(p => p.vendorId === params[0] && (p.userId === params[1] || p.email.toLowerCase() === String(params[2]).toLowerCase()));
            resolve(rows); return;
          }
          state.writes.push(`${mode}:${name}`);
          if (mode === "insert") { const row = { id: 88, ...values }; state.people.push(row); resolve([row]); return; }
          const rows = name === "user_org_memberships" ? state.memberships : state.people;
          for (const row of rows) if (params.includes(row.id)) Object.assign(row, values);
          resolve([]);
        } catch (cause) { reject(cause); }
      },
    }; return builder;
  };
  const db: any = { select: () => query("select"), insert: (t: any) => query("insert", t), update: (t: any) => query("update", t), transaction: (fn: any) => fn(db) };
  return { ...schema, db, pool: { query: vi.fn(() => { throw new Error("Unexpected database call"); }) } };
});
import router from "./vendors";
const app = express().use(express.json()).use(cookieParser()).use("/api", router);
const cookie = (vendorId = 7, membershipRole = "admin") => buildTestCookie({ userId: 1, role: "vendor", vendorId, membershipRole });
const body = { firstName: "Existing", lastName: "Admin", email: "existing@example.invalid", roles: ["Office Staff"] };
beforeEach(() => {
  state.people = []; state.writes = [];
  state.accounts = [{ id: 25, username: body.email, email: body.email }];
  state.memberships = [{ id: 42, vendorId: 7, userId: 25, role: "admin", vendorPeopleId: null }];
});
describe("staff profile linked to an existing company login", () => {
  it("reuses the existing login and membership without changing its privilege or password", async () => {
    const result = await request(app).post("/api/vendors/7/staff-profile-from-account/25").set("Cookie", cookie()).send(body);
    expect(result.status).toBe(200); expect(result.body).toMatchObject({ id: 88, vendorId: 7, userId: 25, vendorRole: "admin" });
    expect(state.memberships[0]).toMatchObject({ role: "admin", vendorPeopleId: 88 });
    expect(state.writes).not.toContain("update:users");
    const replay = await request(app).post("/api/vendors/7/staff-profile-from-account/25").set("Cookie", cookie()).send(body);
    expect(replay.body.id).toBe(88); expect(state.people).toHaveLength(1);
  });
  it("rejects another company, non-admin callers, and unrelated account emails", async () => {
    expect((await request(app).post("/api/vendors/8/staff-profile-from-account/25").set("Cookie", cookie()).send(body)).status).toBe(403);
    expect((await request(app).post("/api/vendors/7/staff-profile-from-account/25").set("Cookie", cookie(7, "member")).send(body)).status).toBe(403);
    expect((await request(app).post("/api/vendors/7/staff-profile-from-account/25").set("Cookie", cookie()).send({ ...body, email: "other@example.invalid" })).status).toBe(400);
    expect(state.writes).toEqual([]);
  });
  it("does not resurrect removed profiles or overwrite another user's identity", async () => {
    state.people = [{ id: 9, vendorId: 7, userId: 25, email: body.email, deletedAt: new Date() }];
    expect((await request(app).post("/api/vendors/7/staff-profile-from-account/25").set("Cookie", cookie()).send(body)).status).toBe(409);
    state.people = [{ id: 9, vendorId: 7, userId: 99, email: body.email, deletedAt: null }];
    expect((await request(app).post("/api/vendors/7/staff-profile-from-account/25").set("Cookie", cookie()).send(body)).status).toBe(409);
    expect(state.writes).toEqual([]);
  });
});
