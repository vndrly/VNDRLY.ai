import { expect, it, vi } from "vitest";
import { readTicketInvoiceCandidates } from "./ticket-invoice-candidates";
const session = {
  userId: 17,
  role: "vendor",
  vendorId: 4,
  activeMembershipId: 12,
  membershipRole: "member",
  sv: 1,
};
function fixture() {
  const query = vi
    .fn()
    .mockResolvedValueOnce({ rows: [{ id: 17 }] })
    .mockResolvedValueOnce({ rows: [{ data: { roles: ["billing_manager"] } }] })
    .mockResolvedValueOnce({
      rows: [
        {
          id: 100007,
          vendorId: 4,
          siteLocationId: 392,
          status: "approved",
          updatedAt: new Date("2026-10-07T10:00:00.123Z"),
        },
        {
          id: 100008,
          vendorId: 4,
          siteLocationId: 392,
          status: "approved",
          updatedAt: new Date("2026-10-07T11:00:00.456Z"),
        },
      ],
    });
  return {
    query,
    run: (input: unknown = {}) =>
      readTicketInvoiceCandidates(
        input,
        session,
        { query },
        new Date("2026-10-07T12:00:00Z"),
      ),
  };
}
it("returns bounded exact version selections and explicit current source/truncation without approval", async () => {
  const f = fixture();
  const result = await f.run({ limit: 1, afterTicketId: 100000 });
  expect(result).toEqual({
    company: { type: "vendor", id: 4 },
    observedAt: "2026-10-07T12:00:00.000Z",
    source: "canonical_approved_uninvoiced_tickets",
    tickets: [
      {
        ticketId: 100007,
        siteLocationId: 392,
        status: "approved",
        expectedUpdatedAt: "2026-10-07T10:00:00.123Z",
      },
    ],
    page: { limit: 1, nextAfterTicketId: 100007, truncated: true },
    automaticApprovalCreated: false,
    invoicesPrepared: false,
  });
  expect(f.query.mock.calls[2][1]).toEqual([4, 100000, 2]);
  expect(f.query.mock.calls[2][0]).toContain("NOT EXISTS");
  expect(f.query.mock.calls[2][0]).toContain("t.vendor_id=$1");
});
it("rechecks exact persisted session/membership and removed billing grants before reading tickets", async () => {
  for (const missing of ["membership", "billing"]) {
    const f = fixture();
    f.query.mockReset();
    f.query
      .mockResolvedValueOnce({
        rows: missing === "membership" ? [] : [{ id: 17 }],
      })
      .mockResolvedValueOnce({ rows: [] });
    await expect(f.run()).rejects.toThrow();
    expect(f.query).toHaveBeenCalledTimes(missing === "membership" ? 1 : 2);
  }
});
it("refuses injected company, unbounded selection, foreign rows and malformed saved versions", async () => {
  for (const input of [
    { vendorId: 99 },
    { limit: 21 },
    { afterTicketId: -1 },
  ]) {
    const f = fixture();
    await expect(f.run(input)).rejects.toThrow();
    expect(f.query).not.toHaveBeenCalled();
  }
  for (const patch of [
    { vendorId: 99 },
    { updatedAt: "not a date" },
    { status: "submitted" },
  ]) {
    const f = fixture();
    f.query.mockReset();
    f.query
      .mockResolvedValueOnce({ rows: [{ id: 17 }] })
      .mockResolvedValueOnce({
        rows: [{ data: { roles: ["billing_manager"] } }],
      })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 100007,
            vendorId: 4,
            siteLocationId: 392,
            status: "approved",
            updatedAt: new Date(),
            ...patch,
          },
        ],
      });
    await expect(f.run()).rejects.toThrow();
  }
});
it("distinguishes an authorized empty page and rejects platform/partner context", async () => {
  const f = fixture();
  f.query.mockReset();
  f.query
    .mockResolvedValueOnce({ rows: [{ id: 17 }] })
    .mockResolvedValueOnce({ rows: [{ data: { roles: ["billing_manager"] } }] })
    .mockResolvedValueOnce({ rows: [] });
  expect(await f.run()).toMatchObject({
    tickets: [],
    page: { truncated: false, nextAfterTicketId: null },
  });
  for (const role of ["admin", "partner", "field_employee"])
    await expect(
      readTicketInvoiceCandidates({}, { ...session, role }, { query: vi.fn() }),
    ).rejects.toThrow();
});
