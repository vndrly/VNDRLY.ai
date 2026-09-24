import { createHmac } from "node:crypto";
import express from "express";
import request from "supertest";
import { describe, expect, it, vi } from "vitest";
import { createTwilioStatusRouter, shouldApplyTwilioStatus } from "./twilioStatus";
import { PUBLIC_UNAUTHENTICATED_ALLOWLIST } from "../lib/publicApiAllowlist";
const base = "https://vndrly.ai/api/twilio/gate-alert-status";
const token = "test-auth-token";
const attempt = "11111111-1111-4111-8111-111111111111";
const body = { AccountSid: "AC" + "1".repeat(32), MessageSid: "SM" + "2".repeat(32), MessageStatus: "delivered", FutureParam: "included" };
function signature(url: string, params: Record<string, string>) {
  return createHmac("sha1", token).update(url + Object.keys(params).sort().map(k => k + params[k]).join("")).digest("base64");
}
function fixture() {
  const apply = vi.fn(async () => {});
  const app = express(); app.use(express.urlencoded({ extended: false }));
  app.use("/api", createTwilioStatusRouter({ config: () => ({ url: base, authToken: token, accountSid: body.AccountSid }), apply }));
  return { app, apply };
}
describe("signed Twilio gate status callback", () => {
  it("allows only POST status callbacks through the session gate", () => {
    const allows = (method: string, path: string) => PUBLIC_UNAUTHENTICATED_ALLOWLIST.some(r => r.method === method && r.pattern.test(path));
    expect(allows("POST", "/api/twilio/gate-alert-status")).toBe(true);
    expect(allows("GET", "/api/twilio/gate-alert-status")).toBe(false);
    expect(allows("POST", "/api/twilio/gate-alert-status/other")).toBe(false);
  });
  it("rejects missing signatures and signed parameter tampering", async () => {
    const f = fixture();
    expect((await request(f.app).post(`/api/twilio/gate-alert-status?attempt=${attempt}`).type("form").send(body)).status).toBe(403);
    expect((await request(f.app).post(`/api/twilio/gate-alert-status?attempt=${attempt}`).set("X-Twilio-Signature", signature(`${base}?attempt=${attempt}`, body)).type("form").send({ ...body, FutureParam: "changed" })).status).toBe(403);
    expect(f.apply).not.toHaveBeenCalled();
  });
  it("accepts exact public URL signature independent of proxy host", async () => {
    const f = fixture(); const res = await request(f.app).post(`/api/twilio/gate-alert-status?attempt=${attempt}`).set("Host", "internal:8080").set("X-Twilio-Signature", signature(`${base}?attempt=${attempt}`, body)).type("form").send(body);
    expect(res.status).toBe(204);
    expect(f.apply).toHaveBeenCalledWith({ attemptToken: attempt, providerMessageId: body.MessageSid, status: "delivered", errorCode: null, permanent: false });
  });
  it("rejects a different account and ambiguous form fields", async () => {
    const f = fixture(); const wrong = { ...body, AccountSid: "AC" + "3".repeat(32) };
    expect((await request(f.app).post(`/api/twilio/gate-alert-status?attempt=${attempt}`).set("X-Twilio-Signature", signature(`${base}?attempt=${attempt}`, wrong)).type("form").send(wrong)).status).toBe(403);
    expect(f.apply).not.toHaveBeenCalled();
  });
  it("classifies opt-out and invalid destination as permanent", async () => {
    const f = fixture(); const failure = { ...body, MessageStatus: "failed", ErrorCode: "21610" };
    await request(f.app).post(`/api/twilio/gate-alert-status?attempt=${attempt}`).set("X-Twilio-Signature", signature(`${base}?attempt=${attempt}`, failure)).type("form").send(failure);
    expect(f.apply).toHaveBeenCalledWith(expect.objectContaining({ permanent: true, errorCode: "21610" }));
  });
  it("never regresses or repeats terminal delivery states", () => {
    expect(shouldApplyTwilioStatus("delivered", "sent")).toBe(false);
    expect(shouldApplyTwilioStatus("delivered", "delivered")).toBe(false);
    expect(shouldApplyTwilioStatus("sent", "queued")).toBe(false);
    expect(shouldApplyTwilioStatus("accepted", "delivered")).toBe(true);
    expect(shouldApplyTwilioStatus("sending", "failed")).toBe(true);
  });
});
