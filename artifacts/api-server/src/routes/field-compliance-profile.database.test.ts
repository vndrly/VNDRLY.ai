import { randomUUID } from "node:crypto";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import { assertFreshLocalTestDatabaseEnvironment } from "../../../../scripts/fresh-test-database.mjs";
import { buildTestCookie } from "../test-utils/session";

const isolated = process.env.VNDRLY_TEST_DB_MODE === "fresh-local" && process.env.VNDRLY_ISOLATED_TEST_DB === "1";

describe.skipIf(!isolated)("Compliance Card profile creation with PostgreSQL constraints", () => {
  let pool: typeof import("@workspace/db").pool;
  let app: express.Express;
  beforeAll(async () => {
    assertFreshLocalTestDatabaseEnvironment(process.env);
    ({ pool } = await import("@workspace/db"));
    const { default: router } = await import("./field");
    app = express().use(express.json()).use(cookieParser()).use("/api", router);
  });

  async function fixture() {
    const email = `${randomUUID()}@example.invalid`;
    const vendorId = (await pool.query("INSERT INTO vendors(name,contact_name,contact_email) VALUES($1,'Synthetic',$2) RETURNING id", [`Compliance ${email}`, email])).rows[0].id as number;
    const userId = (await pool.query("INSERT INTO users(username,email,password_hash,role,display_name) VALUES($1,$1,'unusable-synthetic','vendor','Compliance Person') RETURNING id", [email])).rows[0].id as number;
    const cookie = buildTestCookie({ userId, vendorId, role: "vendor", vendorRole: "gatekeeper" });
    const post = () => request(app).post("/api/field/me/compliance-profile").set("Cookie", cookie).send({});
    const people = () => pool.query("SELECT id,user_id,is_active,deleted_at,vendor_id,roles FROM vendor_people WHERE user_id=$1", [userId]);
    return { email, vendorId, userId, post, people };
  }

  it.each(["deleted", "inactive"])("returns an actionable conflict for a %s linked profile without duplicating or restoring it", async (state) => {
    const f = await fixture();
    const deletedAt = state === "deleted" ? new Date("2026-11-13T03:53:54Z") : null;
    const id = (await pool.query("INSERT INTO vendor_people(vendor_id,user_id,first_name,last_name,email,vendor_role,is_active,deleted_at) VALUES($1,$2,'Gate','Keeper',$3,'gatekeeper',false,$4) RETURNING id", [f.vendorId, f.userId, f.email, deletedAt])).rows[0].id;
    for (const response of await Promise.all([f.post(), f.post()])) {
      expect(response.status).toBe(409);
      expect(response.body).toMatchObject({ error: "compliance_profile_unavailable" });
      expect(response.body.message).toContain("inactive or removed");
    }
    expect((await f.people()).rows).toEqual([expect.objectContaining({ id, user_id: f.userId, is_active: false, deleted_at: deletedAt })]);
  });

  it("creates one profile under concurrent requests, then reuses it", async () => {
    const f = await fixture();
    const responses = await Promise.all([f.post(), f.post(), f.post()]);
    expect(responses.map(r => r.status).sort()).toEqual([200, 200, 201]);
    const ids = responses.map(r => r.body.employeeId);
    expect(ids.every(id => Number.isInteger(id) && id === ids[0])).toBe(true);
    expect((await f.people()).rows).toEqual([expect.objectContaining({ id: ids[0], is_active: true, deleted_at: null, roles: [] })]);
    expect((await f.post()).body.employeeId).toBe(ids[0]);
  });

  it("links an active email match and preserves its existing record", async () => {
    const f = await fixture();
    const id = (await pool.query("INSERT INTO vendor_people(vendor_id,first_name,last_name,email,vendor_role) VALUES($1,'Existing','Person',$2,'gatekeeper') RETURNING id", [f.vendorId, f.email.toUpperCase()])).rows[0].id;
    const response = await f.post();
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ employeeId: id });
    expect((await f.people()).rows).toHaveLength(1);
  });

  it("does not move a profile from another company", async () => {
    const f = await fixture(), other = await fixture();
    const id = (await pool.query("INSERT INTO vendor_people(vendor_id,user_id,first_name,last_name,email,vendor_role) VALUES($1,$2,'Other','Company',$3,'gatekeeper') RETURNING id", [other.vendorId, f.userId, f.email])).rows[0].id;
    expect((await f.post()).status).toBe(409);
    expect((await f.people()).rows).toEqual([expect.objectContaining({ id, vendor_id: other.vendorId })]);
  });
});
