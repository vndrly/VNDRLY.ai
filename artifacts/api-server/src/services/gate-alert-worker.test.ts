import { afterEach, describe, expect, it, vi } from "vitest";
const retryChannels = vi.hoisted(() => vi.fn(async () => 1));
vi.mock("./gate-alert-repository", () => ({ retryGateAlertChannels: retryChannels }));
vi.mock("@workspace/db", () => ({ db: { select: () => { throw new Error("legacy retry unavailable"); } }, notificationsTable: {} }));
vi.mock("../lib/expo-push", () => ({ sendPushToUser: vi.fn() }));
import { startReliableNotificationWorker, stopReliableNotificationWorker } from "./notification-delivery";
afterEach(() => { stopReliableNotificationWorker(); vi.useRealTimers(); vi.restoreAllMocks(); });
describe("gate channel retry scheduling", () => {
  it("continues channel retries when legacy notification retries fail", async () => {
    vi.useFakeTimers(); vi.spyOn(console, "error").mockImplementation(() => {});
    startReliableNotificationWorker(60_000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(retryChannels).toHaveBeenCalledTimes(2);
  });
});
