import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";
const state = vi.hoisted(() => ({ writes: [] as any[], audit: [] as any[], recipient: null as any, user: {} as any }));
vi.mock("@workspace/db", async () => {
  const schema = await import("../../../../lib/db/src/schema");
  const tx: any = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => [state.user] }) }) }),
    insert: (table: any) => ({ values: (values: any) => {
      if (table === schema.workHubAuditLogTable) { state.audit.push(values); return Promise.resolve(); }
      return { onConflictDoUpdate: () => { state.writes.push(values); return Promise.resolve(); } };
    } }),
  };
  return { ...schema, db: { transaction: async (fn: any) => fn(tx) } };
});
vi.mock("../services/gate-alert-repository", () => ({ loadGateAlertRecipient: async () => state.recipient }));
import router from "./smsConsent";
const app = express(); app.use(express.json(), express.urlencoded({ extended: false }), cookieParser(), router);
const cookie = () => buildTestCookie({ userId: 7, role: "field_employee", vendorId: 3, vendorRole: "gatekeeper", activeMembershipId: 8, sv: 1 });
const form = { phone: "+14055551212", consent: "yes", policyVersion: "2026-08-24" };
beforeEach(() => {
  state.writes = []; state.audit = [];
  state.user = { id: 7, sessionVersion: 1, activeMembershipId: 8, suspendedAt: null };
  state.recipient = { userId: 7, gate: true, membershipId: 8, vendorPeopleId: 9, phone: "+14055551212", session: { sv: 1, vendorId: 3 } };
});
describe("public SMS enrollment save", () => {
  it("requires a signed-in account and a same-origin submission", async () => {
    expect((await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").send(form)).status).toBe(401);
    expect((await request(app).post("/notifications/sms-consent").set("Cookie", cookie()).set("Origin", "https://other.example").send(form)).status).toBe(403);
    expect(state.writes).toHaveLength(0);
  });
  it.each([{ language: "fr" }, { consent: undefined }, { policyVersion: "old" }, { phone: "not-a-number" }, { phone: "+14055559999" }])("does not save invalid or mismatched consent: %j", async delta => {
    const response = await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", cookie()).send({ ...form, ...delta });
    expect(response.status).toBe(400); expect(state.writes).toHaveLength(0);
  });
  it("records the exact disclosure and server time against the caller and enables only their bound Gate consent", async () => {
    const response = await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", cookie()).send({ ...form, userId: 99, consentedAt: "2000-01-01" });
    expect(response.status).toBe(200);
    expect(state.writes[0]).toMatchObject({ userId: 7, alertsSmsEnabled: true, smsConsentRecord: { phone: form.phone, source: "https://vndrly.ai/sms/", policyVersion: form.policyVersion } });
    expect(state.writes[0].smsConsentRecord.disclosure).toContain("Reply STOP");
    expect(state.writes[0].alertsSmsConsentFingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(state.audit[0]).toMatchObject({ actorUserId: 7, action: "sms_consent_granted" });
    expect(JSON.stringify(state.audit)).not.toContain(form.phone);
    expect(response.body).toMatchObject({ saved: true, gateAlertsEnabled: true, messageSent: false });
  });
  it("retains the exact Spanish consent and source without sending SMS", async () => {
    const response = await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", cookie()).send({ ...form, language: "es" });
    expect(response.status).toBe(200);
    expect(state.writes[0].smsConsentRecord).toMatchObject({ language: "es", source: "https://vndrly.ai/es/sms/" });
    const { PUBLIC_SMS_CONSENT_DISCLOSURE_ES } = await import("@workspace/api-zod/legal-policy");
    expect(state.writes[0].smsConsentRecord.disclosure).toBe(PUBLIC_SMS_CONSENT_DISCLOSURE_ES);
    expect(state.audit[0].metadata.disclosure).toBe(PUBLIC_SMS_CONSENT_DISCLOSURE_ES);
    expect(response.body.messageSent).toBe(false);
  });
  it("saves an office user's consent without inventing Gate privileges or sending a message", async () => {
    state.recipient.gate = false;
    const office = buildTestCookie({ userId: 7, role: "vendor", vendorId: 3, activeMembershipId: 8, sv: 1 });
    const response = await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", office).send(form);
    expect(response.status).toBe(200); expect(state.writes[0]).not.toHaveProperty("alertsSmsEnabled");
    expect(response.body.gateAlertsEnabled).toBe(false);
  });
  it("fails closed if the live membership changed", async () => {
    state.recipient.membershipId = 10;
    expect((await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", cookie()).send(form)).status).toBe(409);
    expect(state.writes).toHaveLength(0);
  });
  it.each([{ sessionVersion: 2 }, { activeMembershipId: 10 }, { suspendedAt: new Date() }])("rejects an account revoked between lookup and save: %j", async delta => {
    Object.assign(state.user, delta);
    expect((await request(app).post("/notifications/sms-consent").set("Origin", "https://vndrly.ai").set("Cookie", cookie()).send(form)).status).toBe(409);
    expect(state.writes).toHaveLength(0); expect(state.audit).toHaveLength(0);
  });
});
