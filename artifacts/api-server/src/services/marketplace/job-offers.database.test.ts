import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import * as s from "@workspace/db/schema";
import { createJobOfferService } from "./job-offers";
import { subjectFingerprint } from "../service-matching/candidates";
import type { SessionPayload } from "../../lib/session";

// Never fall back to DATABASE_URL or a shared dev server. The fresh-local wrapper
// creates a brand new database and verifies its server identity before schema work.
const enabled =
  process.env.VNDRLY_TEST_DB_MODE === "fresh-local" &&
  process.env.VNDRLY_ISOLATED_TEST_DB === "1";
describe.skipIf(!enabled)("job offers on isolated PostgreSQL", () => {
  let db: typeof import("@workspace/db").db;
  let persistence: typeof import("./job-offers-postgres").createPostgresJobOfferPersistence;
  const now = new Date("2026-10-18T00:00:00Z");
  beforeAll(async () => {
    const { assertFreshLocalTestDatabaseEnvironment } =
      await import("../../../../../scripts/fresh-test-database.mjs");
    assertFreshLocalTestDatabaseEnvironment(process.env);
    db = (await import("@workspace/db")).db;
    const identity = await db.execute<{ name: string }>(
      sql`select current_database() as name`,
    );
    expect(identity.rows[0].name).toBe(process.env.VNDRLY_FRESH_TEST_DB_NAME);
    persistence = (await import("./job-offers-postgres"))
      .createPostgresJobOfferPersistence;
  });
  async function fixture() {
    const suffix = randomUUID();
    const [partner] = await db
      .insert(s.partnersTable)
      .values({
        name: `Offer partner ${suffix}`,
        contactName: "Test",
        contactEmail: `${suffix}@example.invalid`,
      })
      .returning();
    const [vendor] = await db
      .insert(s.vendorsTable)
      .values({
        name: `Offer vendor ${suffix}`,
        contactName: "Test",
        contactEmail: `${suffix}@example.invalid`,
        federalTaxId: "00-0000000",
        coiDocumentUrl: "test",
        insuranceExpirationDate: "2099-01-01",
        wcDocumentUrl: "test",
        wcExpirationDate: "2099-01-01",
        glDocumentUrl: "test",
        glExpirationDate: "2099-01-01",
        autoLiabilityDocumentUrl: "test",
        autoLiabilityExpirationDate: "2099-01-01",
        w9DocumentUrl: "test",
      })
      .returning();
    const [user] = await db
      .insert(s.usersTable)
      .values({
        username: suffix,
        passwordHash: "test-only-unusable",
        displayName: "Offer test",
        role: "admin",
      })
      .returning();
    const actor = {
      role: "admin",
      userId: user.id,
      sv: user.sessionVersion,
    } as SessionPayload;
    const [work] = await db
      .insert(s.workTypesTable)
      .values({
        partnerId: partner.id,
        name: "Pressure testing",
        category: "Testing",
        description: "Pressure test",
      })
      .returning();
    const [site] = await db
      .insert(s.siteLocationsTable)
      .values({
        partnerId: partner.id,
        name: suffix,
        address: "Test site",
        latitude: 35,
        longitude: -97,
        siteCode: suffix,
      })
      .returning();
    const [service] = await db
      .insert(s.canonicalServicesTable)
      .values({
        code: suffix,
        name: "Pressure testing",
        category: "Testing",
        definition: "Pressure test",
      })
      .returning();
    const [capability] = await db
      .insert(s.vendorCapabilitiesTable)
      .values({ vendorId: vendor.id, name: "Pressure test crew", capacity: 2 })
      .returning();
    const [area] = await db
      .insert(s.vendorServiceAreasTable)
      .values({
        vendorId: vendor.id,
        address: "Test base",
        latitude: 35,
        longitude: -97,
        radiusMiles: "50",
        coordinateProvenance: "test",
        verifiedAt: now,
        effectiveFrom: now,
      })
      .returning();
    const base = {
      canonicalServiceId: service.id,
      status: "active" as const,
      confidence: "1",
      explanation: "Verified fixture",
      modelVersion: "fixture",
      mappingVersion: 1,
    };
    await db.insert(s.serviceMappingsTable).values({
      ...base,
      subjectType: "partner_work_type",
      subjectId: work.id,
      workTypeId: work.id,
      evidence: {
        serviceMatching: {
          subjectFingerprint: subjectFingerprint({
            subjectType: "partner_work_type",
            subjectId: work.id,
            name: work.name,
            description: work.description,
            category: work.category,
          }),
        },
      },
    });
    const [mapping] = await db
      .insert(s.serviceMappingsTable)
      .values({
        ...base,
        subjectType: "vendor_capability",
        subjectId: capability.id,
        vendorCapabilityId: capability.id,
        evidence: {
          serviceMatching: {
            subjectFingerprint: subjectFingerprint({
              subjectType: "vendor_capability",
              subjectId: capability.id,
              name: capability.name,
              description: capability.description,
            }),
          },
        },
      })
      .returning();
    const [rate] = await db
      .insert(s.vendorPartnerServiceOffersTable)
      .values({
        vendorCapabilityId: capability.id,
        partnerId: partner.id,
        workTypeId: work.id,
        unitPrice: "125.00",
        unit: "hour",
        capacity: 2,
        effectiveFrom: now,
      })
      .returning();
    const input = {
      partnerId: partner.id,
      vendorId: vendor.id,
      workTypeId: work.id,
      siteLocationId: site.id,
      vendorCapabilityId: capability.id,
      vendorPartnerServiceOfferId: rate.id,
      scope: "Pressure test",
      crewCount: 2,
      attachmentUrls: [],
      requestedStartAt: "2026-11-01T10:00:00Z",
      requestedEndAt: "2026-11-01T12:00:00Z",
      expiresAt: "2026-10-31T10:00:00Z",
    };
    const store = persistence(db);
    delete store.afterCommit; // No external notifications from isolated tests.
    const api = createJobOfferService(store, () => now);
    const draft = await api.createJobOffer(input, actor, randomUUID());
    const sent = await api.sendJobOffer({
      offerId: draft.id,
      version: draft.version,
      session: actor,
    });
    const accept = {
      offerId: sent.id,
      version: sent.version,
      session: actor,
      idempotencyKey: randomUUID(),
    };
    return {
      api,
      store,
      input,
      actor,
      sent,
      accept,
      vendor,
      user,
      work,
      area,
      rate,
      mapping,
    };
  }
  it("serializes simultaneous accepts and writes exactly one coherent ticket and frozen snapshot", async () => {
    const f = await fixture();
    const { vendorCanReadSite } =
      await import("../../lib/approved-partner-sites");
    expect(
      await vendorCanReadSite(
        f.vendor.id,
        f.input.partnerId,
        f.input.siteLocationId,
      ),
    ).toBe(false);
    const results = await Promise.all(
      Array.from({ length: 3 }, () => f.api.acceptJobOffer(f.accept)),
    );
    expect(new Set(results.map((row) => row.ticketId)).size).toBe(1);
    expect(results.filter((row) => !row.replayed)).toHaveLength(1);
    const tickets = await db
      .select()
      .from(s.ticketsTable)
      .where(eq(s.ticketsTable.jobOfferId, f.sent.id));
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      workTypeId: f.work.id,
      status: "initiated",
      lifecycleState: "pending_arrival",
      checkInTime: null,
      jobOfferId: f.sent.id,
    });
    const snapshots = await db
      .select()
      .from(s.jobOfferAcceptanceSnapshotsTable)
      .where(eq(s.jobOfferAcceptanceSnapshotsTable.jobOfferId, f.sent.id));
    expect(snapshots).toHaveLength(1);
    expect(snapshots[0].commercialSnapshot.unitPrice).toBe("125.00");
    expect((await f.api.getJobOffer(f.sent.id, f.actor)).createdTicketId).toBe(
      tickets[0].id,
    );
    expect(
      await db
        .select()
        .from(s.ticketStatusHistoryTable)
        .where(eq(s.ticketStatusHistoryTable.ticketId, tickets[0].id)),
    ).toHaveLength(1);
    const [relationship] = await db
      .select()
      .from(s.partnerVendorRelationshipsTable)
      .where(
        eq(s.partnerVendorRelationshipsTable.partnerId, f.input.partnerId),
      );
    expect(relationship.status).toBe("pending_review");
    const { canReadTicket } = await import("../../lib/field-ticket-access");
    expect(
      await canReadTicket(
        { ...f.actor, role: "vendor", vendorId: f.vendor.id },
        tickets[0].id,
      ),
    ).toBe(true);
    expect(
      await canReadTicket(
        { ...f.actor, role: "partner", partnerId: f.input.partnerId },
        tickets[0].id,
      ),
    ).toBe(true);
    expect(
      await canReadTicket(
        { ...f.actor, role: "vendor", vendorId: f.vendor.id + 1000000 },
        tickets[0].id,
      ),
    ).toBe(false);
    expect(
      await vendorCanReadSite(
        f.vendor.id,
        f.input.partnerId,
        f.input.siteLocationId,
      ),
    ).toBe(true);
    expect(
      await vendorCanReadSite(
        f.vendor.id,
        f.input.partnerId,
        f.input.siteLocationId + 1000000,
      ),
    ).toBe(false);
    await db
      .update(s.vendorPartnerServiceOffersTable)
      .set({ unitPrice: "999.00", version: 2 })
      .where(eq(s.vendorPartnerServiceOffersTable.id, f.rate.id));
    await db
      .update(s.vendorsTable)
      .set({ dailyOtHours: "12" })
      .where(eq(s.vendorsTable.id, f.vendor.id));
    const { loadTicketCommercialRate } =
      await import("../../lib/ticket-commercial-rate");
    expect(await loadTicketCommercialRate(tickets[0], db)).toMatchObject({
      unitPrice: "125.00",
      dailyOtHours: "8",
      automaticBilling: "hourly_usd",
    });
  });
  it.each([
    "compliance",
    "coverage",
    "capacity",
    "rate",
    "mapping",
    "authorization",
    "credential",
  ])("blocks changed %s before creating any ticket", async (kind) => {
    const f = await fixture();
    if (kind === "compliance")
      await db
        .update(s.vendorsTable)
        .set({ wcExpirationDate: "2020-01-01" })
        .where(eq(s.vendorsTable.id, f.vendor.id));
    if (kind === "coverage")
      await db
        .update(s.vendorServiceAreasTable)
        .set({ latitude: 40 })
        .where(eq(s.vendorServiceAreasTable.id, f.area.id));
    if (kind === "capacity")
      await db
        .update(s.vendorPartnerServiceOffersTable)
        .set({ capacity: 1 })
        .where(eq(s.vendorPartnerServiceOffersTable.id, f.rate.id));
    if (kind === "rate")
      await db
        .update(s.vendorPartnerServiceOffersTable)
        .set({ version: 2 })
        .where(eq(s.vendorPartnerServiceOffersTable.id, f.rate.id));
    if (kind === "mapping")
      await db
        .update(s.serviceMappingsTable)
        .set({ status: "rejected" })
        .where(eq(s.serviceMappingsTable.id, f.mapping.id));
    if (kind === "authorization")
      await db
        .update(s.usersTable)
        .set({ suspendedAt: now })
        .where(eq(s.usersTable.id, f.user.id));
    if (kind === "credential")
      await db
        .update(s.workTypesTable)
        .set({ requiredCertifications: ["H2S"] })
        .where(eq(s.workTypesTable.id, f.work.id));
    await expect(f.api.acceptJobOffer(f.accept)).rejects.toThrow();
    expect(
      await db
        .select()
        .from(s.ticketsTable)
        .where(eq(s.ticketsTable.jobOfferId, f.sent.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(s.jobOfferAcceptanceSnapshotsTable)
        .where(eq(s.jobOfferAcceptanceSnapshotsTable.jobOfferId, f.sent.id)),
    ).toHaveLength(0);
  });
  it("rolls back the snapshot and relationship when ticket insertion fails", async () => {
    const f = await fixture();
    const broken = createJobOfferService(
      {
        transaction: (run) =>
          f.store.transaction((tx) =>
            run({
              ...tx,
              createTicket: async () => {
                throw new Error("injected ticket insert failure");
              },
            }),
          ),
      },
      () => now,
    );
    await expect(broken.acceptJobOffer(f.accept)).rejects.toThrow(
      "injected ticket insert failure",
    );
    expect((await f.api.getJobOffer(f.sent.id, f.actor)).status).toBe(
      "offered",
    );
    expect(
      await db
        .select()
        .from(s.jobOfferAcceptanceSnapshotsTable)
        .where(eq(s.jobOfferAcceptanceSnapshotsTable.jobOfferId, f.sent.id)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(s.partnerVendorRelationshipsTable)
        .where(
          eq(s.partnerVendorRelationshipsTable.partnerId, f.input.partnerId),
        ),
    ).toHaveLength(0);
  });
  it("reserves capacity across different simultaneous accepted offers", async () => {
    const f = await fixture();
    const draft = await f.api.createJobOffer(f.input, f.actor, randomUUID());
    const other = await f.api.sendJobOffer({
      offerId: draft.id,
      version: draft.version,
      session: f.actor,
    });
    const results = await Promise.allSettled([
      f.api.acceptJobOffer(f.accept),
      f.api.acceptJobOffer({
        ...f.accept,
        offerId: other.id,
        version: other.version,
        idempotencyKey: randomUUID(),
      }),
    ]);
    expect(results.filter((row) => row.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((row) => row.status === "rejected")).toHaveLength(1);
  });
  it.each([
    { firstEnd: "10:00", allowed: true },
    { firstEnd: "10:30", allowed: false },
  ])(
    "persists peak concurrency rather than summed intersecting crews ($firstEnd, allowed=$allowed)",
    async ({ firstEnd, allowed }) => {
      const f = await fixture();
      const prepare = async (start: string, end: string) => {
        const draft = await f.api.createJobOffer(
          {
            ...f.input,
            crewCount: 1,
            requestedStartAt: `2026-11-01T${start}:00Z`,
            requestedEndAt: `2026-11-01T${end}:00Z`,
          },
          f.actor,
          randomUUID(),
        );
        const sent = await f.api.sendJobOffer({
          offerId: draft.id,
          version: draft.version,
          session: f.actor,
        });
        return {
          offerId: sent.id,
          version: sent.version,
          session: f.actor,
          idempotencyKey: randomUUID(),
        };
      };
      const first = await prepare("09:00", firstEnd);
      const second = await prepare("10:00", "11:00");
      const spanning = await prepare("09:00", "11:00");
      await f.api.acceptJobOffer(first);
      await f.api.acceptJobOffer(second);
      if (allowed) {
        const accepted = await f.api.acceptJobOffer(spanning);
        expect(accepted.ticketId).toBeGreaterThan(0);
        expect(
          (await f.api.getJobOffer(spanning.offerId, f.actor)).createdTicketId,
        ).toBe(accepted.ticketId);
      } else {
        await expect(f.api.acceptJobOffer(spanning)).rejects.toThrow(
          "marketplace.capacity_changed",
        );
        expect(
          (await f.api.getJobOffer(spanning.offerId, f.actor)).status,
        ).toBe("offered");
        expect(
          await db
            .select()
            .from(s.ticketsTable)
            .where(eq(s.ticketsTable.jobOfferId, spanning.offerId)),
        ).toHaveLength(0);
      }
    },
  );
  it("checks current partner/vendor membership and rejects a revoked vendor admin session", async () => {
    const f = await fixture();
    async function member(side: "partner" | "vendor") {
      const [user] = await db
        .insert(s.usersTable)
        .values({
          username: randomUUID(),
          passwordHash: "test-only-unusable",
          displayName: "Membership test",
          role: side,
        })
        .returning();
      const [membership] = await db
        .insert(s.userOrgMembershipsTable)
        .values({
          userId: user.id,
          orgType: side,
          role: "admin",
          partnerId: side === "partner" ? f.input.partnerId : null,
          vendorId: side === "vendor" ? f.vendor.id : null,
        })
        .returning();
      await db
        .update(s.usersTable)
        .set({ activeMembershipId: membership.id })
        .where(eq(s.usersTable.id, user.id));
      return {
        role: side,
        userId: user.id,
        sv: user.sessionVersion,
        activeMembershipId: membership.id,
        membershipRole: "admin",
        partnerId: membership.partnerId,
        vendorId: membership.vendorId,
      } as SessionPayload;
    }
    const partner = await member("partner");
    const vendor = await member("vendor");
    expect((await f.api.getJobOffer(f.sent.id, partner)).id).toBe(f.sent.id);
    expect((await f.api.getJobOffer(f.sent.id, vendor)).id).toBe(f.sent.id);
    await db
      .update(s.userOrgMembershipsTable)
      .set({ role: "member" })
      .where(eq(s.userOrgMembershipsTable.id, vendor.activeMembershipId!));
    await expect(
      f.api.acceptJobOffer({ ...f.accept, session: vendor }),
    ).rejects.toThrow("marketplace.vendor_scope_required");
    await db
      .update(s.userOrgMembershipsTable)
      .set({ role: "admin" })
      .where(eq(s.userOrgMembershipsTable.id, vendor.activeMembershipId!));
    const accepted = await f.api.acceptJobOffer({
      ...f.accept,
      session: vendor,
    });
    expect(accepted.ticketId).toBeGreaterThan(0);
  });
});
