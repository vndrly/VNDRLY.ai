import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { FleetComplianceRecordSchema } from "@workspace/api-zod";
import type { ObjectStore } from "../lib/objectStore";
import { getTableName } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";
import { subjectFingerprint } from "../services/service-matching/candidates";
import { backfillMappingEvidence } from "../../scripts/backfill-semantic-service-marketplace";
import {
  createPostgresPartnerMarketplaceStore,
  discoverPartnerMarketplaceVendors,
  marketplaceComplianceSummary,
  marketplaceSafetySummary,
} from "../services/marketplace/partner-store";
import { projectCanonicalFleetComplianceConfigurationScore } from "../services/fleet-compliance-score";

const state = vi.hoisted(() => ({
  reads: [] as { table: string; sql: string; params: unknown[] }[],
  data: {} as Record<string, any[]>,
}));
vi.mock("@workspace/db", () => ({
  db: {
    select: () => {
      let table: any;
      let condition: any;
      const query: any = {
        from(value: any) {
          table = value;
          return query;
        },
        innerJoin() {
          return query;
        },
        leftJoin() {
          return query;
        },
        where(value: any) {
          condition = value;
          return query;
        },
        orderBy() {
          return query;
        },
        then(resolve: any, reject: any) {
          const name = getTableName(table);
          const emitted = new PgDialect().sqlToQuery(condition);
          state.reads.push({
            table: name,
            sql: emitted.sql,
            params: emitted.params,
          });
          // The adapter's emitted equality predicates execute against saved fixtures,
          // so dropping a tenant or vendor predicate exposes the seeded decoy rows.
          let rows = state.data[name] ?? [];
          const clauses = [
            ...emitted.sql.matchAll(/"([^".]+)"\."([^".]+)" = \$(\d+)/g),
          ];
          for (const [, scopedTable, column, param] of clauses) {
            const key = column.replace(/_([a-z])/g, (_m, letter: string) =>
              letter.toUpperCase(),
            );
            rows = rows.filter((row) => {
              const record = row[scopedTable] ?? row;
              return (
                record[key] === undefined ||
                record[key] === emitted.params[Number(param) - 1]
              );
            });
          }
          return Promise.resolve(rows).then(resolve, reject);
        },
      };
      return query;
    },
  },
}));
const now = new Date("2026-10-18T00:00:00Z");
const past = new Date("2026-01-01T00:00:00Z");
const mapping = (subject: any) => ({
  canonicalServiceId: 5,
  status: "active",
  supersededAt: null,
  explanation: "Controlled entry",
  evidence: {
    serviceMatching: { subjectFingerprint: subjectFingerprint(subject) },
  },
});
const workType = {
  id: 21,
  partnerId: 9,
  name: "Gatekeeping",
  description: null,
  category: "Security",
  requiredCertifications: ["H2S"],
  blockingCertifications: [],
};
const capability = {
  id: 7,
  vendorId: 3,
  name: "Gate crews",
  description: null,
  active: true,
  capacity: 2,
};
const demandMapping = mapping({
  ...workType,
  subjectType: "partner_work_type",
  subjectId: 21,
});
const capabilityMapping = mapping({
  ...capability,
  subjectType: "vendor_capability",
  subjectId: 7,
});
const context = {
  partnerId: 9,
  workType,
  site: { id: 8, partnerId: 9, latitude: 35, longitude: -97 },
  demandMapping,
  canonicalServiceActive: true,
  requiredCredentials: ["H2S"],
} as any;
beforeEach(() => {
  state.reads = [];
  state.data = {
    users: [
      {
        id: 2,
        sessionVersion: 1,
        activeMembershipId: 4,
        suspendedAt: null,
        role: "partner",
      },
    ],
    user_org_memberships: [
      {
        id: 4,
        userId: 2,
        orgType: "partner",
        partnerId: 9,
        vendorId: null,
        role: "member",
      },
    ],
    work_types: [workType, { ...workType, id: 22, partnerId: 99 }],
    site_locations: [
      { ...context.site, isActive: true, hidden: false, supersededAt: null },
      { ...context.site, id: 88, partnerId: 99 },
    ],
    service_mappings: [{ mapping: demandMapping, active: true }],
    vendor_partner_service_offers: [
      {
        capability,
        capabilityMapping,
        offer: {
          id: 12,
          vendorCapabilityId: 7,
          partnerId: 9,
          workTypeId: 21,
          unitPrice: "75",
          unit: "hour",
          currency: "USD",
          active: true,
          capacity: 2,
          availability: { available: true },
          effectiveFrom: past,
          effectiveUntil: null,
          commercialConditions: null,
        },
        vendor: {
          id: 3,
          name: "MidCon",
          fleetComplianceConfiguration: {
            version: 1,
            reviewerUserIds: [],
            entries: [],
            requirements: [],
            facts: [],
            scoreHistory: [{ at: now.toISOString(), score: 85 }],
            partnerScorePreview: {
              score: 85,
              status: "green",
              advisoryOnly: true,
              evaluatedAt: now.toISOString(),
              categories: [],
              reasons: [],
            },
          },
          federalTaxId: "verified",
          coiDocumentUrl: "private",
          insuranceExpirationDate: "2027-01-01",
          w9DocumentUrl: "private",
          wcDocumentUrl: "private",
          wcExpirationDate: "2027-01-01",
          glDocumentUrl: "private",
          glExpirationDate: "2027-01-01",
          autoLiabilityDocumentUrl: "private",
          autoLiabilityExpirationDate: "2027-01-01",
        },
      },
    ],
    vendor_service_areas: [
      {
        vendorId: 3,
        vendorCapabilityId: null,
        latitude: 35,
        longitude: -97,
        radiusMiles: "100",
        active: true,
        verifiedAt: past,
        effectiveFrom: past,
        effectiveUntil: null,
      },
    ],
    vendor_people: [1, 2].map((id) => ({
      id,
      vendorId: 3,
      isActive: true,
      deletedAt: null,
      name: "H2S",
      expiry: "2027-01-01",
      verifiedAt: past,
    })),
    tickets: [
      {
        ticket: {
          id: 10,
          vendorId: 3,
          workTypeId: 21,
          status: "approved",
          lifecycleState: "off_site",
          scheduledStartAt: past,
          checkInTime: past,
        },
        site_locations: { partnerId: 9 },
      },
    ],
    vendor_ratings: [
      { rating: 4, vendorId: 3, partnerId: 9 },
      { rating: 1, vendorId: 4, partnerId: 9 },
      { rating: 1, vendorId: 3, partnerId: 99 },
    ],
    safety_events: [
      {
        vendorId: 3,
        partnerId: 9,
        status: "submitted",
        recordable: true,
        hipo: false,
        type: "injury",
        createdAt: now,
        updatedAt: now,
      },
      {
        vendorId: 4,
        partnerId: 9,
        status: "submitted",
        recordable: true,
        hipo: false,
        type: "injury",
        createdAt: now,
        updatedAt: now,
      },
      {
        vendorId: 3,
        partnerId: 99,
        status: "submitted",
        recordable: true,
        hipo: false,
        type: "injury",
        createdAt: now,
        updatedAt: now,
      },
    ],
    partner_vendor_relationships: [],
  };
});
describe("partner marketplace persistence boundary", () => {
  it("discovers backfill-projected demand and capability using their runtime fingerprints", async () => {
    const demand = { ...demandMapping, evidence: backfillMappingEvidence({ ...workType, subjectType: "partner_work_type", subjectId: workType.id }, { workTypeId: workType.id }) };
    state.data.vendor_partner_service_offers[0].capabilityMapping = {
      ...capabilityMapping,
      evidence: backfillMappingEvidence({ ...capability, subjectType: "vendor_capability", subjectId: capability.id }, { sourceVendorWorkTypeId: 10 }),
    };
    const discover = () => discoverPartnerMarketplaceVendors(createPostgresPartnerMarketplaceStore(), { ...context, demandMapping: demand }, { requestedCapacity: 1 }, now);
    expect((await discover())[0]?.offerable).toBe(true);
    state.data.vendor_partner_service_offers[0].capability = { ...capability, name: "Gate actuator repairs" };
    expect(await discover()).toEqual([]);
  });
  it.each(["revoked", "rejected", "suspended"])("blocks explicit %s relationships without requiring a prior relationship", async (status) => {
    const discover = () => discoverPartnerMarketplaceVendors(createPostgresPartnerMarketplaceStore(), context, { requestedCapacity: 1 }, now);
    expect((await discover())[0].offerable).toBe(true);
    state.data.partner_vendor_relationships = [{ vendorId: 3, partnerId: 9, status }];
    expect((await discover())[0]).toMatchObject({ offerable: false, eligibility: { reasonCodes: ["RELATIONSHIP_RESTRICTED"] } });
    // Existing partner status action deliberately reopens the relationship.
    state.data.partner_vendor_relationships[0].status = "pending_review";
    expect((await discover())[0].offerable).toBe(true);
  });
  it("fails closed after source-address retirement of both default and override coverage", async () => {
    state.data.vendor_service_areas.push({ ...state.data.vendor_service_areas[0], vendorCapabilityId: 7 });
    for (const area of state.data.vendor_service_areas) { area.active = false; area.effectiveUntil = now; }
    const rows = await discoverPartnerMarketplaceVendors(createPostgresPartnerMarketplaceStore(), context, { requestedCapacity: 1 }, now);
    expect(rows[0]).toMatchObject({ offerable: false, eligibility: { reasonCodes: ["SERVICE_AREA_MISSING"] } });
  });
  it("rechecks live membership and owns both context records", async () => {
    const store = createPostgresPartnerMarketplaceStore();
    const session = {
      userId: 2,
      sv: 1,
      role: "partner",
      partnerId: 9,
      activeMembershipId: 4,
    } as any;
    expect(await store.authorize(session, 9)).toBe(true);
    state.data.users[0].activeMembershipId = 44;
    expect(await store.authorize(session, 9)).toBe(false);
    expect(await store.loadContext(9, 22, 8)).toBeNull();
    expect(await store.loadContext(9, 21, 88)).toBeNull();
    expect((await store.loadContext(9, 21, 8))?.requiredCredentials).toEqual([
      "H2S",
    ]);
  });
  it("offers immediately without a prior relationship while using only this partner/vendor evidence", async () => {
    const rows = await discoverPartnerMarketplaceVendors(
      createPostgresPartnerMarketplaceStore(),
      context,
      { requestedCapacity: 2 },
      now,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      offerable: true,
      relationshipStatus: null,
      rating: 4,
      reviewCount: 1,
      safety: { score: 85 },
      completedJobs: 1,
      onTimeRate: 1,
      priorPartnerJobs: 1,
    });
    for (const table of ["vendor_ratings", "partner_vendor_relationships"]) {
      const query = state.reads.find((row) => row.table === table)!;
      expect(query.params).toContain(9);
      expect(query.params).toContain(3);
    }
    expect(state.reads.some((row) => row.table === "safety_events")).toBe(false);
    const ratingQuery = state.reads.find(
      (row) => row.table === "vendor_ratings",
    )!;
    expect(ratingQuery.sql).toContain('"tickets"."lifecycle_state"');
    expect(ratingQuery.params).toContain("off_site");
    expect(ratingQuery.sql).toContain('"site_locations"."partner_id"');
  });
  it("requires the complete credential set on each qualifying worker and current document dates", async () => {
    state.data.vendor_people[1].expiry = "2026-01-01";
    state.data.vendor_partner_service_offers[0].vendor.glExpirationDate =
      "2026-02-30";
    const rows = await discoverPartnerMarketplaceVendors(
      createPostgresPartnerMarketplaceStore(),
      context,
      { requestedCapacity: 2 },
      now,
    );
    expect(rows[0]).toMatchObject({
      offerable: false,
      complianceCurrent: false,
      eligibility: {
        reasonCodes: ["COMPLIANCE_STALE", "INSUFFICIENT_CAPACITY"],
        facts: { availableCapacity: 1 },
      },
    });
  });
  it("does not present absent evidence as a perfect safety score or zero rating", async () => {
    state.data.safety_events = [];
    state.data.vendor_ratings = [];
    state.data.tickets = [];
    state.data.vendor_partner_service_offers[0].vendor.fleetComplianceConfiguration = null;
    const [row] = await discoverPartnerMarketplaceVendors(
      createPostgresPartnerMarketplaceStore(),
      context,
      { requestedCapacity: 1 },
      now,
    );
    expect(row).toMatchObject({
      rating: null,
      safety: null,
      onTimeRate: null,
      reviewCount: 0,
      ratingStatus: "not_yet_rated",
      safetyStatus: "not_yet_rated",
    });
  });
  it("uses the full canonical evaluator for Partner scores without a vendor page visit", async () => {
    const secret = "marketplace-compliance-test-secret";
    const record = FleetComplianceRecordSchema.parse({
      evidence: { id: "11111111-1111-4111-8111-111111111111", revision: 2, subject: { kind: "carrier", id: 3 }, requirementId: "insurance", requirementVersion: 1, status: "verified", validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-10-19T00:00:00.000Z", verifiedAt: "2026-01-01T00:00:00.000Z", verifiedByUserId: 7, source: "private", privateDocumentRef: null, restrictions: {} },
      attributes: { kind: "insurance", coverage: { id: "11111111-1111-4111-8111-111111111111", revision: 2, policyNumber: "PRIVATE", insuredLegalEntity: "PRIVATE", privateDocumentRef: null, coverageType: "auto_liability", state: "verified", reviewedByUserId: 7, reviewedAt: "2026-01-01T00:00:00.000Z", validFrom: "2026-01-01T00:00:00.000Z", validUntil: "2027-10-19T00:00:00.000Z", carrierIds: [3], states: ["OK"], cargoCodes: null, equipmentIds: null, scopesReviewed: false, limitUSD: "750000", filingStatus: "unverified", filingVerifiedAt: null, underlyingPolicyId: null, attachmentPointUSD: null, followFormReviewed: false } },
      retentionClass: "insurance", retainUntil: null, legalHold: false,
    });
    const digest = createHmac("sha256", secret).update(JSON.stringify(record)).digest("hex");
    const objectPath = `/objects/fleet-compliance-private/3/${record.evidence.id}/2/${digest}`;
    const store = { getObject: async (path: string) => path === objectPath ? { body: Buffer.from(JSON.stringify(record)), acl: { owner: "fleet-compliance:3", visibility: "private", purpose: "fleet-compliance-private" } } : null } as unknown as ObjectStore;
    const configuration = {
      version: 2,
      reviewerUserIds: [],
      requirements: [],
      facts: [],
      scoreHistory: [{ at: "2026-10-01T00:00:00.000Z", score: 85 }],
      entries: [{
        id: "11111111-1111-4111-8111-111111111111",
        revision: 2,
        subject: { kind: "carrier", id: 3 },
        requirementId: "insurance",
        requirementVersion: 1,
        status: "verified",
        validFrom: "2026-01-01T00:00:00.000Z",
        validUntil: "2027-10-19T00:00:00.000Z",
        verifiedAt: "2026-01-01T00:00:00.000Z",
        verifiedByUserId: 7,
        attributeKind: "insurance",
        objectPath,
        updatedAt: "2026-10-19T00:00:00.000Z",
      }],
      partnerScorePreview: {
        score: 85,
        status: "green",
        advisoryOnly: true,
        evaluatedAt: "2026-10-01T00:00:00.000Z",
        categories: [],
        reasons: [],
      },
    };
    const vendorProjection = await projectCanonicalFleetComplianceConfigurationScore(3, configuration, "2026-10-20T00:00:00.000Z", { store, secret });
    await expect(marketplaceComplianceSummary(configuration, 3, new Date("2026-10-20T00:00:00.000Z"), { store, secret })).resolves.toMatchObject({
      score: expect.any(Number),
      refreshedAt: "2026-10-20T00:00:00.000Z",
      reasons: expect.arrayContaining(["requires_review"]),
    });
    const partnerProjection = await marketplaceComplianceSummary(configuration, 3, new Date("2026-10-20T00:00:00.000Z"), { store, secret });
    expect(partnerProjection!.score).toBeLessThan(85);
    expect(partnerProjection).toMatchObject({ score: vendorProjection.score, reasons: vendorProjection.partnerPreview!.reasons.map((item) => item.reasonCode) });
    record.evidence.validUntil = "2026-10-19T00:00:00.000Z";
    if (record.attributes.kind === "insurance") record.attributes.coverage.validUntil = record.evidence.validUntil;
    configuration.entries[0].validUntil = record.evidence.validUntil;
    const expiredDigest = createHmac("sha256", secret).update(JSON.stringify(record)).digest("hex");
    configuration.entries[0].objectPath = `/objects/fleet-compliance-private/3/${record.evidence.id}/2/${expiredDigest}`;
    const expiredStore = { getObject: async () => ({ body: Buffer.from(JSON.stringify(record)), acl: { owner: "fleet-compliance:3", visibility: "private", purpose: "fleet-compliance-private" } }) } as unknown as ObjectStore;
    await expect(marketplaceComplianceSummary(configuration, 3, new Date("2026-10-20T00:00:00.000Z"), { store: expiredStore, secret })).resolves.toMatchObject({ reasons: expect.arrayContaining(["expired_record"]) });
  });
  it("uses the saved safety source refresh date and caps the existing event formula", () => {
    expect(marketplaceSafetySummary([], now)).toBeNull();
    expect(
      marketplaceSafetySummary(
        Array.from({ length: 8 }, () => ({
          status: "submitted",
          recordable: true,
          hipo: false,
          type: "injury",
          createdAt: now,
          updatedAt: now,
        })),
        now,
      ),
    ).toMatchObject({ score: 0, refreshedAt: "2026-10-18T00:00:00.000Z" });
  });
  it("projects the exact saved VNDRLY Partner preview without private evidence", async () => {
    await expect(marketplaceComplianceSummary(null)).resolves.toBeNull();
    await expect(marketplaceComplianceSummary({ version: 1, reviewerUserIds: [], entries: [], partnerScorePreview: { score: 58, status: "red", advisoryOnly: true, evaluatedAt: "2026-10-20T12:00:00.000Z", categories: [{ category: "vehicle", score: 60 }], reasons: [{ category: "driver_license", reason: "private wording is not rendered", reasonCode: "expired_record" }] } })).resolves.toEqual({ score: 58, source: "VNDRLY compliance score", refreshedAt: "2026-10-20T12:00:00.000Z", reasons: ["expired_record"] });
  });
});
