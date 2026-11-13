import { describe, expect, it } from "vitest";
import { journeyCategory, partitionTicketJourneys, type JourneyTicket } from "./ticket-journey";
const now = Date.parse("2026-11-12T12:00:00Z");
const ticket = (overrides: Partial<JourneyTicket>): JourneyTicket => ({ id: 1, status: "approved", siteName: "Site", partnerName: "Warwick", vendorId: 1,
  createdAt: "2025-01-01T00:00:00Z", updatedAt: "2025-01-01T00:00:00Z", approvedAt: "2025-01-01T00:00:00Z", cancelledAt: null,
  kickbackReason: null, paid: false, finishedAt: null, invoiceCount: 1, paidAmount: "0", balanceDue: "100", ...overrides });
describe("ticket journey grouping", () => {
  it("retains old unpaid and partially paid tickets, including sent funds not yet fully received", () => {
    const rows = [ticket({}), ticket({ id: 2, paidAmount: "50", balanceDue: "50" }), ticket({ id: 3, status: "funds_dispersed" })];
    expect(partitionTicketJourneys(rows, now).open).toHaveLength(3);
    expect(rows.map(journeyCategory)).toEqual(["payment", "payment", "payment"]);
  });
  it("uses actual closure time, not subsequent updates, for the inclusive 30 day boundary", () => {
    const rows = [ticket({ paid: true, finishedAt: new Date(now - 30 * 86400000).toISOString() }),
      ticket({ id: 2, paid: true, finishedAt: new Date(now - 31 * 86400000).toISOString(), updatedAt: new Date(now).toISOString() }),
      ticket({ id: 3, status: "cancelled", finishedAt: new Date(now - 1000).toISOString() })];
    const result = partitionTicketJourneys(rows, now);
    expect(result.open).toHaveLength(0);
    expect(result.history.map(row => row.id)).toEqual([1, 3]);
  });
  it("keeps completed field work awaiting review open and separates kickbacks", () => {
    expect(journeyCategory(ticket({ status: "completed" }))).toBe("landman");
    expect(journeyCategory(ticket({ status: "submitted", reviewStage: "finance" }))).toBe("finance");
    expect(journeyCategory(ticket({ status: "kicked_back" }))).toBe("kickedBack");
    expect(partitionTicketJourneys([ticket({ status: "completed" })], now).open).toHaveLength(1);
  });
});
