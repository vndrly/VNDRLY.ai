// These fixtures exercise unheld recipients; the operational hold has real-database coverage.
vi.mock("./notification-company-hold", () => ({ notificationCompanyHoldApplies: async () => false, pausedNotificationUserIds: async () => new Set(), notificationTokenHoldApplies: async () => false, notificationEmailHoldApplies: async () => false, NOTIFICATION_COMPANY_HOLDS: [] }));
import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({}));

describe("notification state events", () => {
  it("publishes a scoped state change for cross-device acknowledgement", async () => {
    const { publishNotificationStateChanged, subscribeNotificationEvents } =
      await import("./notification-events");
    const event = new Promise<unknown>((resolve) => {
      const unsubscribe = subscribeNotificationEvents((value) => {
        unsubscribe();
        resolve(value);
      });
    });

    publishNotificationStateChanged({
      userId: 42,
      notificationId: 7,
      state: "read",
      changedAt: "2026-09-12T12:00:00.000Z",
    });

    await expect(event).resolves.toMatchObject({
      type: "notification.state_changed",
      userId: 42,
      notificationId: 7,
      state: "read",
      changedAt: "2026-09-12T12:00:00.000Z",
    });
  });
});
