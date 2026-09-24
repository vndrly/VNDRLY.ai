import { beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: io }));
import { processPendingGateAlert, retryGateAlertChannels } from "./gate-alert-repository";
const notices = new Map<number, any>();
let now = 0;
let failLookup = true;
beforeEach(() => {
  now = 0; failLookup = true; notices.clear();
  for (const id of [1, 2]) notices.set(id, { id, userId: id, type: "gate_closed", title: "private", link: "/gate", pending: true, lease: null, until: 0 });
  io.query.mockReset().mockImplementation(async (sql: string, values: any[]) => {
    if (sql.startsWith("UPDATE notifications SET urgent_delivery_lease")) {
      const n = notices.get(values[0]);
      if (!n.pending || n.until > now) return { rows: [] };
      n.lease = values[2]; n.until = now + 300000; return { rows: [n] };
    }
    if (sql.includes('u.id AS "userId"')) {
      if (values[0] === 1 && failLookup) throw new Error("database temporarily unavailable");
      return { rows: [{ userId: values[0], vendorRole: "gatekeeper", gateAlertsEnabled: false }] };
    }
    if (sql.startsWith("UPDATE notifications SET urgent_delivery_pending")) {
      const n = notices.get(values[0]); if (n.lease === values[1]) n.pending = false; return { rows: [] };
    }
    if (sql.includes("FROM notifications n") && sql.includes("urgent_delivery_pending")) return { rows: [...notices.values()].filter(n => n.pending && n.until <= now) };
    throw new Error(`Unexpected SQL: ${sql}`);
  });
});
it("isolates lookup failures, leaves durable pending work and recovers after restart without provider attempts", async () => {
  await Promise.allSettled([...notices.values()].map(n => processPendingGateAlert(n)));
  expect(notices.get(1).pending).toBe(true);
  expect(notices.get(2).pending).toBe(false);
  expect(io.query.mock.calls.some(([sql]) => sql.includes("INSERT INTO notification_channel_deliveries"))).toBe(false);
  failLookup = false; now += 300001;
  await retryGateAlertChannels();
  expect(notices.get(1).pending).toBe(false);
});
it("permits one worker claim and recovers an expired crash lease", async () => {
  failLookup = false;
  notices.get(1).until = 300000;
  await processPendingGateAlert(notices.get(1));
  expect(notices.get(1).pending).toBe(true);
  now = 300001;
  await Promise.all([processPendingGateAlert(notices.get(1)), processPendingGateAlert(notices.get(1))]);
  expect(io.query.mock.calls.filter(([sql]) => sql.includes('u.id AS "userId"'))).toHaveLength(1);
  expect(notices.get(1).pending).toBe(false);
});
