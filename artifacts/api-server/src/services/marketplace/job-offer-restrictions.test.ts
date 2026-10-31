import { describe, expect, it, vi } from "vitest";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { createPostgresJobOfferPersistence } from "./job-offers-postgres";
import { createJobOfferService } from "./job-offers";

describe("persisted offer restriction boundary", () => {
  function setup(status: string | null, offerStatus = "offered") {
    const reads: any[] = [];
    const writes = vi.fn();
    const offer = { id: 1, partnerId: 9, vendorId: 3, workTypeId: 21, vendorCapabilityId: 7, vendorPartnerServiceOfferId: 12, siteLocationId: 8,
      status: offerStatus, version: 2, scope: "Control entry", afeReference: "PARTNER-AFE", scheduledStartAt: new Date("2026-11-01"), scheduledEndAt: new Date("2026-11-02"),
      expiresAt: new Date("2026-10-31"), crewCount: 1, attachments: [], commercialSnapshot: {}, createdTicketId: null };
    const data: Record<string, any[]> = { job_offers: [offer], users: [{ id: 1, role: "admin", sessionVersion: 1 }], vendors: [{ id: 3 }], partner_vendor_relationships: status ? [{ status }] : [], vendor_capabilities: [] };
    const connection = { transaction: async (run: any, options: any) => {
      expect(options.isolationLevel).toBe("serializable");
      return run({ select: () => {
        let table: string, condition: any, lock: string | undefined;
        const q: any = { from: (value: any) => { table = getTableName(value); return q; }, where: (value: any) => { condition = value; return q; },
          for: (value: string) => { lock = value; return q; }, then: (resolve: any, reject: any) => {
            reads.push({ table, lock, ...new PgDialect().sqlToQuery(condition) });
            return Promise.resolve(data[table] ?? []).then(resolve, reject);
          } };
        return q;
      }, insert: writes, update: writes });
    } } as any;
    return { reads, writes, persistence: createPostgresJobOfferPersistence(connection) };
  }
  const session = { userId: 1, role: "admin", sv: 1 } as any;
  it.each(["revoked", "rejected", "suspended"])("blocks accepting an outstanding offer after %s, before snapshots/engagement/tickets", async status => {
    const x = setup(status);
    const service = createJobOfferService(x.persistence, () => new Date("2026-10-18"));
    await expect(service.acceptJobOffer({ offerId: 1, version: 2, session, idempotencyKey: "accept" })).rejects.toMatchObject({ code: "marketplace.relationship_restricted" });
    expect(x.writes).not.toHaveBeenCalled();
    expect(x.reads.find(row => row.table === "vendors")).toMatchObject({ lock: "share", params: [3] });
    expect(x.reads.find(row => row.table === "partner_vendor_relationships")).toMatchObject({ lock: "share", params: [9, 3] });
  });
  it("blocks sending a draft after revocation", async () => {
    const x = setup("revoked", "draft");
    await expect(createJobOfferService(x.persistence, () => new Date("2026-10-18")).sendJobOffer({ offerId: 1, version: 2, session })).rejects.toMatchObject({ code: "marketplace.relationship_restricted" });
    expect(x.writes).not.toHaveBeenCalled();
  });
  it.each([null, "pending_review", "approved"])("does not turn %s into a blanket relationship requirement", async status => {
    const x = setup(status);
    await expect(createJobOfferService(x.persistence, () => new Date("2026-10-18")).acceptJobOffer({ offerId: 1, version: 2, session, idempotencyKey: "accept" })).rejects.toMatchObject({ code: "marketplace.capability_inactive" });
    expect(x.reads.some(row => row.table === "vendor_capabilities")).toBe(true);
  });
});
