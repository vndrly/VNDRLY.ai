import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
const state = vi.hoisted(() => ({ prefs: {} as any, recipient: null as any, writes: [] as any[], notices: [] as any[], fanout: vi.fn(), failBadge: false }));
vi.mock("@workspace/db", async () => {
  const schema = await import("../../../../lib/db/src/schema");
  return { ...schema, db: {
    select: (projection: any) => {
      if (projection?.n && state.failBadge) throw new Error("badge unavailable");
      return { from: () => ({ where: () => ({ then: (resolve: any) => Promise.resolve([state.prefs]).then(resolve), groupBy: async () => [] }) }) };
    },
    insert: (table: any) => ({ values: (values: any) => ({
      onConflictDoUpdate: () => ({ returning: async () => { state.writes.push(values); Object.assign(state.prefs, values); return [state.prefs]; } }),
      onConflictDoNothing: () => ({ returning: async () => { state.notices.push(...values); return values.map((v: any, i: number) => ({ id: i + 1, userId: v.userId, createdAt: new Date() })); } }),
    }) }),
  } };
});
vi.mock("../services/gate-alert-repository", () => ({ loadGateAlertRecipient: async () => state.recipient }));
vi.mock("../services/gate-alert-delivery", async importOriginal => ({ ...await importOriginal<any>(), deliverGateAlert: state.fanout }));
vi.mock("../lib/expo-push", () => ({ sendPushToUser: vi.fn(async () => ({ delivered: true })) }));
vi.mock("../lib/notification-events", () => ({ publishNotificationCreated: vi.fn(), publishNotificationStateChanged: vi.fn(), subscribeNotificationEvents: vi.fn(), getCurrentNotificationEventSeq: vi.fn() }));
import router, { notifyUsers } from "./notifications";
const app = express(); app.use(express.json(), cookieParser(), router);
const gateCookie = () => buildTestCookie({ userId: 7, role: "field_employee", vendorId: 3, vendorRole: "gatekeeper", activeMembershipId: 8 });
beforeEach(() => {
  state.prefs = { userId: 7 }; state.writes = []; state.notices = []; state.fanout.mockReset(); state.fanout.mockResolvedValue(undefined);
  state.failBadge = false;
  state.recipient = { userId: 7, gate: true, membershipId: 8, vendorPeopleId: 9, phone: "+14055551212", email: "worker@example.invalid", gateAlertsEnabled: true };
});
describe("gate alert preference authorization", () => {
  it("requires authentication and never accepts another user's consent target", async () => {
    expect((await request(app).patch("/notifications/preferences").send({ alertsSmsEnabled: true })).status).toBe(401);
    const response = await request(app).patch("/notifications/preferences").set("Cookie", gateCookie()).send({ alertsSmsEnabled: true, userId: 99, alertsSmsOptedInAt: "2000-01-01", alertsSmsConsentFingerprint: "forged" });
    expect(response.status).toBe(200);
    expect(state.writes[0].userId).toBe(7);
    expect(state.writes[0].alertsSmsOptedInAt).toBeInstanceOf(Date);
    expect(state.writes[0].alertsSmsConsentFingerprint).toMatch(/^[a-f0-9]{64}$/);
  });
  it.each([{ gate: false }, { phone: "invalid" }, { membershipId: 10 }])("rejects stale membership/invalid destination: %j", async patch => {
    Object.assign(state.recipient, patch);
    expect((await request(app).patch("/notifications/preferences").set("Cookie", gateCookie()).send({ alertsSmsEnabled: true })).status).toBe(400);
    expect(state.writes).toHaveLength(0);
  });
  it("ignores office requests to opt into gate SMS", async () => {
    await request(app).patch("/notifications/preferences").set("Cookie", buildTestCookie({ userId: 7, role: "vendor", vendorId: 3 })).send({ alertsSmsEnabled: true });
    expect(state.writes[0]).not.toHaveProperty("alertsSmsEnabled");
  });
  it("clears consent on opt-out without requiring a valid phone", async () => {
    state.recipient.phone = null;
    const response = await request(app).patch("/notifications/preferences").set("Cookie", gateCookie()).send({ alertsSmsEnabled: false });
    expect(response.status).toBe(200);
    expect(state.writes[0]).toMatchObject({ alertsSmsEnabled: false, alertsSmsOptedInAt: null, alertsSmsConsentFingerprint: null });
  });
  it("returns channel defaults and only a phone availability flag", async () => {
    const response = await request(app).get("/notifications/preferences").set("Cookie", gateCookie());
    expect(response.body).toMatchObject({ alertsEmailEnabled: true, alertsSmsEnabled: false, alertsSmsAvailable: true });
    expect(JSON.stringify(response.body)).not.toContain("14055551212");
  });
  it("saves the canonical inbox record even if channel dispatch fails", async () => {
    state.fanout.mockRejectedValueOnce(new Error("provider error"));
    await expect(notifyUsers([7], { type: "gate_closed", title: "Gate closed", link: "/gate?siteId=3" })).resolves.toBe(1);
    expect(state.notices).toHaveLength(1);
    expect(state.fanout).toHaveBeenCalledWith(expect.objectContaining({ id: 1, userId: 7, type: "gate_closed" }));
  });
  it("does not let the legacy badge query suppress urgent channel fanout", async () => {
    state.failBadge = true;
    await expect(notifyUsers([7], { type: "gate_closed", title: "Gate closed", link: "/gate?siteId=3" })).resolves.toBe(1);
    expect(state.fanout).toHaveBeenCalledOnce();
  });
});
