import { expect, it, vi } from "vitest";
import { createTicketInvoicePreparation, type TicketInvoicePreparationDependencies } from "./ticket-invoice-preparation";
const operationId = "00000000-0000-4000-8000-000000000001";
const command = { operationId, basis: "recorded_invoice_activity" as const, tickets: [{ ticketId: 100007, expectedUpdatedAt: "2026-10-07T10:00:00.123Z" }] };
const actor = { userId: 17, vendorId: 4, membershipId: 12, sessionVersion: 1 };
function fixture() {
  const generate = vi.fn(async () => ({ invoiceId: 55, lineCount: 2 }));
  const activity = vi.fn(async () => ({ basis: command.basis, state: "observed" as const, latestAt: "2026-09-20T10:00:00.000Z", observedAt: "2026-10-07T10:00:00.000Z", exceeds15Days: true, company: { type: "vendor" as const, id: 4 } }));
  let receipt: unknown = null;
  const authorize = vi.fn(async () => undefined), eligible = vi.fn(async () => undefined);
  const deps: TicketInvoicePreparationDependencies = { withLockedBatch: async (_command, _actor, run) => run({ authorize, activity, eligible, generate, prior: () => receipt, save: async value => { receipt = value; } }), now: () => new Date("2026-10-07T10:00:00.000Z") };
  return { ...deps, authorize, eligible, activity, generate, service: createTicketInvoicePreparation(deps) };
}
it("generates canonical approved-ticket drafts once with exact persisted receipt and current replay authority", async () => {
  const f = fixture(), saved = await f.service.execute(command, actor);
  expect(saved).toMatchObject({ operationId, status: "prepared", invoices: [{ ticketId: 100007, invoiceId: 55 }], emailSent: false, issued: false });
  expect(f.eligible).toHaveBeenCalledExactlyOnceWith(command.tickets); expect(f.generate).toHaveBeenCalledExactlyOnceWith(100007);
  expect(await f.service.execute(command, actor)).toEqual(saved); expect(f.generate).toHaveBeenCalledTimes(1); expect(f.authorize).toHaveBeenCalledTimes(2);
});
it("checks actual current chronology and skips known <=15-day condition without generating", async () => {
  const f = fixture(); f.activity.mockResolvedValue({ ...(await f.activity()), latestAt: "2026-09-25T10:00:00.000Z", exceeds15Days: false });
  expect(await f.service.execute(command, actor)).toMatchObject({ status: "condition_not_met", invoices: [] }); expect(f.generate).not.toHaveBeenCalled();
});
it("refuses unexpected generator fields that could replace the selected ticket identity", async () => {
  const f = fixture();
  f.generate.mockResolvedValue({ invoiceId: 55, lineCount: 2, ticketId: 99 } as { invoiceId: number; lineCount: number });
  await expect(f.service.execute(command, actor)).rejects.toThrow();
  expect(await f.service.readback(command, actor)).toBeNull();
});
it("refuses unknown or absent history, wrong company/basis and stale ticket before generator", async () => {
  for (const patch of [{ state: "unknown" }, { state: "no_recorded_event" }, { company: { type: "vendor", id: 9 } }, { basis: "provider_acceptance" }]) {
    const f = fixture(); f.activity.mockResolvedValue({ ...(await f.activity()), ...patch } as Awaited<ReturnType<typeof f.activity>>);
    await expect(f.service.execute(command, actor)).rejects.toThrow(); expect(f.generate).not.toHaveBeenCalled();
  }
  const f = fixture(); f.eligible.mockRejectedValue(Error("ticket_changed")); await expect(f.service.execute(command, actor)).rejects.toThrow("ticket_changed"); expect(f.generate).not.toHaveBeenCalled();
});
it("rejects changed retry, revoked billing authority and injected money/email/model fields", async () => {
  const f = fixture(); await f.service.execute(command, actor);
  await expect(f.service.execute({ ...command, tickets: [{ ticketId: 100008, expectedUpdatedAt: command.tickets[0].expectedUpdatedAt }] }, actor)).rejects.toThrow("operation_conflict");
  f.authorize.mockRejectedValue(Error("billing_revoked")); await expect(f.service.execute(command, actor)).rejects.toThrow("billing_revoked");
  await expect(f.service.execute({ ...command, amountCents: 100, send: true }, actor)).rejects.toThrow();
});
