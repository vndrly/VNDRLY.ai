import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import cookieParser from "cookie-parser";
import request from "supertest";
import { buildTestCookie } from "../test-utils/session";

const state = vi.hoisted(() => ({ writes: [] as any[], audit: [] as any[], held: true }));
vi.mock("@workspace/db", async () => {
  const schema = await import("../../../../lib/db/src/schema");
  const tx: any = {
    select: () => ({ from: () => ({ where: () => ({ for: async () => [{ id: 7, sessionVersion: 1, activeMembershipId: 8, suspendedAt: null }] }) }) }),
    insert: (table: any) => ({ values: (values: any) => {
      if (table === schema.workHubAuditLogTable) { state.audit.push(values); return Promise.resolve(); }
      return { onConflictDoUpdate: () => { state.writes.push(values); return Promise.resolve(); } };
    } }),
  };
  return { ...schema, db: { transaction: async (fn: any) => fn(tx) }, pool: {
    query: async (sql: string) => ({ rows: sql.includes("SELECT DISTINCT recipient.user_id")
      ? state.held ? [{ user_id: 7 }] : []
      : [{ userId: 7, userRole: "field_employee", orgType: "vendor", membershipId: 8, membershipRole: "field_employee", vendorId: 1054,
        vendorPeopleId: 9, vendorRole: "gatekeeper", phone: "4055551212", sessionVersion: 1, grants: [] }] }),
  } };
});
vi.mock("../routes/notifications", () => ({ countGateUnreadNotifications: vi.fn(async () => 0) }));
import router from "./smsConsent";
import { loadGateAlertRecipient } from "../services/gate-alert-repository";

const app = express();
app.use(express.json(), cookieParser(), router);
const cookie = () => buildTestCookie({ userId: 7, role: "field_employee", vendorId: 1054, vendorRole: "gatekeeper", activeMembershipId: 8, sv: 1 });
beforeEach(() => { state.writes = []; state.audit = []; state.held = true; });

describe("SMS enrollment during a company delivery pause", () => {
  it("saves explicit domestic consent while outbound delivery remains paused", async () => {
    expect(await loadGateAlertRecipient(7)).toBeNull();
    const response = await request(app).post("/notifications/sms-consent")
      .set("Cookie", cookie()).set("Origin", "https://vndrly.ai")
      .send({ phone: "4055551212", consent: "yes", policyVersion: "2026-08-24" });
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ saved: true, messageSent: false });
    expect(state.writes).toHaveLength(1);
    expect(state.writes[0].smsConsentRecord.phone).toBe("+14055551212");
    expect(state.audit).toHaveLength(1);
    expect(await loadGateAlertRecipient(7)).toBeNull();
  });
});
