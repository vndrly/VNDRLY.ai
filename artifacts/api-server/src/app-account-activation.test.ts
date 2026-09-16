import request from "supertest";
import { describe, it, expect } from "vitest";
import app from "./app";
import { buildTestCookie } from "./test-utils/session";
const isolated =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" ||
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";
describe.skipIf(!isolated)("assembled app public account activation", () => {
  const path =
    "/api/implementation-a/account-invitations/activate/" + "0".repeat(64);
  it("lets unauthenticated users validate and redeem activation tokens", async () => {
    const status = await request(app).get(path);
    expect(status.status).toBe(200);
    expect(status.body).toEqual({ state: "invalid" });
    expect(status.headers["cache-control"]).toBe("no-store");
    const claim = await request(app)
      .post(path)
      .send({
        password: "test-only-activation-password",
        authorizationVersion: "work-participation-2026-09",
      });
    expect(claim.status).toBe(410);
    expect(claim.body.code).toBe("account_invitation.invalid");
  });
  it("allows activation with guest cookies or an invalidated staff session", async () => {
    const guest = buildTestCookie({ userId: 999999, role: "guest" }).replace(
      "vndrly_session=",
      "vndrly_guest=",
    );
    const stale = buildTestCookie({
      userId: 999999,
      role: "vendor",
      vendorId: 999999,
      membershipRole: "admin",
      sv: 999,
    });
    for (const cookie of [guest, stale]) {
      const result = await request(app).get(path).set("Cookie", cookie);
      expect(result.status).toBe(200);
      expect(result.body).toEqual({ state: "invalid" });
    }
  });
  it("keeps account issuance and malformed token routes authenticated", async () => {
    expect(
      (
        await request(app)
          .post("/api/implementation-a/account-invitations")
          .send({})
      ).status,
    ).toBe(401);
    expect(
      (
        await request(app).get(
          "/api/implementation-a/account-invitations/activate/not-a-token",
        )
      ).status,
    ).toBe(401);
  });
});
