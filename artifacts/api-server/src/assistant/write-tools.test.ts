import { describe, expect, it, vi, beforeEach } from "vitest";

import { runWriteTool } from "./write-tools";

const updateMock = vi.fn();

vi.mock("@workspace/db", () => ({
  db: {
    update: () => ({
      set: () => ({
        where: () => ({
          returning: updateMock,
        }),
      }),
    }),
  },
  notificationsTable: {
    id: "id",
    userId: "userId",
    isRead: "isRead",
  },
}));

describe("runWriteTool — mark_notifications_read", () => {
  beforeEach(() => {
    updateMock.mockReset();
  });

  it("refuses when not signed in", async () => {
    const out = JSON.parse(
      await runWriteTool("mark_notifications_read", { markAll: true }, { role: "partner" } as never),
    );
    expect(out.error).toMatch(/signed in/);
  });

  it("marks all unread notifications for the user", async () => {
    updateMock.mockResolvedValueOnce([{ id: 1 }, { id: 2 }]);
    const out = JSON.parse(
      await runWriteTool(
        "mark_notifications_read",
        { markAll: true },
        { role: "partner", userId: 99 } as never,
      ),
    );
    expect(out).toEqual({ ok: true, marked: 2, markAll: true });
  });

  it("marks a single notification by id", async () => {
    updateMock.mockResolvedValueOnce([{ id: 5 }]);
    const out = JSON.parse(
      await runWriteTool(
        "mark_notifications_read",
        { notificationId: 5 },
        { role: "vendor", userId: 99 } as never,
      ),
    );
    expect(out).toEqual({ ok: true, marked: 1, notificationId: 5 });
  });
});
