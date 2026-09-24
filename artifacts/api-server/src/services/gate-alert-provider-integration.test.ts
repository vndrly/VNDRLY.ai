import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
const storage = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: storage }));
import { loadGateAlertRecipient, gateAlertDependencies, applyTwilioStatus } from "./gate-alert-repository";
import { requireChangeOverAccess } from "./gate-change-over";
import { isPermanentSmsError, createTwilioStatusRouter } from "../routes/twilioStatus";
const notice = { id: 2, userId: 7, type: "safety_stop_work", title: "Private", link: "/work-hub" };
beforeEach(() => { vi.resetAllMocks(); vi.stubEnv("SENDGRID_API_KEY", "test"); vi.stubEnv("SENDGRID_FROM_EMAIL", "test@example.invalid"); });
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("passes the real current-session guard and rejects a subsequently revoked session", async () => {
  let version = 4;
  storage.query.mockImplementation(async (sql: string) => {
    if (sql.includes('u.id AS "userId"')) return { rows: [{ userId: 7, sessionVersion: 4, membershipId: 8, vendorId: 3, vendorPeopleId: 9, vendorRole: "gatekeeper", membershipRole: "field_employee" }] };
    if (sql.includes("session_version")) return { rows: [{ id: 7, session_version: version }] };
    return { rows: [{ id: 1, vendor_role: "gatekeeper" }], rowCount: 1 };
  });
  const recipient = await loadGateAlertRecipient(7);
  await expect(requireChangeOverAccess(storage as any, recipient!.session, 1)).resolves.toMatchObject({ supervisor: false });
  expect(storage.query.mock.calls[0][0]).toContain('u.session_version AS "sessionVersion"');
  version++;
  await expect(requireChangeOverAccess(storage as any, recipient!.session, 1)).rejects.toMatchObject({ status: 401 });
});
it.each(["30003", "30005", "30006"])("does not revoke consent for non-opt-out delivery error %s", code => {
  expect(isPermanentSmsError(code)).toBe(false);
});
it.each([429, 503])("preserves real SendGrid %s as a definite retryable rejection", async status => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("private provider body", { status })));
  await expect(gateAlertDependencies.email(notice, { email: "test@example.invalid" } as any)).resolves.toMatchObject({ accepted: false, errorCode: String(status), permanent: false });
});
it("does not classify a real sender timeout or disconnect as definite rejection", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("timeout"); }));
  await expect(gateAlertDependencies.email(notice, { email: "test@example.invalid" } as any)).rejects.toThrow();
  vi.stubGlobal("fetch", vi.fn(async () => { throw new TypeError("connection reset after write"); }));
  await expect(gateAlertDependencies.email(notice, { email: "test@example.invalid" } as any)).rejects.toThrow();
});
it.each(["30003", "21610"])("integrates signed callback %s with the real consent mutation and replay guard", async code => {
  const attempt = "11111111-1111-4111-8111-111111111111";
  const url = "https://example.invalid/api/twilio/gate-alert-status";
  const body = { AccountSid: "AC" + "1".repeat(32), MessageSid: "SM" + "2".repeat(32), MessageStatus: "failed", ErrorCode: code };
  let status = "accepted";
  storage.connect.mockResolvedValue(storage);
  storage.query.mockImplementation(async (sql: string) => {
    if (sql.startsWith("SELECT d.id")) return { rows: [{ id: 1, userId: 7, status, providerMessageId: body.MessageSid, consentFingerprint: "current", consentOptedInAt: new Date("2026-09-01") }] };
    if (sql.startsWith("UPDATE notification_channel_deliveries")) status = "failed";
    return { rows: [] };
  });
  const app = express(); app.use(express.urlencoded({ extended: false }));
  app.use("/api", createTwilioStatusRouter({ config: () => ({ url, authToken: "test", accountSid: body.AccountSid }), apply: applyTwilioStatus }));
  const signature = createHmac("sha1", "test").update(`${url}?attempt=${attempt}` + Object.keys(body).sort().map(k => k + body[k as keyof typeof body]).join("")).digest("base64");
  for (let i = 0; i < 2; i++) expect((await request(app).post(`/api/twilio/gate-alert-status?attempt=${attempt}`).set("X-Twilio-Signature", signature).type("form").send(body)).status).toBe(204);
  expect(storage.query.mock.calls.filter(([sql]) => sql.startsWith("UPDATE notification_preferences"))).toHaveLength(code === "21610" ? 1 : 0);
  expect(storage.query.mock.calls.filter(([sql]) => sql.startsWith("UPDATE notification_channel_deliveries"))).toHaveLength(1);
});
