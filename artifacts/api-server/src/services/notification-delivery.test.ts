import { describe, expect, it, vi } from "vitest";
import {
  acknowledgeNotification,
  deliveryWindow,
  deliverNotification,
  retryDelayMs,
} from "./notification-delivery";

describe("reliable notification delivery", () => {
  it("bypasses quiet hours only for safety and shift-critical notices", () => {
    const quietHours = { startHour: 22, endHour: 6, localHour: 23 };
    expect(deliveryWindow({ criticality: "safety" }, quietHours).sendNow).toBe(true);
    expect(deliveryWindow({ criticality: "shift_critical" }, quietHours).sendNow).toBe(true);
    expect(deliveryWindow({ criticality: "normal" }, quietHours).sendNow).toBe(false);
  });

  it("uses bounded exponential retries", () => {
    expect([0, 1, 2, 3, 20].map(retryDelayMs)).toEqual([60_000, 120_000, 240_000, 480_000, 3_600_000]);
  });

  it("persists success and failure receipts without losing the deep link", async () => {
    const repository = {
      markDelivered: vi.fn(async () => undefined),
      markAttemptFailed: vi.fn(async () => undefined),
      acknowledge: vi.fn(async () => ({ acknowledged: true })),
    };
    const sender = vi.fn(async () => ({ delivered: false, detail: "temporary" }));
    const notice = { id: 7, userId: 8, link: "/work-hub/activity?notice=7", attempts: 0, acknowledgementRequired: true };
    const result = await deliverNotification(notice, { repository, sender, now: () => new Date("2026-09-13T12:00:00.000Z") });
    expect(result).toMatchObject({ delivered: false, retrying: true });
    expect(repository.markAttemptFailed).toHaveBeenCalledWith(expect.objectContaining({ id: 7, link: notice.link, attempt: 1 }));
  });

  it("records a durable acknowledgement by the intended recipient", async () => {
    const repository = {
      markDelivered: vi.fn(async () => undefined),
      markAttemptFailed: vi.fn(async () => undefined),
      acknowledge: vi.fn(async () => ({ acknowledged: true })),
    };
    await acknowledgeNotification({ notificationId: 7, userId: 8 }, { repository, sender: vi.fn(), now: () => new Date("2026-09-13T12:00:00.000Z") });
    expect(repository.acknowledge).toHaveBeenCalledWith({ id: 7, userId: 8, at: new Date("2026-09-13T12:00:00.000Z") });
  });
});
