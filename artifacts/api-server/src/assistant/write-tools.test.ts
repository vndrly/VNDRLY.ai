import { describe, expect, it, vi, beforeEach } from "vitest";

import { runWriteTool } from "./write-tools";

const { updateMock, flagTicketMock, clearTicketFlagMock } = vi.hoisted(() => ({
  updateMock: vi.fn(),
  flagTicketMock: vi.fn(),
  clearTicketFlagMock: vi.fn(),
}));

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
  ticketNoteLogsTable: {
    id: "id",
    ticketId: "ticketId",
    content: "content",
    createdAt: "createdAt",
  },
  ticketsTable: {},
  vendorPeopleTable: {},
}));

vi.mock("../lib/ticket-flag", () => ({
  flagTicket: flagTicketMock,
  clearTicketFlag: clearTicketFlagMock,
}));

vi.mock("../lib/field-ticket-access", () => ({
  fieldEmployeeCanAccessTicket: vi.fn(),
  loadFieldTicketAccessRow: vi.fn(),
  ticketParticipantUserIdsExpanded: vi.fn(),
}));

vi.mock("../routes/notifications", () => ({
  findPartnerUserIds: vi.fn(),
  findVendorUserIds: vi.fn(),
  notifyUsers: vi.fn(),
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

describe("runWriteTool — set_ticket_flag", () => {
  beforeEach(() => {
    flagTicketMock.mockReset();
    clearTicketFlagMock.mockReset();
  });

  it("requires explicit confirmation before changing a flag", async () => {
    const out = JSON.parse(
      await runWriteTool(
        "set_ticket_flag",
        { ticketId: 10959, flagged: true },
        { role: "vendor", userId: 99, vendorId: 3 } as never,
      ),
    );
    expect(out.error).toMatch(/confirmation/i);
    expect(flagTicketMock).not.toHaveBeenCalled();
  });

  it("flags a ticket after confirmation", async () => {
    flagTicketMock.mockResolvedValueOnce({ ok: true, flagId: 12, notifiedCount: 3 });
    const out = JSON.parse(
      await runWriteTool(
        "set_ticket_flag",
        { ticketId: 10959, flagged: true, reason: "Needs safety follow-up", confirmed: true },
        { role: "vendor", userId: 99, vendorId: 3, displayName: "Joe Boggs" } as never,
      ),
    );
    expect(out).toEqual({ ok: true, ticketId: 10959, flagged: true, flagId: 12, notifiedCount: 3 });
    expect(flagTicketMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 10959,
        actorUserId: 99,
        actorRole: "vendor",
        actorVendorId: 3,
        reason: "Needs safety follow-up",
      }),
    );
  });

  it("clears a ticket flag after confirmation", async () => {
    clearTicketFlagMock.mockResolvedValueOnce({ ok: true });
    const out = JSON.parse(
      await runWriteTool(
        "set_ticket_flag",
        { ticketId: 10959, flagged: false, confirmed: true },
        { role: "vendor", userId: 99, vendorId: 3 } as never,
      ),
    );
    expect(out).toEqual({ ok: true, ticketId: 10959, flagged: false });
    expect(clearTicketFlagMock).toHaveBeenCalledWith(
      expect.objectContaining({
        ticketId: 10959,
        actorUserId: 99,
        actorRole: "vendor",
        actorVendorId: 3,
      }),
    );
  });
});

describe("runWriteTool — post_ticket_comment", () => {
  it("requires explicit confirmation before posting a comment", async () => {
    const out = JSON.parse(
      await runWriteTool(
        "post_ticket_comment",
        { ticketId: 10959, content: "Running 20 minutes late" },
        { role: "vendor", userId: 99, vendorId: 3 } as never,
      ),
    );
    expect(out.error).toMatch(/confirmation/i);
  });
});
