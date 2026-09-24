import { describe, expect, it, vi } from "vitest";
import { logger } from "../lib/logger";
import { deliverGateAlert, smsConsentFingerprint, buildGateAlertConsentPatch, gateAlertReadiness, type GateAlertRecipient, type GateAlertDependencies } from "./gate-alert-delivery";

const notice = { id: 10, userId: 7, type: "safety_stop_work", title: "Private site", body: "Sensitive incident", link: "/work-hub" };
function fixture() {
  const recipient: GateAlertRecipient = { userId: 7, gate: true, membershipId: 3, vendorPeopleId: 4, phone: "+14055551212", email: "worker@example.invalid", pushEnabled: true, gateAlertsEnabled: true, alertsEmailEnabled: true, alertsSmsEnabled: true, alertsSmsOptedInAt: new Date(), alertsSmsConsentFingerprint: smsConsentFingerprint(7, 3, 4, "+14055551212") };
  const outcomes: any[] = [];
  const claimed = new Set<string>();
  const dependencies: GateAlertDependencies = {
    loadRecipient: async () => recipient,
    authorized: async () => true,
    readiness: () => ({ email: true, sms: true }),
    cancelRetryable: vi.fn(async () => {}),
    claim: async (_notice, channel) => { const key = `${_notice.id}:${channel}`; if (claimed.has(key)) return null; claimed.add(key); return { attemptToken: channel, attemptCount: 1 }; },
    finish: async (result) => { outcomes.push(result); if (result.status === "retryable") claimed.delete(`${result.notificationId}:${result.channel}`); },
    push: vi.fn(async () => ({ accepted: true })),
    email: vi.fn(async () => ({ accepted: true, providerMessageId: "mail-123" })),
    sms: vi.fn(async () => ({ accepted: true, providerMessageId: "SM" + "1".repeat(32) })),
    revokeSms: vi.fn(async () => {}),
  };
  return { recipient, dependencies, outcomes };
}
describe("urgent gate alert delivery", () => {
  it("isolates a disabled channel cancellation failure from other eligible channels", async () => {
    const f = fixture(); f.recipient.alertsSmsEnabled = false;
    f.dependencies.cancelRetryable = async (_notice, channels) => { if (channels.includes("sms")) throw new Error("audit temporarily unavailable"); };
    await expect(deliverGateAlert(notice, f.dependencies)).resolves.toBe(false);
    expect(f.dependencies.push).toHaveBeenCalledOnce(); expect(f.dependencies.email).toHaveBeenCalledOnce();
    expect(f.dependencies.sms).not.toHaveBeenCalled();
  });
  it("logs a redacted audit-storage failure without rejecting or blocking other channels", async () => {
    const f = fixture(); const warning = vi.spyOn(logger, "warn").mockImplementation(() => {});
    const finish = f.dependencies.finish;
    f.dependencies.finish = async result => { if (result.channel === "push") throw new Error("secret phone"); return finish(result); };
    await expect(deliverGateAlert(notice, f.dependencies)).resolves.toBe(false);
    expect(warning).toHaveBeenCalledWith({ notificationId: 10, channel: "push" }, "Gate alert channel audit unavailable");
    expect(f.outcomes).toHaveLength(2);
    warning.mockRestore();
  });
  it("isolates provider failures and redacts audit errors while ignoring DND for urgent alerts", async () => {
    const f = fixture();
    vi.mocked(f.dependencies.push).mockRejectedValue(new Error("secret +14055551212"));
    await deliverGateAlert(notice, f.dependencies);
    expect(f.outcomes.map(r => [r.channel, r.status]).sort()).toEqual([["email", "accepted"], ["push", "unknown"], ["sms", "accepted"]]);
    expect(JSON.stringify(f.outcomes)).not.toMatch(/secret|14055551212|Private site|Sensitive incident|worker@example/);
  });
  it.each([
    { alertsSmsEnabled: false }, { alertsSmsOptedInAt: null }, { phone: "405-555-1212" },
    { phone: "+14055551213" }, { membershipId: 9 }, { vendorPeopleId: 8 },
  ])("requires current explicit phone-bound consent: %j", async (patch) => {
    const f = fixture(); Object.assign(f.recipient, patch);
    await deliverGateAlert(notice, f.dependencies);
    expect(f.dependencies.sms).not.toHaveBeenCalled();
    expect(f.outcomes.find(r => r.channel === "sms")?.status).toBe("skipped");
  });
  it("records unavailable channels without blocking enabled push", async () => {
    const f = fixture(); f.recipient.email = null; f.dependencies.readiness = () => ({ sms: false, email: false });
    await deliverGateAlert(notice, f.dependencies);
    expect(f.dependencies.push).toHaveBeenCalledOnce();
    expect(f.dependencies.sms).not.toHaveBeenCalled(); expect(f.dependencies.email).not.toHaveBeenCalled();
    expect(f.outcomes.filter(r => r.status === "skipped")).toHaveLength(2);
  });
  it.each(["work_hub_message", "unknown", "work_hub_announcement"])("never fans out routine %s", async (type) => {
    const f = fixture(); await deliverGateAlert({ ...notice, type }, f.dependencies); expect(f.outcomes).toEqual([]);
  });
  it("rechecks authorization and active role before every delivery", async () => {
    const f = fixture(); f.dependencies.authorized = async () => false;
    await deliverGateAlert(notice, f.dependencies); expect(f.outcomes).toEqual([]);
    f.dependencies.authorized = async () => true; f.recipient.gate = false;
    await deliverGateAlert(notice, f.dependencies); expect(f.outcomes).toEqual([]);
  });
  it("deduplicates concurrent delivery and retries only the failed channel", async () => {
    const f = fixture(); vi.mocked(f.dependencies.push).mockResolvedValueOnce({ accepted: false, status: "retryable" });
    await Promise.all([deliverGateAlert(notice, f.dependencies), deliverGateAlert(notice, f.dependencies)]);
    await deliverGateAlert(notice, f.dependencies);
    expect(f.dependencies.email).toHaveBeenCalledOnce(); expect(f.dependencies.sms).toHaveBeenCalledOnce();
    expect(f.dependencies.push).toHaveBeenCalledTimes(2);
  });
  it("never automatically retries an ambiguous SMS acceptance", async () => {
    const f = fixture(); vi.mocked(f.dependencies.sms).mockRejectedValue(new Error("timeout"));
    await deliverGateAlert(notice, f.dependencies); await deliverGateAlert(notice, f.dependencies);
    expect(f.dependencies.sms).toHaveBeenCalledOnce();
    expect(f.outcomes.find(r => r.channel === "sms")?.status).toBe("unknown");
  });
  it("uses no alert content in transactional SMS", async () => {
    const f = fixture(); await deliverGateAlert(notice, f.dependencies);
    expect(vi.mocked(f.dependencies.sms).mock.calls[0][0].body).toMatch(/VNDRLY.*Open.*app.*STOP.*HELP/);
    expect(vi.mocked(f.dependencies.sms).mock.calls[0][0].body).not.toMatch(/Private|Sensitive/);
  });
  it("permanent opt-out prevents SMS on later urgent notifications", async () => {
    const f = fixture(); vi.mocked(f.dependencies.sms).mockResolvedValueOnce({ accepted: false, errorCode: "21610", permanent: true });
    f.dependencies.revokeSms = async () => { f.recipient.alertsSmsEnabled = false; f.recipient.alertsSmsOptedInAt = null; };
    await deliverGateAlert(notice, f.dependencies);
    await deliverGateAlert({ ...notice, id: 11 }, f.dependencies);
    expect(f.dependencies.sms).toHaveBeenCalledOnce();
    expect(f.outcomes.find(r => r.notificationId === 11 && r.channel === "sms")).toMatchObject({ status: "skipped", errorCode: "consent_required" });
  });
});
describe("gate alert consent and readiness", () => {
  it("stamps explicit opt-in server-side and clears it on opt-out", () => {
    const f = fixture(); const at = new Date("2026-09-24T15:00:00Z");
    f.recipient.alertsSmsEnabled = false;
    expect(buildGateAlertConsentPatch(true, f.recipient, at)).toEqual({ alertsSmsEnabled: true, alertsSmsOptedInAt: at, alertsSmsConsentFingerprint: f.recipient.alertsSmsConsentFingerprint });
    expect(buildGateAlertConsentPatch(false, null, at)).toEqual({ alertsSmsEnabled: false, alertsSmsOptedInAt: null, alertsSmsConsentFingerprint: null });
    expect(() => buildGateAlertConsentPatch(true, { ...f.recipient, gate: false }, at)).toThrow();
    expect(() => buildGateAlertConsentPatch(true, { ...f.recipient, phone: "invalid" }, at)).toThrow();
  });
  it("defaults providers off even when credentials alone are present", () => {
    expect(gateAlertReadiness({})).toEqual({ email: false, sms: false });
    expect(gateAlertReadiness({ SENDGRID_API_KEY: "key", SENDGRID_FROM_EMAIL: "x@y.com", SENDGRID_DOMAIN_AUTHENTICATED: "true" }).email).toBe(false);
  });
  it("preserves the original timestamp on duplicate opt-in", () => {
    const f = fixture(); const original = new Date("2026-09-01T12:00:00Z"); f.recipient.alertsSmsOptedInAt = original;
    expect(buildGateAlertConsentPatch(true, f.recipient).alertsSmsOptedInAt).toEqual(original);
  });
});
