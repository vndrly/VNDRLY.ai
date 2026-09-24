import { afterEach, beforeEach, expect, it, vi } from "vitest";
const io = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: io }));
import { sendGateAlertPush } from "./gate-alert-push";
const records = new Map<string, any>();
const tokens = ["ExponentPushToken[accepted]", "ExponentPushToken[stale]", "ExponentPushToken[ambiguous]", "ExponentPushToken[retry]"];
beforeEach(() => {
  records.clear();
  io.query.mockReset().mockImplementation(async (sql: string, values: any[]) => {
    if (sql.startsWith("SELECT expo_token")) return { rows: tokens.map(token => ({ token })) };
    if (sql.startsWith("INSERT INTO notification_push_deliveries")) {
      const previous = records.get(values[1]);
      if (previous && previous.status !== "retryable") return { rows: [] };
      const row = { status: "sending", attempt: values[2] }; records.set(values[1], row);
      return { rows: [row] };
    }
    if (sql.startsWith("UPDATE notification_push_deliveries")) { records.get(values[1]).status = values[3]; return { rows: [] }; }
    if (sql.startsWith("SELECT status")) return { rows: [...records.values()] };
    return { rows: [] };
  });
});
afterEach(() => vi.unstubAllGlobals());
it("uses real Expo ticket parsing, retires stale destinations and retries only definitely rejected devices", async () => {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url, init) => {
    const token = JSON.parse(init.body)[0].to; calls.push(token);
    if (token === tokens[2]) throw new Error("private ambiguous network failure");
    const data = token === tokens[1] ? { status: "error", details: { error: "DeviceNotRegistered" } }
      : token === tokens[3] && calls.filter(t => t === token).length === 1 ? { status: "error", details: { error: "MessageRateExceeded" } }
      : { status: "ok", id: "provider-id" };
    return new Response(JSON.stringify({ data: [data] }), { status: 200 });
  }));
  const notice = { id: 1, userId: 7, title: "private", type: "gate_closed", link: "/gate" };
  await expect(sendGateAlertPush(notice, 2)).resolves.toMatchObject({ status: "retryable" });
  await expect(sendGateAlertPush(notice, 2)).resolves.toMatchObject({ status: "unknown" });
  expect(calls.filter(t => t === tokens[0])).toHaveLength(1);
  expect(calls.filter(t => t === tokens[1])).toHaveLength(1);
  expect(calls.filter(t => t === tokens[2])).toHaveLength(1);
  expect(calls.filter(t => t === tokens[3])).toHaveLength(2);
  const auditWrites = io.query.mock.calls.filter(([sql]) => /^(INSERT|UPDATE).*notification_push_deliveries/.test(sql));
  expect(JSON.stringify(auditWrites)).not.toContain("ExponentPushToken");
  expect(JSON.stringify(auditWrites)).not.toContain("private");
  expect(io.query.mock.calls.find(([sql]) => sql.startsWith("DELETE FROM field_push_tokens"))?.[1]).toEqual([7, tokens[1]]);
});
it("does not resend a device left sending by a crashed worker", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ status: "ok" }] }))));
  io.query.mockImplementation(async (sql: string) => sql.startsWith("SELECT expo_token") ? { rows: [{ token: tokens[0] }] } : sql.startsWith("SELECT status") ? { rows: [{ status: "sending" }] } : { rows: [] });
  await expect(sendGateAlertPush({ id: 1, userId: 7, title: "x", type: "gate_closed", link: "/gate" }, 0)).resolves.toMatchObject({ status: "unknown" });
  expect(fetch).not.toHaveBeenCalled();
});
it("keeps destination lookup failures retryable without making a provider call", async () => {
  io.query.mockRejectedValueOnce(new Error("database lookup failed"));
  vi.stubGlobal("fetch", vi.fn());
  await expect(sendGateAlertPush({ id: 1, userId: 7, title: "x", type: "gate_closed", link: "/gate" }, 0)).resolves.toMatchObject({ status: "retryable" });
  expect(fetch).not.toHaveBeenCalled();
});
it("claims each device once under concurrent push workers", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ data: [{ status: "ok", id: "receipt" }] }))));
  const notice = { id: 1, userId: 7, title: "x", type: "gate_closed", link: "/gate" };
  await Promise.all([sendGateAlertPush(notice, 0), sendGateAlertPush(notice, 0)]);
  expect(fetch).toHaveBeenCalledTimes(tokens.length);
});
