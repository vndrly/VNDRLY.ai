import { expect, it, vi } from "vitest";
import { readInvoiceActivityInTransaction } from "./invoice-activity-transaction-read";
const session = { userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 8, membershipRole: "admin", sv: 2 };
const rows = ["manual_issue", "ticket_send_attempt", "provider_acceptance"].map(kind => ({ kind, recordId: null, eventId: null, at: null, records: 0, undated: 0 }));
it("uses caller's transaction without starting/committing or releasing it and checks persisted authority", async () => {
  const query = vi.fn(async (text: string) => ({ rows: text.startsWith("SELECT u.id") ? [{ id: 17 }] : text.startsWith("SELECT data") ? [] : rows }));
  const result = await readInvoiceActivityInTransaction({}, session, { query }, new Date("2026-10-07T12:00:00Z"));
  expect(result).toMatchObject({ state: "no_recorded_event", preparationRecommended: false });
  expect(query).toHaveBeenCalledTimes(3); expect(query.mock.calls.every(([text]) => !/BEGIN|COMMIT|ROLLBACK/.test(text))).toBe(true);
  expect(query.mock.calls[0]).toEqual([expect.stringContaining("FOR SHARE OF u,m"), [17, 2, 8, "vendor", 4, "admin"]]);
});
it("does not execute chronology for invalid current membership or billing permission", async () => {
  const denied = vi.fn(async () => ({ rows: [] }));
  await expect(readInvoiceActivityInTransaction({}, session, { query: denied })).rejects.toThrow("current_authority"); expect(denied).toHaveBeenCalledTimes(1);
  const member = vi.fn(async (text: string) => ({ rows: text.startsWith("SELECT u.id") ? [{ id: 17 }] : [] }));
  await expect(readInvoiceActivityInTransaction({}, { ...session, membershipRole: "member" }, { query: member })).rejects.toThrow("billing_permission"); expect(member).toHaveBeenCalledTimes(2);
});
