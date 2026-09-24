import { beforeEach, describe, expect, it, vi } from "vitest";
const storage = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }));
const providers = vi.hoisted(() => ({ sms: vi.fn(), email: vi.fn(), push: vi.fn(async () => ({ delivered: true })), count: vi.fn(async () => 7) }));
vi.mock("@workspace/db", () => ({ pool: storage }));
vi.mock("../lib/twilio", async original => ({ ...await original<any>(), sendTransactionalSms: providers.sms }));
vi.mock("../lib/sendgrid", () => ({ sendNotificationAlertEmail: providers.email }));
vi.mock("../lib/expo-push", () => ({ sendPushToUser: providers.push }));
vi.mock("../routes/notifications", () => ({ countGateUnreadNotifications: providers.count }));
vi.mock("../lib/notification-destination", () => ({ resolveNotificationDestination: vi.fn(async () => "/work-hub") }));
import { loadGateAlertRecipient, gateAlertDependencies, applyTwilioStatus } from "./gate-alert-repository";
const notice = { id: 2, userId: 7, type: "safety_stop_work", title: "Private", link: "/work-hub" };
beforeEach(() => { storage.query.mockReset(); storage.connect.mockResolvedValue(storage); storage.query.mockResolvedValue({ rows: [] }); });
describe("gate channel persistence boundaries", () => {
  it("uses authorized gate unread totals instead of an office badge snapshot", async () => {
    await gateAlertDependencies.push({ ...notice, badge: 100 }, { session: { userId: 7 } } as any);
    expect(providers.push).toHaveBeenCalledWith(7, expect.objectContaining({ badge: 7 }));
  });
  it("does not retry a successful email just because SendGrid omitted its message id", async () => {
    providers.email.mockResolvedValueOnce({ messageId: undefined });
    expect((await gateAlertDependencies.email(notice, { email: "x@example.invalid" } as any)).accepted).toBe(true);
  });
  it("treats a malformed successful SMS response as ambiguous, never retryable", async () => {
    providers.sms.mockResolvedValueOnce({ sid: undefined, status: undefined });
    await expect(gateAlertDependencies.sms({ to: "+14055551212", body: "VNDRLY", attemptToken: "claim" })).rejects.toThrow();
  });
  it("resolves only the current user's active membership and uses the linked person's phone", async () => {
    storage.query.mockResolvedValueOnce({ rows: [{ userId: 7, membershipId: 8, vendorPeopleId: 9, vendorId: 3, vendorRole: "gatekeeper", phone: "+14055551212", email: "x@example.invalid", membershipRole: "field_employee", grants: [] }] });
    const recipient = await loadGateAlertRecipient(7);
    expect(recipient).toMatchObject({ userId: 7, membershipId: 8, phone: "+14055551212", gate: true, alertsSmsEnabled: false, alertsEmailEnabled: true });
    const [query, values] = storage.query.mock.calls[0];
    expect(values).toEqual([7]);
    expect(query).toContain("m.id = u.active_membership_id");
    expect(query).toContain("m.user_id = u.id");
    expect(query).toContain("vp.user_id = u.id");
    expect(query).toContain("vp.is_active = true");
    expect(query).toContain("u.suspended_at IS NULL");
  });
  it("does not grant gate delivery when current membership is office", async () => {
    storage.query.mockResolvedValueOnce({ rows: [{ userId: 7, vendorRole: "office", grants: [] }] });
    expect((await loadGateAlertRecipient(7))?.gate).toBe(false);
  });
  it("claims atomically with notification ownership and bounded due retries", async () => {
    storage.query.mockResolvedValueOnce({ rows: [{ attemptToken: "claim", attemptCount: 1 }] });
    expect(await gateAlertDependencies.claim(notice, "sms", "fingerprint")).toEqual({ attemptToken: "claim", attemptCount: 1 });
    const [query, values] = storage.query.mock.calls[0];
    expect(query).toContain("n.user_id = $2");
    expect(query).toContain("ON CONFLICT (notification_id, channel)");
    expect(query).toContain("status = 'retryable'");
    expect(query).toContain("attempt_count < 3");
    expect(values.slice(0, 3)).toEqual([2, 7, "sms"]);
  });
  it("does not downgrade a callback accepted before send returns", async () => {
    await gateAlertDependencies.finish({ notificationId: 2, channel: "sms", attemptToken: "claim", status: "accepted", errorCode: null, providerMessageId: "SM123" });
    expect(storage.query.mock.calls[0][0]).toContain("status = 'sending'");
    expect(storage.query.mock.calls[0][1]).not.toContain("Private");
  });
  it("ignores stale callback attempts and rolls back before touching consent", async () => {
    await applyTwilioStatus({ attemptToken: "old", providerMessageId: "SM1", status: "failed", errorCode: "21610", permanent: true });
    expect(storage.query.mock.calls.map(c => c[0]).some(q => q.includes("UPDATE notification_preferences"))).toBe(false);
    expect(storage.release).toHaveBeenCalled();
  });
  it("atomically records opt-out and revokes only the matching user's matching consent", async () => {
    const consentAt = new Date("2026-09-01T12:00:00Z");
    storage.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ id: 1, userId: 7, status: "accepted", providerMessageId: "SM1", consentFingerprint: "original", consentOptedInAt: consentAt }] });
    await applyTwilioStatus({ attemptToken: "current", providerMessageId: "SM1", status: "failed", errorCode: "21610", permanent: true });
    const revoke = storage.query.mock.calls.find(c => c[0].includes("UPDATE notification_preferences"));
    expect(revoke?.[1]).toEqual([7, "original", consentAt]);
    expect(revoke?.[0]).toContain("alerts_sms_consent_fingerprint = $2");
    expect(revoke?.[0]).toContain("alerts_sms_opted_in_at = $3");
    expect(storage.query.mock.calls.at(-1)?.[0]).toBe("COMMIT");
  });
});
