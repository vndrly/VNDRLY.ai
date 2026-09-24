import { afterEach, beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: io }));
import { sendGateAlertPush, retryGateAlertPushCleanup } from "./gate-alert-push";
import { retryGateAlertChannels } from "./gate-alert-repository";
const records = new Map<string, any>();
const registrations = new Map<number, any>();
const stale = "ExponentPushToken[stale]";
let deletionFails = true;
let replaceBeforeDelete = false;
let auditFails = false;
let switchAccountBeforeResult = false;
let now = 0;
const registration = (id = 1) => ({ id, userId: 7, token: stale, pending: false, lease: null as string | null, until: 0, attempts: 0 });
beforeEach(() => {
  records.clear(); registrations.clear(); registrations.set(1, registration());
  deletionFails = true; replaceBeforeDelete = false; auditFails = false; switchAccountBeforeResult = false; now = 0;
  io.query.mockReset().mockImplementation(async (sql: string, values: any[] = []) => {
    if (sql.startsWith("SELECT DISTINCT n.id")) return { rows: [] };
    if (sql.startsWith("SELECT expo_token") || sql.startsWith("SELECT id, expo_token"))
      return { rows: [...registrations.values()].filter(row => !sql.includes("retirement_pending = false") || !row.pending) };
    if (sql.startsWith("SELECT id, user_id")) return { rows: [...registrations.values()].filter(row => row.pending && row.until <= now) };
    if (sql.startsWith("UPDATE field_push_tokens SET retirement_pending")) {
      const row = registrations.get(values[0]);
      if (row && (!sql.includes("AND user_id") || row.userId === values[1])) row.pending = true;
      return { rows: row ? [row] : [] };
    }
    if (sql.startsWith("UPDATE field_push_tokens SET retirement_lease_token")) {
      expect(sql).toContain("AND retirement_pending = true");
      expect(sql).toContain("retirement_lease_until IS NULL OR retirement_lease_until <= now()");
      const row = registrations.get(values[0]);
      if (!row || row.userId !== values[1] || !row.pending || row.until > now) return { rows: [] };
      row.lease = values[2]; row.until = now + 60_000; row.attempts++;
      return { rows: [row] };
    }
    // Supports the old notification-owned barrier too, so the regression reproduces its deletion bug.
    if (sql.startsWith("SELECT d.notification_id")) return { rows: [...records.values()].filter(row => values.length ? row.destinationHash === values[1] && row.errorCode === "DeviceNotRegistered" : row.status === "cleanup_pending") };
    if (sql.startsWith("INSERT INTO notification_push_deliveries")) {
      const key = `${values[0]}:${values[1]}`;
      if (records.has(key) && records.get(key).status !== "retryable") return { rows: [] };
      const row = { notificationId: values[0], userId: 7, destinationHash: values[1], status: "sending" };
      records.set(key, row); return { rows: [row] };
    }
    if (sql.startsWith("UPDATE notification_push_deliveries")) {
      if (auditFails) throw new Error("process lost connection before audit completion");
      const row = records.get(`${values[0]}:${values[1]}`);
      if (row) { row.status = sql.includes("SET status = 'failed'") ? "failed" : values[3]; row.errorCode = values[5]; }
      return { rows: [] };
    }
    if (sql.startsWith("DELETE FROM field_push_tokens")) {
      if (deletionFails) throw new Error("database unavailable before delete");
      if (replaceBeforeDelete) { registrations.delete(1); registrations.set(2, registration(2)); replaceBeforeDelete = false; }
      if (sql.includes("retirement_lease_token")) {
        const row = registrations.get(values[0]);
        if (row?.userId === values[1] && row.pending && row.lease === values[2]) registrations.delete(row.id);
      } else for (const row of registrations.values()) if (row.userId === values[0] && row.token === values[1]) registrations.delete(row.id);
      return { rows: [] };
    }
    if (sql.startsWith("SELECT status")) return { rows: [...records.values()].filter(row => row.notificationId === values[0]) };
    throw new Error(`Unexpected database operation ${sql}`);
  });
  vi.stubGlobal("fetch", vi.fn(async () => {
    if (switchAccountBeforeResult) registrations.get(1).userId = 8;
    return new Response(JSON.stringify({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }));
  }));
});
afterEach(() => vi.unstubAllGlobals());
const notice = { id: 1, userId: 7, title: "private", type: "gate_closed", link: "/gate" };
it("keeps retirement after failed deletion and inbox cascade, preventing the next alert from resending", async () => {
  await sendGateAlertPush(notice, 0);
  records.clear(); // Deleting the inbox row cascades its destination audit, not its device registration.
  await sendGateAlertPush({ ...notice, id: 2 }, 0);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(registrations.get(1)).toMatchObject({ pending: true, attempts: 1 });
  deletionFails = false; now = 60_001;
  expect(await retryGateAlertChannels()).toBe(0); // No eligible notification work is needed for cleanup.
  expect(registrations.size).toBe(0);
  await sendGateAlertPush({ ...notice, id: 3 }, 0);
  expect(fetch).toHaveBeenCalledTimes(1);
  const cleanupWrites = io.query.mock.calls.filter(([sql]) => /^(UPDATE|DELETE FROM) field_push_tokens/.test(sql));
  expect(JSON.stringify(cleanupWrites)).not.toContain("ExponentPushToken");
  expect(JSON.stringify(cleanupWrites)).not.toContain("private");
});
it("recovers a crashed cleanup lease after expiry with only one concurrent worker deleting", async () => {
  Object.assign(registrations.get(1), { pending: true, lease: "crashed-worker", until: 60_000 });
  deletionFails = false;
  await retryGateAlertPushCleanup();
  expect(registrations.size).toBe(1);
  now = 60_001;
  await Promise.all([retryGateAlertPushCleanup(), retryGateAlertPushCleanup()]);
  expect(registrations.size).toBe(0);
  expect(io.query.mock.calls.filter(([sql]) => sql.startsWith("DELETE FROM field_push_tokens"))).toHaveLength(1);
  expect(fetch).not.toHaveBeenCalled();
});
it("persists retirement before an audit failure and recovers without the inbox or a prior cleanup claim", async () => {
  auditFails = true;
  await sendGateAlertPush(notice, 0);
  expect(registrations.get(1)).toMatchObject({ pending: true, attempts: 0 });
  records.clear();
  await sendGateAlertPush({ ...notice, id: 2 }, 0);
  expect(fetch).toHaveBeenCalledTimes(1);
  deletionFails = false;
  await retryGateAlertPushCleanup();
  expect(registrations.size).toBe(0);
});
it("does not delete a replacement registration created after the cleanup claim", async () => {
  await sendGateAlertPush(notice, 0);
  deletionFails = false; replaceBeforeDelete = true; now = 60_001;
  await retryGateAlertPushCleanup();
  expect([...registrations.keys()]).toEqual([2]);
  expect(registrations.get(2).pending).toBe(false);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("retains the token-owned barrier when its account changes while Expo is responding", async () => {
  switchAccountBeforeResult = true;
  await sendGateAlertPush(notice, 0);
  records.clear();
  await sendGateAlertPush({ ...notice, id: 2, userId: 8 }, 0);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(registrations.get(1)).toMatchObject({ pending: true, userId: 8 });
  deletionFails = false;
  await retryGateAlertPushCleanup();
  expect(registrations.size).toBe(0);
});
