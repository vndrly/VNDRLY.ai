import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), canReadTicket: vi.fn() }));
vi.mock("@workspace/db", () => ({ pool: { query: mocks.query } }));
vi.mock("../lib/field-ticket-access", () => ({
  canReadTicket: mocks.canReadTicket,
}));
import { readTicketGateProof } from "./ticket-gate-proof";
beforeEach(() => vi.clearAllMocks());
it("does not query proof for an unauthorized ticket", async () => {
  mocks.canReadTicket.mockResolvedValue(false);
  expect(
    await readTicketGateProof({ userId: 1, role: "vendor" }, 42),
  ).toBeNull();
  expect(mocks.query).not.toHaveBeenCalled();
});
it("uses the authorized ticket ID and retains absent exit proof", async () => {
  mocks.canReadTicket.mockResolvedValue(true);
  const rows = [{ id: 7, checkOutTime: null, capture: { images: [] } }];
  mocks.query.mockResolvedValue({ rows });
  expect(await readTicketGateProof({ userId: 1, role: "vendor" }, 42)).toEqual({
    ticketId: 42,
    visits: rows,
  });
  expect(mocks.query).toHaveBeenCalledWith(
    expect.stringContaining("WHERE v.gate_capture->>'ticketId'=$1"),
    ["42"],
  );
});
