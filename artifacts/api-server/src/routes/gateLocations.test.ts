import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { buildTestCookie } from "../test-utils/session";
import { createGateLocationsRouter } from "./gateLocations";

vi.mock("@workspace/db", () => ({
  pool: {
    connect: () => {
      throw new Error("Real database forbidden");
    },
  },
}));
const admin = {
  userId: 1,
  role: "vendor",
  vendorId: 41,
  membershipRole: "admin",
  vendorRole: null as string | null,
  sv: 1,
};
const values = {
  siteId: 22,
  name: "West road gate",
  latitude: 35.2,
  longitude: -97.2,
  geofenceRadiusM: 150,
  active: true,
};
function fixture() {
  const gates: any[] = [],
    audits: any[] = [],
    statements: string[] = [];
  let authorized = true;
  const query = async (sql: string, p: any[] = []) => {
    statements.push(sql);
    let rows: any[] = [];
    if (sql.includes("FROM user_org_memberships"))
      rows = authorized && p[1] === 41 ? [{ id: 5 }] : [];
    else if (sql.includes("FROM site_locations"))
      rows =
        authorized && p[0] === 41
          ? [
              {
                id: 22,
                name: "Partner wellhead",
                latitude: 35.42,
                longitude: -97.2,
              },
            ]
          : [];
    else if (sql.includes("FROM work_hub_audit_log"))
      rows = audits
        .filter((a) => a.key === p[2])
        .map((a) => ({ metadata: a.metadata }));
    else if (sql.startsWith("INSERT INTO gate_stations")) {
      const gate = {
        id: randomUUID(),
        siteId: p[0],
        name: p[1],
        latitude: p[2],
        longitude: p[3],
        geofenceRadiusM: p[4],
        active: p[5],
        version: 1,
      };
      gates.push(gate);
      rows = [gate];
    } else if (sql.startsWith("UPDATE gate_stations")) {
      const gate = gates.find(
        (g) => g.id === p[6] && g.version === p[7] && g.siteId === p[0],
      );
      if (gate) {
        Object.assign(gate, {
          name: p[1],
          latitude: p[2],
          longitude: p[3],
          geofenceRadiusM: p[4],
          active: p[5],
          version: gate.version + 1,
        });
        rows = [gate];
      }
    } else if (sql.startsWith("INSERT INTO work_hub_audit_log"))
      audits.push({ key: p[5], metadata: JSON.parse(p[6]) });
    else if (sql.includes("FROM gate_stations"))
      rows = gates.filter((g) => g.siteId === p[0]);
    return { rows: structuredClone(rows), rowCount: rows.length };
  };
  const app = express()
    .use(express.json())
    .use(cookieParser())
    .use(
      createGateLocationsRouter({
        connect: async () => ({ query, release() {} }),
      } as any),
    );
  const post = (path: string, body: object, session = admin) =>
    request(app)
      .post(`/gate-locations${path}`)
      .set("Cookie", buildTestCookie(session))
      .send(body);
  const save = async (change = values, extra = {}) => {
    const input = { ...change, ...extra };
    const preview = await post("/preview", input);
    return post("", {
      ...input,
      confirmation: preview.body.confirmation,
      idempotencyKey: randomUUID(),
    });
  };
  return {
    app,
    post,
    save,
    gates,
    audits,
    statements,
    revoke: () => {
      authorized = false;
    },
  };
}
describe("physical gate location management", () => {
  it("allows a current vendor administrator even when they also hold a gate role", async () => {
    const h = fixture();
    expect(
      (
        await h.post("/preview", values, {
          ...admin,
          vendorRole: "gate_supervisor",
        })
      ).status,
    ).toBe(200);
  });

  it("requires authentication and denies gatekeepers, supervisors, partner and cross-org administrators", async () => {
    const h = fixture();
    expect((await request(h.app).get("/gate-locations/sites")).status).toBe(
      401,
    );
    for (const session of [
      { ...admin, membershipRole: "member", vendorRole: "gatekeeper" },
      { ...admin, membershipRole: "member", vendorRole: "gate_supervisor" },
      { ...admin, role: "partner", partnerId: 7 },
      { ...admin, vendorId: 42 },
    ])
      expect((await h.post("/preview", values, session)).status).toBe(403);
  });
  it("creates multiple independent gates roughly fifteen miles from the wellhead without writing partner coordinates", async () => {
    const h = fixture();
    expect((await h.save()).body).toMatchObject({ ...values, version: 1 });
    expect((await h.save({ ...values, name: "East gate" })).status).toBe(200);
    expect(h.gates).toHaveLength(2);
    expect(h.audits).toHaveLength(2);
    expect(
      h.statements.some((s) =>
        /(?:UPDATE|INSERT INTO) site_locations/i.test(s),
      ),
    ).toBe(false);
  });
  it("requires exact reviewed values and rechecks revoked service access", async () => {
    const h = fixture();
    const preview = await h.post("/preview", values);
    expect(
      (
        await h.post("", {
          ...values,
          latitude: 36,
          confirmation: preview.body.confirmation,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(409);
    h.revoke();
    expect(
      (
        await h.post("", {
          ...values,
          confirmation: preview.body.confirmation,
          idempotencyKey: randomUUID(),
        })
      ).status,
    ).toBe(403);
    expect(h.gates).toHaveLength(0);
  });
  it("denies sites outside the serviced-site list and binds approval to the actor", async () => {
    const h = fixture();
    expect((await h.post("/preview", { ...values, siteId: 23 })).status).toBe(
      403,
    );
    const preview = await h.post("/preview", values);
    expect(
      (
        await h.post(
          "",
          {
            ...values,
            confirmation: preview.body.confirmation,
            idempotencyKey: randomUUID(),
          },
          { ...admin, userId: 2 },
        )
      ).status,
    ).toBe(409);
    expect(h.gates).toHaveLength(0);
  });
  it("requires a current canonical approved service relationship and exact site assignment", async () => {
    const h = fixture();
    await h.post("/preview", values);
    const scope = h.statements.find((s) => s.includes("FROM site_locations"))!;
    expect(scope).toContain("a.vendor_id=$1 AND a.site_location_id=s.id");
    expect(scope).toContain(
      "r.vendor_id=$1 AND r.partner_id=s.partner_id AND r.status=ANY($2::text[])",
    );
  });
  it("replays one write and audit, rejects operation reuse and stale edits, and supports deactivation/reactivation", async () => {
    const h = fixture();
    const preview = await h.post("/preview", values);
    const body = {
      ...values,
      confirmation: preview.body.confirmation,
      idempotencyKey: randomUUID(),
    };
    const first = await h.post("", body);
    expect(first.status).toBe(200);
    expect((await h.post("", body)).body).toEqual(first.body);
    expect(h.audits).toHaveLength(1);
    const changed = { ...values, name: "Changed" };
    const otherPreview = await h.post("/preview", changed);
    expect(
      (
        await h.post("", {
          ...body,
          ...changed,
          confirmation: otherPreview.body.confirmation,
        })
      ).status,
    ).toBe(409);
    const id = first.body.id;
    expect(
      (await h.save({ ...values, active: false }, { id, version: 1 })).body,
    ).toMatchObject({ active: false, version: 2 });
    expect((await h.save(values, { id, version: 1 })).status).toBe(409);
    expect((await h.save(values, { id, version: 2 })).body).toMatchObject({
      active: true,
      version: 3,
    });
  });
  it.each([
    { latitude: 91 },
    { longitude: -181 },
    { geofenceRadiusM: 0 },
    { geofenceRadiusM: 10001 },
    { name: " " },
  ])("rejects invalid physical values %o", async (invalid) => {
    expect(
      (await fixture().post("/preview", { ...values, ...invalid })).status,
    ).toBe(400);
  });
});
