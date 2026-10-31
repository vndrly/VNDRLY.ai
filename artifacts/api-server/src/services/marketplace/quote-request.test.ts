import { beforeEach, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
const state = vi.hoisted(() => ({ recipients: [{ id: 12 }], existing: [] as { id: number }[], notify: vi.fn() }));
vi.mock("../../routes/notifications", () => ({ notifyUsers: state.notify }));
vi.mock("@workspace/db", async (original) => {
  const actual = await original<Record<string, unknown>>();
  const select = () => {
    let table: string;
    const query: any = {
      from(value: any) { table = getTableName(value); return query; },
      innerJoin() { return query; }, where() { return query; }, limit() { return query; },
      then(resolve: any, reject: any) {
        return Promise.resolve(table === "user_org_memberships" ? state.recipients : table === "partners" ? [{ name: "Partner A" }] : state.existing).then(resolve, reject);
      },
    };
    return query;
  };
  return { ...actual, db: { select, selectDistinct: select } };
});
import { notifyMarketplaceQuoteRequest } from "./quote-request";
const input = { partnerId: 1, vendorId: 2, capabilityId: 3, workTypeId: 4, workTypeName: "Gatekeeping", siteId: 5, requestedCapacity: 1, scope: "Monday shift", now: new Date("2026-10-31T00:00:00Z") };
beforeEach(() => { state.recipients = [{ id: 12 }]; state.existing = []; state.notify.mockReset().mockResolvedValue(1); });
it("delivers scoped actionable quote instructions with a stable retry key", async () => {
  await notifyMarketplaceQuoteRequest(input);
  expect(state.notify).toHaveBeenCalledWith([12], expect.objectContaining({ link: "/vendor-catalog", body: expect.stringContaining("Monday shift"), dedupeKey: expect.stringMatching(/^marketplace-quote:1:2:3:4:5:2026-10-31:[a-f0-9]{24}$/) }));
});
it("does not report delivery when preferences or an insertion failure prevented every inbox record", async () => {
  state.notify.mockResolvedValue(0);
  await expect(notifyMarketplaceQuoteRequest(input)).rejects.toMatchObject({ code: "marketplace.quote_delivery_unavailable" });
});
it("treats a previously persisted request as a safe retry", async () => {
  state.notify.mockResolvedValue(0); state.existing = [{ id: 77 }];
  await expect(notifyMarketplaceQuoteRequest(input)).resolves.toBeUndefined();
});
it("requires an available vendor office recipient", async () => {
  state.recipients = [];
  await expect(notifyMarketplaceQuoteRequest(input)).rejects.toMatchObject({ code: "marketplace.vendor_contact_unavailable" });
  expect(state.notify).not.toHaveBeenCalled();
});

it("does not suppress a corrected quote scope as an identical retry", async () => {
  await notifyMarketplaceQuoteRequest(input);
  const first = state.notify.mock.calls[0][1].dedupeKey;
  await notifyMarketplaceQuoteRequest({ ...input, scope: "Tuesday shift" });
  expect(state.notify.mock.calls[1][1].dedupeKey).not.toBe(first);
});
