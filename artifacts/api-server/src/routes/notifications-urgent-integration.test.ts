import { afterEach, beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ query: vi.fn(), notices: [] as any[], attempts: new Map<string, any>(), completed: [] as number[], fail: true, email: false, office: false, reads: [] as string[] }));
vi.mock("@workspace/db", async () => {
  const schema = await import("../../../../lib/db/src/schema");
  return { ...schema, pool: { query: state.query }, db: {
    select: () => { state.reads.push("select"); return { from: () => ({ where: () => ({ limit: async () => [{ id: 8 }], then: (resolve: any) => Promise.resolve([1, 2].map(userId => ({ userId, systemEnabled: true, pushEnabled: true, systemEmailEnabled: true, emailDigestEnabled: true, dndStartHour: 0, dndEndHour: 23 }))).then(resolve) }) }) }; },
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
  state.notices = []; state.attempts.clear(); state.completed = []; state.fail = true; state.email = false; state.office = false; state.reads = [];
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
      return { rows: [{ userId: values[0], sessionVersion: 4, membershipId: 8, vendorId: 3, vendorPeopleId: 9, vendorRole: state.office ? "office" : "gatekeeper", membershipRole: "field_employee", gateAlertsEnabled: true, pushEnabled: false, email: "test@example.invalid", alertsEmailEnabled: state.email, alertsSmsEnabled: false }] };
    }
    if (sql.startsWith("SELECT expo_token")) return { rows: [{ token: `ExponentPushToken[user-${values[0]}]` }] };
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
  await notifyUsers([1, 2], { type: "gate_closed", title: "private", link: "/gate?siteId=3" });
  expect(state.attempts.get("1:email").status).toBe(status === 429 ? "retryable" : "unknown");
  send.mockResolvedValue(new Response("", { status: 202 }));
  await retryGateAlertChannels();
  expect(send).toHaveBeenCalledTimes(status === 429 ? 4 : 2);
  expect(state.attempts.get("1:email").status).toBe(status === 429 ? "accepted" : "unknown");
  expect(state.attempts.get("1:sms").status).toBe("skipped");
});
it("classifies office canonical alerts as immediate after restart without persisting forceImmediateDelivery", async () => {
  state.office = true;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-09-24T12:00:00Z"));
  vi.stubEnv("GATE_ALERT_EMAIL_ENABLED", "true"); vi.stubEnv("SENDGRID_API_KEY", "test");
  vi.stubEnv("SENDGRID_FROM_EMAIL", "test@example.invalid"); vi.stubEnv("SENDGRID_DOMAIN_AUTHENTICATED", "true"); vi.stubEnv("SENDGRID_SANDBOX_MODE", "false");
  const send = vi.mocked(fetch).mockImplementation(async url => String(url).includes("exp.host")
    ? new Response(JSON.stringify({ data: [{ status: "ok", id: "receipt" }] })) : new Response("", { status: 202 }));
  await notifyUsers([1, 2], { type: "gate_closed", title: "private", link: "/gate?siteId=3" });
  expect(state.completed).toEqual([2]);
  state.fail = false; state.notices[0].lease = null;
  await retryGateAlertChannels();
  expect(state.completed).toEqual([2, 1]);
  expect(send.mock.calls.filter(([url]) => String(url).includes("exp.host"))).toHaveLength(2);
  expect(send.mock.calls.filter(([url]) => String(url).includes("sendgrid"))).toHaveLength(2);
  expect(state.notices.some(n => "forceImmediateDelivery" in n)).toBe(false);
});
