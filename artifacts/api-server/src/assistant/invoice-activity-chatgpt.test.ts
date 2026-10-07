import { expect, it, vi } from "vitest";
import { createInvoiceActivityHandler, INVOICE_ACTIVITY_TOOL } from "./invoice-activity-chatgpt";
import type { readInvoiceActivity } from "./invoice-activity-read";
const session = { userId: 17, role: "vendor", vendorId: 4, activeMembershipId: 8, membershipRole: "admin", sv: 2 };
const result: Awaited<ReturnType<typeof readInvoiceActivity>> = { basis: "recorded_invoice_activity", observedAt: "2026-10-07T12:00:00Z", company: { type: "vendor", id: 4 }, events: ["manual_issue", "ticket_send_attempt", "provider_acceptance"].map(kind => ({ kind: kind as "manual_issue" | "ticket_send_attempt" | "provider_acceptance", observedRecords: 0, undatedRecords: 0, latestAt: null, sourceReference: null })), state: "no_recorded_event", latestAt: null, elapsedDays: null, thresholdDays: 15, exceeds15Days: null, preparationRecommended: false, draftPrepared: false, deliveryVerified: false, limitations: [] };
it("advertises finance consent and calls only the read with authenticated account context", async () => {
  expect(INVOICE_ACTIVITY_TOOL.securitySchemes).toEqual([{ type: "oauth2", scopes: ["finance:read"] }]);
  const read = vi.fn(async () => result);
  expect(await createInvoiceActivityHandler(read)({}, session, ["finance:read"])).toEqual(result);
  expect(read).toHaveBeenCalledExactlyOnceWith({ basis: "recorded_invoice_activity" }, session, ["finance:read"]);
});
it("denies unadvertised direct calls without scope/role/context and rejects account overrides", async () => {
  const read = vi.fn(async () => result), handler = createInvoiceActivityHandler(read);
  await expect(handler({}, session, [])).rejects.toThrow();
  await expect(handler({}, { ...session, role: "field_employee" }, ["finance:read"])).rejects.toThrow();
  await expect(handler({}, { ...session, activeMembershipId: undefined }, ["finance:read"])).rejects.toThrow();
  await expect(handler({ vendorId: 9 }, session, ["finance:read"])).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
it("refuses unexpected private fields or manufactured draft/delivery claims", async () => {
  for (const extra of [{ providerCredential: "private" }, { draftPrepared: true }, { deliveryVerified: true }]) {
    const handler = createInvoiceActivityHandler(vi.fn(async () => ({ ...result, ...extra })) as typeof readInvoiceActivity);
    await expect(handler({}, session, ["finance:read"])).rejects.toThrow();
  }
});
