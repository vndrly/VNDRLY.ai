import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: vi.fn(), notices: [] as any[], attempts: new Map<string, any>(), completed: [] as number[], fail: true, email: false, office: false, available: true, membership: true, vendorId: 3, failBadge: false, reads: [] as string[] }));
vi.mock("@workspace/db", async () => {
  const schema = await import("../../../../lib/db/src/schema");
  return { ...schema, pool: { query: state.query }, db: {
    select: (projection: any) => {
      state.reads.push("select");
      if (projection?.n && state.failBadge) throw new Error("count unavailable");
      return { from: (table: any) => ({ where: () => ({
        limit: async () => table === schema.workHubTasksTable ? [{ id: "11111111-1111-4111-8111-111111111111", ownerOrgType: "vendor", ownerOrgId: 3 }] : state.membership ? [{ id: 8 }] : [],
        then: (resolve: any) => Promise.resolve([1, 2].map(userId => ({ userId, systemEnabled: true, pushEnabled: true, systemEmailEnabled: true, emailDigestEnabled: true, dndStartHour: 0, dndEndHour: 23 }))).then(resolve),
      }) }) };
    },
    insert: () => ({ values: (rows: any[]) => ({ onConflictDoNothing: () => ({ returning: async () => {
      expect(state.reads).toEqual([]);
      state.notices = rows.map((row, i) => ({ ...row, id: i + 1, createdAt: new Date(), lease: null }));
      expect(rows.every(row => row.urgentDeliveryPending === true)).toBe(true);
      return state.notices;
    } }) }) }),
  } };
});
vi.mock("../lib/notification-events", () => ({ publishNotificationCreated: vi.fn(), publishNotificationStateChanged: vi.fn(), subscribeNotificationEvents: vi.fn(), getCurrentNotificationEventSeq: vi.fn() }));
import { notifyUsers } from "./notifications";
import { retryGateAlertChannels } from "../services/gate-alert-repository";
beforeEach(() => {
  state.notices = []; state.attempts.clear(); state.completed = []; state.fail = true; state.email = false; state.office = false; state.available = true; state.membership = true; state.vendorId = 3; state.failBadge = false; state.reads = [];
  vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("Unexpected provider call"); }));
  state.query.mockReset().mockImplementation(async (sql: string, values: any[]) => {
    if (sql.startsWith("UPDATE notifications SET urgent_delivery_lease")) {
      const row = state.notices.find(n => n.id === values[0]);
      if ((!row?.urgentDeliveryPending && ![...state.attempts.entries()].some(([key, attempt]) => key.startsWith(`${values[0]}:`) && attempt.status === "retryable")) || row.lease) return { rows: [] };
      row.lease = values[2]; return { rows: [{ id: row.id }] };
    }
    if (sql.includes('u.id AS "userId"')) {
      expect(state.notices).toHaveLength(2);
      if (values[0] === 1 && state.fail) throw new Error("contact lookup unavailable");
      if (!state.available) return { rows: [] };
      return { rows: [{ userId: values[0], sessionVersion: 4, membershipId: state.membership ? 8 : null, vendorId: state.vendorId, vendorPeopleId: 9, vendorRole: state.office ? "office" : "gatekeeper", membershipRole: "field_employee", gateAlertsEnabled: true, pushEnabled: false, email: "test@example.invalid", alertsEmailEnabled: state.email, alertsSmsEnabled: false }] };
    }
    if (sql.startsWith("SELECT id, expo_token")) return { rows: [{ id: values[0], token: `ExponentPushToken[user-${values[0]}]` }] };
    if (sql.startsWith("SELECT id, user_id")) return { rows: [] };
    if (sql.startsWith("SELECT d.notification_id")) return { rows: [] };
    if (sql.startsWith("INSERT INTO notification_push_deliveries")) return { rows: [{ id: 1 }] };
    if (sql.startsWith("UPDATE notification_push_deliveries")) return { rows: [] };
    if (sql.startsWith("SELECT status")) return { rows: [{ status: "accepted" }] };
    if (sql.includes("SELECT id, role, session_version")) return { rows: [{ id: values[0], session_version: 4 }] };
    if (sql.startsWith("SELECT") && !sql.includes("FROM notifications n")) return { rows: [{ id: 3, vendor_role: "gatekeeper" }], rowCount: 1 };
    if (sql.startsWith("INSERT INTO notification_channel_deliveries")) {
      const key = `${values[0]}:${values[2]}`; if (state.attempts.has(key) && state.attempts.get(key).status !== "retryable") return { rows: [] };
      state.attempts.set(key, { status: "sending", attemptToken: values[3] });
      return { rows: [{ attemptToken: values[3], attemptCount: 1 }] };
    }
    if (sql.startsWith("UPDATE notification_channel_deliveries AS d")) {
      for (const channel of values[2]) {
        const row = state.attempts.get(`${values[0]}:${channel}`);
        if (row?.status === "retryable") row.status = "cancelled";
      }
      return { rows: [] };
    }
    if (sql.startsWith("UPDATE notification_channel_deliveries")) { state.attempts.get(`${values[0]}:${values[1]}`).status = values[3]; return { rows: [] }; }
    if (sql.startsWith("UPDATE notifications SET urgent_delivery_pending")) {
      const n = state.notices.find(n => n.id === values[0]); if (n.lease === values[1]) { n.urgentDeliveryPending = false; n.lease = null; state.completed.push(n.id); } return { rows: [] };
    }
    if (sql.includes("FROM notifications n")) return { rows: state.notices.filter(n => n.urgentDeliveryPending || [...state.attempts.entries()].some(([key, attempt]) => key.startsWith(`${n.id}:`) && attempt.status === "retryable")) };
    throw new Error(`Unexpected storage operation: ${sql}`);
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });
it("runs real notify → lease → recipient → destination → session guard → independent channel audits, then restarts failed lookup", async () => {
  expect(await notifyUsers([1, 2], { type: "gate_closed", title: "private", link: "/gate?siteId=3" })).toBe(2);
  expect(state.completed).toEqual([2]);
  expect([...state.attempts.keys()]).toEqual(["2:push", "2:email", "2:sms"]);
  expect([...state.attempts.values()].every(row => row.status === "skipped")).toBe(true);
  state.fail = false; state.notices[0].lease = null; // Expired database lease after worker restart.
  await retryGateAlertChannels();
  expect(state.completed).toEqual([2, 1]);
  expect(state.attempts.size).toBe(6);
});
it.each([429, 503])("integrates actual SendGrid %s through channel audit and recovery without replaying ambiguous acceptance", async status => {
  state.fail = false; state.email = true;
  vi.stubEnv("GATE_ALERT_EMAIL_ENABLED", "true"); vi.stubEnv("SENDGRID_API_KEY", "test");
  vi.stubEnv("SENDGRID_FROM_EMAIL", "test@example.invalid"); vi.stubEnv("SENDGRID_DOMAIN_AUTHENTICATED", "true"); vi.stubEnv("SENDGRID_SANDBOX_MODE", "false");
  const send = vi.mocked(fetch).mockResolvedValue(new Response("private", { status }));
  await notifyUsers([1, 2], { type: "gate_closed", title: "private", link: "/work-hub/tasks/11111111-1111-4111-8111-111111111111" });
  expect(state.attempts.get("1:email").status).toBe("retryable");
  send.mockResolvedValue(new Response("", { status: 202 }));
  await retryGateAlertChannels();
  expect(send).toHaveBeenCalledTimes(4);
  expect(state.attempts.get("1:email").status).toBe("accepted");
  expect(state.attempts.get("1:sms").status).toBe("skipped");
});
it("classifies office canonical alerts as immediate after restart without persisting forceImmediateDelivery", async () => {
  state.office = true;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  vi.stubEnv("GATE_ALERT_EMAIL_ENABLED", "true"); vi.stubEnv("SENDGRID_API_KEY", "test");
  vi.stubEnv("SENDGRID_FROM_EMAIL", "test@example.invalid"); vi.stubEnv("SENDGRID_DOMAIN_AUTHENTICATED", "true"); vi.stubEnv("SENDGRID_SANDBOX_MODE", "false");
  const send = vi.mocked(fetch).mockImplementation(async url => String(url).includes("exp.host")
    ? new Response(JSON.stringify({ data: [{ status: "ok", id: "receipt" }] })) : new Response("", { status: 202 }));
  await notifyUsers([1, 2], { type: "gate_closed", title: "private", link: "/work-hub/tasks/11111111-1111-4111-8111-111111111111" });
  expect(state.completed).toEqual([2]);
  state.fail = false; state.notices[0].lease = null;
  await retryGateAlertChannels();
  expect(state.completed).toEqual([2, 1]);
  expect(send.mock.calls.filter(([url]) => String(url).includes("exp.host"))).toHaveLength(2);
  expect(send.mock.calls.filter(([url]) => String(url).includes("sendgrid"))).toHaveLength(2);
  expect(state.notices.some(n => "forceImmediateDelivery" in n)).toBe(false);
});
it.each(["former_tenant", "missing_membership", "missing_destination"])("never sends office content for %s", async reason => {
  state.office = true; state.fail = false;
  vi.stubEnv("GATE_ALERT_EMAIL_ENABLED", "true"); vi.stubEnv("SENDGRID_API_KEY", "test");
  vi.stubEnv("SENDGRID_FROM_EMAIL", "test@example.invalid"); vi.stubEnv("SENDGRID_DOMAIN_AUTHENTICATED", "true"); vi.stubEnv("SENDGRID_SANDBOX_MODE", "false");
  if (reason === "former_tenant") state.vendorId = 4;
  if (reason === "missing_membership") state.membership = false;
  const link = reason === "missing_destination" ? null : "/work-hub/tasks/11111111-1111-4111-8111-111111111111";
  await notifyUsers([1, 2], { type: "gate_closed", title: "former tenant secret", link });
  expect(fetch).not.toHaveBeenCalled();
  expect(state.completed).toEqual([1, 2]);
});
it("retries an office count failure before Expo contact, without marking acceptance unknown", async () => {
  state.office = true; state.fail = false; state.failBadge = true;
  await notifyUsers([1, 2], { type: "gate_closed", title: "private", link: "/work-hub/tasks/11111111-1111-4111-8111-111111111111" });
  expect(fetch).not.toHaveBeenCalled();
  expect(state.attempts.get("1:push").status).toBe("retryable");
  state.failBadge = false;
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: [{ status: "ok", id: "receipt" }] })));
  await retryGateAlertChannels();
  expect(fetch).toHaveBeenCalledTimes(2);
  expect(state.attempts.get("1:push").status).toBe("accepted");
});
it("cancels all former-tenant retry rows after a gate to office change, including stale SMS", async () => {
  await notifyUsers([1, 2], { type: "gate_closed", title: "old tenant", link: "/work-hub/tasks/11111111-1111-4111-8111-111111111111" });
  state.fail = false; state.office = true; state.vendorId = 4; state.notices[0].lease = null;
  for (const channel of ["push", "email", "sms"]) state.attempts.set(`1:${channel}`, { status: "retryable" });
  await retryGateAlertChannels();
  expect(["push", "email", "sms"].map(channel => state.attempts.get(`1:${channel}`).status)).toEqual(["cancelled", "cancelled", "cancelled"]);
  expect(await retryGateAlertChannels()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});
it.each(["unavailable", "unauthorized", "channels_disabled"])("terminalizes existing due and future retries for %s", async reason => {
  await notifyUsers([1, 2], { type: "gate_closed", title: "private", link: "/work-hub/tasks/11111111-1111-4111-8111-111111111111" });
  state.fail = false; state.notices[0].lease = null;
  if (reason === "unavailable") state.available = false;
  if (reason === "unauthorized") state.notices[0].link = null;
  for (const channel of ["push", "email", "sms"]) state.attempts.set(`1:${channel}`, { status: "retryable", nextAttemptAt: "2099-01-01" });
  await retryGateAlertChannels();
  expect(["push", "email", "sms"].map(channel => state.attempts.get(`1:${channel}`).status)).toEqual(["cancelled", "cancelled", "cancelled"]);
  expect(await retryGateAlertChannels()).toBe(0);
  expect(fetch).not.toHaveBeenCalled();
});
it("cancels stale gate SMS when the new office role still has an authorized destination", async () => {
  await notifyUsers([1, 2], { type: "gate_closed", title: "private", link: "/work-hub/tasks/11111111-1111-4111-8111-111111111111" });
  state.fail = false; state.office = true; state.notices[0].lease = null;
  state.attempts.set("1:sms", { status: "retryable", nextAttemptAt: "2099-01-01" });
  vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ data: [{ status: "ok", id: "receipt" }] })));
  await retryGateAlertChannels();
  expect(state.attempts.get("1:sms").status).toBe("cancelled");
  expect(state.attempts.get("1:push").status).toBe("accepted");
  expect(fetch).toHaveBeenCalledTimes(1);
});
