import { and, asc, desc, eq, isNull, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  vendorCapabilitiesTable as capabilities,
  vendorServiceAreasTable as areas,
  vendorPartnerServiceOffersTable as offers,
  serviceMappingsTable as mappings,
  canonicalServicesTable as services,
  vendorsTable as vendors,
  partnersTable as partners,
  workTypesTable as workTypes,
  usersTable as users,
  userOrgMembershipsTable as memberships,
  siteLocationsTable as sites,
  workTypeSiteLocationsTable as workSites,
  employeeCertificationsTable as certifications,
  vendorPeopleTable as people,
  type VendorCapability,
  type VendorServiceArea,
  type VendorPartnerServiceOffer,
  type WorkType,
} from "@workspace/db/schema";
import type { SessionPayload } from "../../lib/session";
import { missingVendorApprovalFields } from "../../lib/vendor-approval-readiness";
import { validCoordinates } from "./distance";
import {
  activeServiceMatch,
  mappingMatchesSavedSubject,
  evaluateMarketplaceEligibility,
  type EligibilityMapping,
  type EligibilityResult,
} from "./eligibility";

export class MarketplaceError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export type CapabilityInput = Pick<
  VendorCapability,
  | "name"
  | "description"
  | "defaultUnit"
  | "defaultRateCard"
  | "capacity"
  | "qualifications"
  | "evidence"
  | "active"
>;
export type MarketplaceCapability = VendorCapability & {
  mapping?: {
    canonicalServiceId: number | null;
    canonicalServiceName: string | null;
    status: string;
    explanation: string;
    confidence: number;
  } | null;
};
export type AreaInput = {
  vendorCapabilityId: number | null;
  radiusMiles: number;
};
export type RateInput = Pick<
  VendorPartnerServiceOffer,
  | "vendorCapabilityId"
  | "workTypeId"
  | "unit"
  | "currency"
  | "notes"
  | "commercialConditions"
  | "rateComponents"
  | "availability"
  | "capacity"
  | "active"
> & { unitPrice: number };
export interface RateTarget {
  partnerId: number;
  capabilityMapping: EligibilityMapping | null;
  demandMapping: EligibilityMapping | null;
  canonicalServiceActive: boolean;
}
export interface MarketplaceDemand {
  partnerId: number;
  partnerName: string;
  workTypeId: number;
  name: string;
  category: string;
  description: string | null;
  requiredCertifications: string[];
  locations: { state: string | null; approximateSiteCount: number }[];
  approximateDemand: number;
  capabilityId: number;
  ownOffer: VendorPartnerServiceOffer | null;
  eligibility: EligibilityResult;
}
export interface VendorMarketplaceStore {
  authorize(session: SessionPayload, vendorId: number): Promise<boolean>;
  listCapabilities(vendorId: number): Promise<MarketplaceCapability[]>;
  getCapability(
    vendorId: number,
    id: number,
  ): Promise<MarketplaceCapability | null>;
  saveCapability(
    vendorId: number,
    id: number | null,
    body: Partial<CapabilityInput>,
    actor: number,
  ): Promise<VendorCapability>;
  listAreas(vendorId: number): Promise<VendorServiceArea[]>;
  countMatchingDemand(canonicalServiceId: number): Promise<number | null>;
  clearAreaOverride(
    vendorId: number,
    capabilityId: number,
    actor: number,
  ): Promise<void>;
  saveArea(
    vendorId: number,
    body: AreaInput,
    actor: number,
  ): Promise<VendorServiceArea>;
  listRates(vendorId: number): Promise<VendorPartnerServiceOffer[]>;
  getRateTarget(
    vendorId: number,
    capabilityId: number,
    workTypeId: number,
  ): Promise<RateTarget | null>;
  saveRate(
    vendorId: number,
    body: RateInput,
    actor: number,
  ): Promise<VendorPartnerServiceOffer>;
  listDemand(
    vendorId: number,
    limit: number,
    offset: number,
  ): Promise<MarketplaceDemand[]>;
}

const currentMapping = (table: typeof mappings) =>
  and(eq(table.status, "active"), isNull(table.supersededAt));
const bucket = (count: number) => Math.ceil(count / 10) * 10;
const capabilitySubject = (row: VendorCapability) => ({
  subjectType: "vendor_capability" as const,
  subjectId: row.id,
  name: row.name,
  description: row.description,
});
const workTypeSubject = (row: WorkType) => ({
  subjectType: "partner_work_type" as const,
  subjectId: row.id,
  name: row.name,
  description: row.description,
  category: row.category,
});

/** Lazy access: constructing routers never opens a database connection. All queries carry explicit vendor scope. */
export function createPostgresVendorMarketplaceStore(): VendorMarketplaceStore {
  const database = async () => (await import("@workspace/db")).db;
  const withMapping = async (
    capability: VendorCapability,
  ): Promise<MarketplaceCapability> => {
    const rows = await (
      await database()
    )
      .select({ mapping: mappings, service: services })
      .from(mappings)
      .leftJoin(services, eq(services.id, mappings.canonicalServiceId))
      .where(
        and(
          eq(mappings.subjectType, "vendor_capability"),
          eq(mappings.subjectId, capability.id),
        ),
      )
      .orderBy(desc(mappings.mappingVersion));
    const current =
      rows.find(
        (row) =>
          row.mapping.status === "active" && row.mapping.supersededAt === null,
      ) ?? rows[0];
    return {
      ...capability,
      mapping: current
        ? {
            canonicalServiceId: current.mapping.canonicalServiceId,
            canonicalServiceName: current.service?.name ?? null,
            status:
              current.mapping.status === "active" &&
              (!current.service?.active ||
                !mappingMatchesSavedSubject(
                  current.mapping,
                  capabilitySubject(capability),
                ))
                ? "review_required"
                : current.mapping.status,
            explanation: current.mapping.explanation,
            confidence: Number(current.mapping.confidence),
          }
        : null,
    };
  };
  const store: VendorMarketplaceStore = {
    async authorize(session, vendorId) {
      const db = await database();
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, session.userId!));
      if (!user || user.suspendedAt || user.sessionVersion !== session.sv)
        return false;
      const [vendor] = await db
        .select({ id: vendors.id })
        .from(vendors)
        .where(eq(vendors.id, vendorId));
      if (!vendor) return false;
      if (session.role === "admin") return user.role === "admin";
      const [membership] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.id, session.activeMembershipId!),
            eq(memberships.userId, user.id),
            eq(memberships.orgType, "vendor"),
            eq(memberships.vendorId, vendorId),
            eq(memberships.role, "admin"),
          ),
        );
      return !!membership && user.activeMembershipId === membership.id;
    },
    async listCapabilities(vendorId) {
      const rows = await (await database())
        .select()
        .from(capabilities)
        .where(eq(capabilities.vendorId, vendorId))
        .orderBy(asc(capabilities.id));
      return Promise.all(rows.map(withMapping));
    },
    async getCapability(vendorId, id) {
      const [row] = await (
        await database()
      )
        .select()
        .from(capabilities)
        .where(
          and(eq(capabilities.vendorId, vendorId), eq(capabilities.id, id)),
        );
      return row ? withMapping(row) : null;
    },
    async saveCapability(vendorId, id, body, actor) {
      return (await database()).transaction(async (tx) => {
        if (id === null) {
          const [row] = await tx
            .insert(capabilities)
            .values({ ...body, name: body.name!, vendorId, createdById: actor })
            .returning();
          return row;
        }
        // Same subject lock as classification/review: an edited description cannot retain an old active commercial match.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`service-mapping:vendor_capability:${id}`}, 0))`,
        );
        const [old] = await tx
          .select()
          .from(capabilities)
          .where(
            and(eq(capabilities.id, id), eq(capabilities.vendorId, vendorId)),
          )
          .for("update");
        if (!old)
          throw new MarketplaceError(404, "marketplace.capability_not_found");
        if (
          (body.name !== undefined && body.name !== old.name) ||
          (body.description !== undefined &&
            body.description !== old.description)
        ) {
          await tx
            .update(mappings)
            .set({ status: "superseded", supersededAt: new Date() })
            .where(
              and(
                eq(mappings.subjectType, "vendor_capability"),
                eq(mappings.subjectId, id),
                currentMapping(mappings),
              ),
            );
        }
        const [row] = await tx
          .update(capabilities)
          .set({ ...body, updatedAt: new Date() })
          .where(
            and(eq(capabilities.id, id), eq(capabilities.vendorId, vendorId)),
          )
          .returning();
        return row;
      });
    },
    async countMatchingDemand(canonicalServiceId) {
      const db = await database();
      const [concept] = await db
        .select({ active: services.active })
        .from(services)
        .where(eq(services.id, canonicalServiceId));
      if (!concept?.active) return null;
      const ids = new Set<number>();
      let offset = 0;
      while (true) {
        const batch = await db
          .select({ workType: workTypes, mapping: mappings })
          .from(workTypes)
          .innerJoin(
            mappings,
            and(
              eq(mappings.workTypeId, workTypes.id),
              eq(mappings.subjectType, "partner_work_type"),
              eq(mappings.canonicalServiceId, canonicalServiceId),
              currentMapping(mappings),
            ),
          )
          .innerJoin(partners, eq(partners.id, workTypes.partnerId))
          .orderBy(asc(workTypes.id))
          .limit(100)
          .offset(offset);
        for (const row of batch)
          if (
            mappingMatchesSavedSubject(
              row.mapping,
              workTypeSubject(row.workType),
            )
          )
            ids.add(row.workType.id);
        if (batch.length < 100) break;
        offset += batch.length;
      }
      return ids.size;
    },
    async listAreas(vendorId) {
      return (await database())
        .select()
        .from(areas)
        .where(eq(areas.vendorId, vendorId))
        .orderBy(asc(areas.id));
    },
    async clearAreaOverride(vendorId, capabilityId) {
      await (
        await database()
      ).transaction(async (tx) => {
        // Use the same lock as saves, preserving history and serializing reset vs override replacement.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`marketplace-area:${vendorId}`}, 0))`,
        );
        const [capability] = await tx
          .select({ id: capabilities.id })
          .from(capabilities)
          .where(
            and(
              eq(capabilities.vendorId, vendorId),
              eq(capabilities.id, capabilityId),
            ),
          )
          .for("share");
        if (!capability)
          throw new MarketplaceError(404, "marketplace.capability_not_found");
        const now = new Date();
        await tx
          .update(areas)
          .set({ active: false, effectiveUntil: now, updatedAt: now })
          .where(
            and(
              eq(areas.vendorId, vendorId),
              eq(areas.vendorCapabilityId, capabilityId),
              eq(areas.active, true),
            ),
          );
      });
    },
    async saveArea(vendorId, body) {
      return (await database()).transaction(async (tx) => {
        // Serializes replacement of default/override rows, including concurrent first writes.
        await tx.execute(
          sql`select pg_advisory_xact_lock(hashtextextended(${`marketplace-area:${vendorId}`}, 0))`,
        );
        const [vendor] = await tx
          .select()
          .from(vendors)
          .where(eq(vendors.id, vendorId))
          .for("share");
        if (
          !vendor ||
          !vendor.geocodedAt ||
          vendor.geocodedAt > new Date() ||
          !validCoordinates({
            latitude: vendor.latitude!,
            longitude: vendor.longitude!,
          }) ||
          !vendor.physicalAddress?.trim()
        )
          throw new MarketplaceError(
            409,
            "marketplace.verified_service_base_required",
          );
        if (body.vendorCapabilityId !== null) {
          const [capability] = await tx
            .select({ id: capabilities.id })
            .from(capabilities)
            .where(
              and(
                eq(capabilities.vendorId, vendorId),
                eq(capabilities.id, body.vendorCapabilityId),
              ),
            )
            .for("share");
          if (!capability)
            throw new MarketplaceError(404, "marketplace.capability_not_found");
        }
        const now = new Date();
        await tx
          .update(areas)
          .set({ active: false, effectiveUntil: now, updatedAt: now })
          .where(
            and(
              eq(areas.vendorId, vendorId),
              body.vendorCapabilityId === null
                ? isNull(areas.vendorCapabilityId)
                : eq(areas.vendorCapabilityId, body.vendorCapabilityId),
              eq(areas.active, true),
            ),
          );
        const [row] = await tx
          .insert(areas)
          .values({
            vendorId,
            vendorCapabilityId: body.vendorCapabilityId,
            radiusMiles: String(body.radiusMiles),
            address: vendor.physicalAddress,
            latitude: vendor.latitude!,
            longitude: vendor.longitude!,
            coordinateProvenance: "saved_vendor_geocoded_base",
            verifiedAt: vendor.geocodedAt,
            effectiveFrom: now,
          })
          .returning();
        return row;
      });
    },
    async listRates(vendorId) {
      const rows = await (await database())
        .select({ offer: offers })
        .from(offers)
        .innerJoin(capabilities, eq(offers.vendorCapabilityId, capabilities.id))
        .where(eq(capabilities.vendorId, vendorId))
        .orderBy(asc(offers.id));
      return rows.map((row) => row.offer);
    },
    async getRateTarget(vendorId, capabilityId, workTypeId) {
      const db = await database();
      const demandMapping = alias(mappings, "demand_mapping");
      const [row] = await db
        .select({
          partnerId: workTypes.partnerId,
          capability: capabilities,
          workType: workTypes,
          capabilityMapping: mappings,
          demandMapping,
          canonicalServiceActive: services.active,
        })
        .from(capabilities)
        .innerJoin(
          mappings,
          and(
            eq(mappings.vendorCapabilityId, capabilities.id),
            currentMapping(mappings),
          ),
        )
        .innerJoin(services, eq(mappings.canonicalServiceId, services.id))
        .innerJoin(
          demandMapping,
          and(
            eq(demandMapping.canonicalServiceId, services.id),
            eq(demandMapping.status, "active"),
            isNull(demandMapping.supersededAt),
          ),
        )
        .innerJoin(
          workTypes,
          and(
            eq(demandMapping.workTypeId, workTypes.id),
            eq(workTypes.id, workTypeId),
          ),
        )
        .where(
          and(
            eq(capabilities.vendorId, vendorId),
            eq(capabilities.id, capabilityId),
            eq(capabilities.active, true),
          ),
        );
      return row?.partnerId &&
        mappingMatchesSavedSubject(
          row.capabilityMapping,
          capabilitySubject(row.capability),
        ) &&
        mappingMatchesSavedSubject(
          row.demandMapping,
          workTypeSubject(row.workType),
        )
        ? {
            partnerId: row.partnerId,
            capabilityMapping: row.capabilityMapping,
            demandMapping: row.demandMapping,
            canonicalServiceActive: row.canonicalServiceActive,
          }
        : null;
    },
    async saveRate(vendorId, body, actor) {
      return (await database()).transaction(async (tx) => {
        // Recheck both mappings under their common classification/review locks at the mutation boundary.
        for (const key of [
          `service-mapping:partner_work_type:${body.workTypeId}`,
          `service-mapping:vendor_capability:${body.vendorCapabilityId}`,
        ].sort())
          await tx.execute(
            sql`select pg_advisory_xact_lock(hashtextextended(${key}, 0))`,
          );
        const [capability] = await tx
          .select()
          .from(capabilities)
          .where(
            and(
              eq(capabilities.vendorId, vendorId),
              eq(capabilities.id, body.vendorCapabilityId),
            ),
          )
          .for("share");
        const [workType] = await tx
          .select()
          .from(workTypes)
          .where(eq(workTypes.id, body.workTypeId))
          .for("share");
        const [capMap] = await tx
          .select()
          .from(mappings)
          .where(
            and(
              eq(mappings.vendorCapabilityId, body.vendorCapabilityId),
              currentMapping(mappings),
            ),
          );
        const [demandMap] = await tx
          .select()
          .from(mappings)
          .where(
            and(
              eq(mappings.workTypeId, body.workTypeId),
              currentMapping(mappings),
            ),
          );
        const [concept] = capMap?.canonicalServiceId
          ? await tx
              .select()
              .from(services)
              .where(eq(services.id, capMap.canonicalServiceId))
              .for("share")
          : [];
        if (
          !capability?.active ||
          !workType?.partnerId ||
          !mappingMatchesSavedSubject(capMap, capabilitySubject(capability)) ||
          !mappingMatchesSavedSubject(demandMap, workTypeSubject(workType)) ||
          !activeServiceMatch(
            capMap ?? null,
            demandMap ?? null,
            concept?.active === true,
          )
        )
          throw new MarketplaceError(409, "marketplace.active_match_required");
        const now = new Date();
        const [row] = await tx
          .insert(offers)
          .values({
            ...body,
            unitPrice: String(body.unitPrice),
            partnerId: workType.partnerId,
            createdById: actor,
            updatedById: actor,
            effectiveFrom: now,
            effectiveUntil: null,
          })
          .onConflictDoUpdate({
            target: [
              offers.vendorCapabilityId,
              offers.partnerId,
              offers.workTypeId,
            ],
            set: {
              ...body,
              unitPrice: String(body.unitPrice),
              updatedById: actor,
              version: sql`${offers.version} + 1`,
              updatedAt: now,
              effectiveFrom: now,
              effectiveUntil: null,
            },
          })
          .returning();
        return row;
      });
    },
    async listDemand(vendorId, limit, offset) {
      const db = await database();
      const [vendor] = await db
        .select()
        .from(vendors)
        .where(eq(vendors.id, vendorId));
      if (!vendor) return [];
      const demandMapping = alias(mappings, "demand_mapping");
      const loadMatchBatch = (scanOffset: number) =>
        db
          .select({
            capability: capabilities,
            capabilityMapping: mappings,
            demandMapping,
            workType: workTypes,
            partnerName: partners.name,
          })
          .from(capabilities)
          .innerJoin(
            mappings,
            and(
              eq(mappings.vendorCapabilityId, capabilities.id),
              currentMapping(mappings),
            ),
          )
          .innerJoin(
            services,
            and(
              eq(services.id, mappings.canonicalServiceId),
              eq(services.active, true),
            ),
          )
          .innerJoin(
            demandMapping,
            and(
              eq(demandMapping.canonicalServiceId, services.id),
              eq(demandMapping.status, "active"),
              isNull(demandMapping.supersededAt),
            ),
          )
          .innerJoin(workTypes, eq(workTypes.id, demandMapping.workTypeId))
          .innerJoin(partners, eq(partners.id, workTypes.partnerId))
          .where(
            and(
              eq(capabilities.vendorId, vendorId),
              eq(capabilities.active, true),
            ),
          )
          .orderBy(asc(partners.id), asc(workTypes.id), asc(capabilities.id))
          .limit(100)
          .offset(scanOffset);
      const matches: Awaited<ReturnType<typeof loadMatchBatch>> = [];
      let validSeen = 0;
      let scanOffset = 0;
      // Page the validated catalog, not the raw join: stale snapshots cannot
      // consume a page slot or make an empty page hide later valid demand.
      while (matches.length < limit) {
        const batch = await loadMatchBatch(scanOffset);
        for (const match of batch) {
          if (
            !mappingMatchesSavedSubject(
              match.capabilityMapping,
              capabilitySubject(match.capability),
            ) ||
            !mappingMatchesSavedSubject(
              match.demandMapping,
              workTypeSubject(match.workType),
            )
          )
            continue;
          if (validSeen++ >= offset) matches.push(match);
          if (matches.length === limit) break;
        }
        if (batch.length < 100) break;
        scanOffset += batch.length;
      }
      const serviceAreas = await store.listAreas(vendorId);
      const ownOffers = await store.listRates(vendorId);
      const workerCerts = await db
        .select({
          worker: people.id,
          name: certifications.name,
          expirationDate: certifications.expirationDate,
          verifiedAt: certifications.vendorVerifiedAt,
        })
        .from(people)
        .innerJoin(certifications, eq(certifications.employeeId, people.id))
        .where(
          and(
            eq(people.vendorId, vendorId),
            eq(people.isActive, true),
            isNull(people.deletedAt),
            isNull(certifications.deletedAt),
          ),
        );
      const now = new Date();
      const today = now.toISOString().slice(0, 10);
      const validDate = (value: string | null) =>
        !!value &&
        /^\d{4}-\d{2}-\d{2}$/.test(value) &&
        Number.isFinite(new Date(value).getTime()) &&
        new Date(value).toISOString().slice(0, 10) === value &&
        value >= today;
      const complianceCurrent =
        missingVendorApprovalFields(vendor, now).length === 0 &&
        !!vendor.w9DocumentUrl &&
        [
          [vendor.wcDocumentUrl, vendor.wcExpirationDate],
          [vendor.glDocumentUrl, vendor.glExpirationDate],
          [vendor.autoLiabilityDocumentUrl, vendor.autoLiabilityExpirationDate],
        ].every(([url, expiry]) => !!url && validDate(expiry));
      return Promise.all(
        matches.map(async (match) => {
          const required = [
            ...new Set([
              ...(match.workType.requiredCertifications ?? []),
              ...(match.workType.blockingCertifications ?? []),
            ]),
          ];
          const byWorker = new Map<number, Set<string>>();
          for (const cert of workerCerts)
            if (
              cert.verifiedAt &&
              cert.verifiedAt <= now &&
              (!cert.expirationDate || validDate(cert.expirationDate))
            ) {
              const names = byWorker.get(cert.worker) ?? new Set<string>();
              names.add(cert.name.trim().toLowerCase());
              byWorker.set(cert.worker, names);
            }
          const qualified = [...byWorker.values()].some((names) =>
            required.every((name) => names.has(name.trim().toLowerCase())),
          );
          const locations = await db
            .select({ site: sites })
            .from(workSites)
            .innerJoin(sites, eq(sites.id, workSites.siteLocationId))
            .where(
              and(
                eq(workSites.workTypeId, match.workType.id),
                eq(sites.partnerId, match.workType.partnerId!),
                eq(sites.isActive, true),
                eq(sites.hidden, false),
                isNull(sites.supersededAt),
              ),
            );
          const ownOffer =
            ownOffers.find(
              (offer) =>
                offer.vendorCapabilityId === match.capability.id &&
                offer.workTypeId === match.workType.id &&
                offer.partnerId === match.workType.partnerId,
            ) ?? null;
          const results = await Promise.all(
            (locations.length ? locations.map((x) => x.site) : [null]).map(
              (site) =>
                evaluateMarketplaceEligibility({
                  vendorId,
                  partnerId: match.workType.partnerId!,
                  workTypeId: match.workType.id,
                  authorized: true,
                  companyActive: true,
                  capability: match.capability,
                  capabilityMapping: match.capabilityMapping,
                  demandMapping: match.demandMapping,
                  canonicalServiceActive: true,
                  offer: ownOffer,
                  serviceAreas,
                  site,
                  complianceCurrent,
                  requiredCredentials: required,
                  currentCredentials: qualified ? required : [],
                  requestedCapacity: 1,
                  available: ownOffer?.availability?.available !== false,
                  now,
                }),
            ),
          );
          results.sort(
            (a, b) =>
              Number(b.eligible) - Number(a.eligible) ||
              (a.facts.distanceMiles ?? Infinity) -
                (b.facts.distanceMiles ?? Infinity),
          );
          const counts = new Map<string | null, number>();
          for (const { site } of locations)
            counts.set(site.state, (counts.get(site.state) ?? 0) + 1);
          return {
            partnerId: match.workType.partnerId!,
            partnerName: match.partnerName,
            workTypeId: match.workType.id,
            name: match.workType.name,
            category: match.workType.category,
            description: match.workType.description,
            requiredCertifications: required,
            locations: [...counts].map(([state, count]) => ({
              state,
              approximateSiteCount: bucket(count),
            })),
            approximateDemand: bucket(locations.length),
            capabilityId: match.capability.id,
            ownOffer,
            eligibility: results[0],
          };
        }),
      );
    },
  };
  return store;
}
