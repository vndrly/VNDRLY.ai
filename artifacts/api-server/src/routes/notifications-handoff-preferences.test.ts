import { beforeEach, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ enabled: true, stored: [] as any[] }));
vi.mock("@workspace/db", async () => {
  const schema = await import("../../../../lib/db/src/schema");
  return { ...schema, db: {
    select: () => ({ from: () => ({ where: async () => [{ userId: 7, systemEnabled: false, gateHandoffsEnabled: state.enabled, pushEnabled: false, systemEmailEnabled: false }] }) }),
    insert: () => ({ values: (rows: any[]) => ({ onConflictDoNothing: () => ({ returning: async () => { state.stored.push(...rows); return rows.map((r, i) => ({ ...r, id: i + 1, createdAt: new Date() })); } }) }) }),
  } };
});
vi.mock("../lib/notification-events", () => ({ publishNotificationCreated: vi.fn() }));
vi.mock("../lib/expo-push", () => ({ sendPushToUser: vi.fn() }));
vi.mock("../lib/sendgrid", () => ({ sendNotificationAlertEmail: vi.fn() }));
import { notifyUsers } from "./notifications";
beforeEach(() => { state.stored = []; state.enabled = true; });
it("honors Handoffs independently of the legacy System preference", async () => {
  expect(await notifyUsers([7], { type: "gate_handoff_ready", title: "Handoff", link: "/shift-notes?stationId=10000000-0000-4000-8000-000000000001&handoffId=20000000-0000-4000-8000-000000000001", dedupeKey: "handoff:1" })).toBe(1);
  expect(state.stored).toHaveLength(1);
});
it("does not insert an opted-out handoff", async () => {
  state.enabled = false;
  expect(await notifyUsers([7], { type: "gate_handoff_ready", title: "Handoff" })).toBe(0);
  expect(state.stored).toEqual([]);
});
