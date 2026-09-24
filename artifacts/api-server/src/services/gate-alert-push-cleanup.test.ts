import { afterEach, beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: io }));
import { sendGateAlertPush, retryGateAlertPushCleanup } from "./gate-alert-push";
import { retryGateAlertChannels } from "./gate-alert-repository";
const records = new Map<string, any>();
const registrations = new Set<string>();
const stale = "ExponentPushToken[stale]";
let deletionFails = true;
beforeEach(() => {
  records.clear(); registrations.clear(); registrations.add(stale); deletionFails = true;
  io.query.mockReset().mockImplementation(async (sql: string, values: any[] = []) => {
    if (sql.startsWith("SELECT DISTINCT n.id")) return { rows: [] };
    if (sql.startsWith("SELECT expo_token")) return { rows: [...registrations].map(token => ({ token })) };
    if (sql.startsWith("SELECT d.notification_id")) return { rows: [...records.values()].filter(row => values.length ? row.destinationHash === values[1] && row.errorCode === "DeviceNotRegistered" : row.status === "cleanup_pending") };
    if (sql.startsWith("INSERT INTO notification_push_deliveries")) {
      const key = `${values[0]}:${values[1]}`;
      if (records.has(key) && records.get(key).status !== "retryable") return { rows: [] };
      const row = { notificationId: values[0], userId: 7, destinationHash: values[1], status: "sending" };
      records.set(key, row); return { rows: [row] };
    }
    if (sql.startsWith("UPDATE notification_push_deliveries SET status = 'failed'")) {
      const row = records.get(`${values[0]}:${values[1]}`); if (row.status === "cleanup_pending") row.status = "failed"; return { rows: [] };
    }
    if (sql.startsWith("UPDATE notification_push_deliveries")) {
      const row = records.get(`${values[0]}:${values[1]}`); row.status = values[3]; row.errorCode = values[5]; return { rows: [] };
    }
    if (sql.startsWith("DELETE FROM field_push_tokens")) {
      if (deletionFails) throw new Error("database unavailable before delete");
      expect(values[0]).toBe(7); registrations.delete(values[1]); return { rows: [] };
    }
    if (sql.startsWith("SELECT status")) return { rows: [...records.values()].filter(row => row.notificationId === values[0]) };
    throw new Error(`Unexpected database operation ${sql}`);
  });
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }))));
});
afterEach(() => vi.unstubAllGlobals());
const notice = { id: 1, userId: 7, title: "private", type: "gate_closed", link: "/gate" };
it("persists cleanup before deletion, blocks later notifications and recovers cleanup without another provider send", async () => {
  expect((await sendGateAlertPush(notice, 0)).status).toBe("retryable");
  expect([...records.values()][0].status).toBe("cleanup_pending");
  await sendGateAlertPush({ ...notice, id: 2 }, 0);
  expect(fetch).toHaveBeenCalledTimes(1);
  deletionFails = false;
  expect(await retryGateAlertChannels()).toBe(0); // Cleanup still runs without any eligible notification retry.
  expect(registrations.size).toBe(0);
  expect([...records.values()][0].status).toBe("failed");
  await sendGateAlertPush({ ...notice, id: 3 }, 0);
  expect(fetch).toHaveBeenCalledTimes(1);
});
it("finishes a persisted cleanup after a process crash, preserving a replacement registration", async () => {
  await sendGateAlertPush(notice, 0);
  registrations.clear(); registrations.add("ExponentPushToken[replacement]");
  deletionFails = false;
  await retryGateAlertPushCleanup();
  expect(registrations).toEqual(new Set(["ExponentPushToken[replacement]"]));
  expect([...records.values()][0].status).toBe("failed");
  expect(fetch).toHaveBeenCalledTimes(1);
});
