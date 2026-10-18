import { beforeEach, describe, expect, it } from "vitest";
import {
  createJobOfferService,
  type JobOfferPersistence,
  type JobOfferTransaction,
} from "./job-offers";
import type { JobOffer } from "@workspace/db/schema";
import type { SessionPayload } from "../../lib/session";

const partner = {
  role: "partner",
  partnerId: 1,
  userId: 10,
  activeMembershipId: 1,
  membershipRole: "admin",
} as SessionPayload;
const vendor = {
  role: "vendor",
  vendorId: 2,
  userId: 20,
  activeMembershipId: 2,
  membershipRole: "admin",
} as SessionPayload;
const input = {
  partnerId: 1,
  vendorId: 2,
  workTypeId: 3,
  vendorCapabilityId: 4,
  vendorPartnerServiceOfferId: 5,
  siteLocationId: 6,
  scope: "Pressure test",
  requestedStartAt: "2026-11-01T10:00:00Z",
  requestedEndAt: "2026-11-01T12:00:00Z",
  crewCount: 2,
  attachmentUrls: [],
  expiresAt: "2026-10-31T10:00:00Z",
};

describe("job offer lifecycle", () => {
  let offers: JobOffer[],
    snapshots: any[],
    tickets: any[],
    authority: boolean,
    eligible: boolean,
    rateVersion: number,
    now: Date,
    failTicket: boolean;
  let service: ReturnType<typeof createJobOfferService>;
  beforeEach(() => {
    offers = [];
    snapshots = [];
    tickets = [];
    authority = true;
    eligible = true;
    rateVersion = 1;
    now = new Date("2026-10-18");
    failTicket = false;
    let queue = Promise.resolve();
    const storage: JobOfferPersistence = {
      async transaction(run) {
        const previous = queue;
        let release!: () => void;
        queue = new Promise<void>((resolve) => {
          release = resolve;
        });
        await previous;
        const original = structuredClone({ offers, snapshots, tickets });
        const tx: JobOfferTransaction = {
          authorize: async () => authority,
          findByKey: async (partnerId, key) =>
            offers.find(
              (x) => x.partnerId === partnerId && x.idempotencyKey === key,
            ) ?? null,
          get: async (id) => offers.find((x) => x.id === id) ?? null,
          list: async (side, id) =>
            offers.filter(
              (x) => x[side === "partner" ? "partnerId" : "vendorId"] === id,
            ),
          validate: async () => {
            if (!eligible)
              throw Object.assign(new Error("marketplace.ineligible"), {
                status: 409,
              });
            return {
              canonicalServiceId: 7,
              commercial: {
                rateVersion,
                unitPrice: "125.00",
                unit: "hour",
                currency: "USD",
                demandMappingId: 8,
                capabilityMappingId: 9,
              },
              coverage: { radiusMiles: 50 },
              eligibility: { eligible: true },
            };
          },
          insert: async (data) => {
            const row = {
              ...data,
              id: offers.length + 1,
              createdTicketId: null,
            } as JobOffer;
            offers.push(row);
            return row;
          },
          update: async (id, data) => {
            const row = offers.find((x) => x.id === id)!;
            Object.assign(row, data);
            return row;
          },
          snapshot: async (data) => {
            snapshots.push(data);
          },
          acceptedVersion: async (id) =>
            snapshots.find((x) => x.jobOfferId === id)?.offerVersion ?? null,
          engage: async () => {},
          createTicket: async (offer) => {
            if (failTicket) throw new Error("ticket failed");
            const ticket = {
              id: tickets.length + 100,
              workTypeId: offer.workTypeId,
              jobOfferId: offer.id,
            };
            tickets.push(ticket);
            return ticket.id;
          },
          expire: async (date) => {
            let count = 0;
            for (const row of offers)
              if (
                ["offered", "vendor_reviewing"].includes(row.status) &&
                row.expiresAt! <= date
              ) {
                row.status = "expired";
                count++;
              }
            return count;
          },
        };
        try {
          return await run(tx);
        } catch (error) {
          ({ offers, snapshots, tickets } = original);
          throw error;
        } finally {
          release();
        }
      },
    };
    service = createJobOfferService(storage, () => now);
  });
  const draft = () => service.createJobOffer(input, partner, "create-1");
  const sent = async () => {
    const row = await draft();
    return service.sendJobOffer({
      offerId: row.id,
      version: row.version,
      session: partner,
    });
  };
  const acceptance = (row: JobOffer) => ({
    offerId: row.id,
    version: row.version,
    session: vendor,
    idempotencyKey: "accept-1",
  });
  it("freezes server terms, retains the partner work type, and returns one ticket on retries", async () => {
    const row = structuredClone(await sent());
    expect(row).toMatchObject({
      status: "offered",
      version: 2,
      commercialSnapshot: { unitPrice: "125.00" },
    });
    const results = await Promise.all([
      service.acceptJobOffer(acceptance(row)),
      service.acceptJobOffer(acceptance(row)),
      service.acceptJobOffer({
        ...acceptance(row),
        idempotencyKey: "retry-with-new-key",
      }),
    ]);
    expect(results.map((x) => x.ticketId)).toEqual([100, 100, 100]);
    expect(results.map((x) => x.replayed)).toEqual([false, true, true]);
    expect(tickets).toEqual([{ id: 100, workTypeId: 3, jobOfferId: row.id }]);
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0]).toMatchObject({
      offerVersion: 2,
      commercialSnapshot: { unitPrice: "125.00" },
      scopeSnapshot: { scope: "Pressure test", crewCount: 2 },
    });
  });
  it("rolls back acceptance and the snapshot if ticket creation fails", async () => {
    const row = structuredClone(await sent());
    failTicket = true;
    await expect(service.acceptJobOffer(acceptance(row))).rejects.toThrow(
      "ticket failed",
    );
    expect(offers[0].status).toBe("offered");
    expect(snapshots).toHaveLength(0);
    expect(tickets).toHaveLength(0);
  });
  it("rejects changed rate versions, stale submitted versions, and newly ineligible work", async () => {
    const row = structuredClone(await sent());
    await expect(
      service.acceptJobOffer({ ...acceptance(row), version: 1 }),
    ).rejects.toThrow("marketplace.stale_offer");
    rateVersion = 2;
    await expect(service.acceptJobOffer(acceptance(row))).rejects.toThrow(
      "marketplace.terms_changed",
    );
    rateVersion = 1;
    eligible = false;
    await expect(service.acceptJobOffer(acceptance(row))).rejects.toThrow(
      "marketplace.ineligible",
    );
    expect(tickets).toHaveLength(0);
  });
  it("revalidates actor authority including accepted result readback", async () => {
    const row = structuredClone(await sent());
    await expect(
      service.acceptJobOffer({ ...acceptance(row), session: partner }),
    ).rejects.toThrow("marketplace.vendor_scope_required");
    await service.acceptJobOffer(acceptance(row));
    authority = false;
    await expect(service.acceptJobOffer(acceptance(row))).rejects.toThrow(
      "marketplace.vendor_scope_required",
    );
    await expect(service.getJobOffer(row.id, partner)).rejects.toThrow();
  });
  it("permits review and decline, and forbids later acceptance", async () => {
    const row = await sent();
    const reviewing = await service.reviewJobOffer({
      offerId: row.id,
      version: row.version,
      session: vendor,
    });
    const declined = await service.declineJobOffer({
      offerId: row.id,
      version: reviewing.version,
      session: vendor,
    });
    expect(declined.status).toBe("declined");
    await expect(service.acceptJobOffer(acceptance(declined))).rejects.toThrow(
      "marketplace.offer_not_open",
    );
  });
  it("permits partner withdrawal and expiration is idempotent without tickets", async () => {
    const row = await sent();
    await service.withdrawJobOffer({
      offerId: row.id,
      version: row.version,
      session: partner,
    });
    expect(offers[0].status).toBe("withdrawn");
    const second = await service.createJobOffer(input, partner, "create-2");
    await service.sendJobOffer({
      offerId: second.id,
      version: second.version,
      session: partner,
    });
    now = new Date(input.expiresAt);
    expect(await service.expireJobOffers()).toBe(1);
    expect(await service.expireJobOffers()).toBe(0);
    expect(tickets).toHaveLength(0);
  });
  it("deduplicates create but rejects reuse of its key for different scope", async () => {
    expect((await draft()).id).toBe((await draft()).id);
    await expect(
      service.createJobOffer(
        { ...input, scope: "Different work" },
        partner,
        "create-1",
      ),
    ).rejects.toThrow("marketplace.idempotency_conflict");
  });
  it("rejects expired acceptance even before the worker runs", async () => {
    const row = structuredClone(await sent());
    now = new Date(input.expiresAt);
    await expect(service.acceptJobOffer(acceptance(row))).rejects.toThrow(
      "marketplace.offer_expired",
    );
    expect(tickets).toHaveLength(0);
  });
  it("rechecks eligibility before send without changing the prepared commercial terms", async () => {
    const row = await draft();
    eligible = false;
    await expect(
      service.sendJobOffer({
        offerId: row.id,
        version: row.version,
        session: partner,
      }),
    ).rejects.toThrow("marketplace.ineligible");
    expect(offers[0].status).toBe("draft");
    expect(offers[0].commercialSnapshot.unitPrice).toBe("125.00");
  });
  it("keeps drafts private to the owning partner", async () => {
    const row = await draft();
    await expect(service.getJobOffer(row.id, vendor)).rejects.toThrow(
      "marketplace.offer_not_found",
    );
    expect(await service.listJobOffers("vendor", 2, vendor)).toEqual([]);
    expect(
      (await service.listJobOffers("partner", 1, partner)).map((x) => x.id),
    ).toEqual([row.id]);
    await service.withdrawJobOffer({
      offerId: row.id,
      version: row.version,
      session: partner,
    });
    expect(await service.listJobOffers("vendor", 2, vendor)).toEqual([]);
    await expect(service.getJobOffer(row.id, vendor)).rejects.toThrow(
      "marketplace.offer_not_found",
    );
  });
  it.each([
    { ...partner, partnerId: 99 },
    { ...partner, vendorId: 2 },
    { ...partner, activeMembershipId: undefined },
    { ...partner, membershipRole: "ap" },
    { ...partner, publicDemo: true },
  ])(
    "blocks mismatched or non-operating partner authority",
    async (session) => {
      await expect(
        service.createJobOffer(input, session, "create-1"),
      ).rejects.toThrow("marketplace.partner_scope_required");
      expect(offers).toHaveLength(0);
    },
  );
});
