import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  workTypesTable as workTypes,
  siteLocationsTable as sites,
  serviceMappingsTable as mappings,
  canonicalServicesTable as services,
  vendorCapabilitiesTable as capabilities,
  vendorPartnerServiceOffersTable as offers,
  vendorsTable as vendors,
  vendorServiceAreasTable as areas,
  usersTable as users,
  userOrgMembershipsTable as memberships,
  vendorPeopleTable as people,
  employeeCertificationsTable as certifications,
  ticketsTable as tickets,
  vendorRatingsTable as ratings,
  partnerVendorRelationshipsTable as relationships,
  type WorkType,
  type SiteLocation,
  type ServiceMapping,
  type VendorCapability,
  type VendorPartnerServiceOffer,
} from "@workspace/db/schema";
import { FleetComplianceConfigurationSchema } from "@workspace/api-zod";
import { mapWithBoundedConcurrency, projectCanonicalFleetComplianceConfigurationScore } from "../fleet-compliance-score";
import type { SessionPayload } from "../../lib/session";
import { missingVendorApprovalFields } from "../../lib/vendor-approval-readiness";
import { calculateSafetyEventScore } from "../../lib/safety-score";
import {
  activeServiceMatch,
  evaluateMarketplaceEligibility,
  mappingMatchesSavedSubject,
  type EligibilityArea,
} from "./eligibility";
import {
  rankMarketplaceVendors,
  type RankInput,
  type RankingCandidate,
} from "./ranking";

export interface PartnerMarketplaceContext {
  partnerId: number;
  workType: Pick<
    WorkType,
    "id" | "partnerId" | "name" | "description" | "category"
  >;
  site: Pick<SiteLocation, "id" | "partnerId" | "latitude" | "longitude">;
  demandMapping: ServiceMapping | null;
  canonicalServiceActive: boolean;
  requiredCredentials: string[];
}
export interface PartnerMarketplaceCandidate {
  vendorId: number;
  vendorName: string;
  capability: VendorCapability;
  capabilityMapping: ServiceMapping;
  offer: VendorPartnerServiceOffer;
  companyActive: boolean;
  serviceAreas: EligibilityArea[];
  complianceCurrent: boolean;
  currentCredentials: string[];
  qualifiedWorkerCount: number;
  relationshipStatus: string | null;
  rating: number | null;
  reviewCount: number;
  safety: RankingCandidate["safety"];
  safetyUnavailable: boolean;
  completedJobs: number;
  onTimeRate: number | null;
  priorPartnerJobs: number;
}
export interface PartnerMarketplaceStore {
  authorize(session: SessionPayload, partnerId: number): Promise<boolean>;
  loadContext(
    partnerId: number,
    workTypeId: number,
    siteId: number,
  ): Promise<PartnerMarketplaceContext | null>;
  listCandidates(
    context: PartnerMarketplaceContext,
    now: Date,
  ): Promise<PartnerMarketplaceCandidate[]>;
}
const demandSubject = (row: PartnerMarketplaceContext["workType"]) => ({
  subjectType: "partner_work_type" as const,
  subjectId: row.id,
  name: row.name,
  description: row.description,
  category: row.category,
});
const capabilitySubject = (row: VendorCapability) => ({
  subjectType: "vendor_capability" as const,
  subjectId: row.id,
  name: row.name,
  description: row.description,
});

/** Shared server discovery path for HTTP and subsequent assistant adapters. No client-supplied facts enter eligibility. */
export async function discoverPartnerMarketplaceVendors(
  store: PartnerMarketplaceStore,
  context: PartnerMarketplaceContext,
  options: {
    requestedCapacity: number;
    sort?: RankInput["sort"];
    weights?: RankInput["weights"];
  },
  now: Date,
) {
  if (
    !context.canonicalServiceActive ||
    !mappingMatchesSavedSubject(
      context.demandMapping,
      demandSubject(context.workType),
    )
  )
    return [];
  const candidates: RankingCandidate[] = [];
  for (const row of await store.listCandidates(context, now)) {
    const offer = row.offer;
    if (
      row.capability.vendorId !== row.vendorId ||
      offer.partnerId !== context.partnerId ||
      offer.workTypeId !== context.workType.id ||
      offer.vendorCapabilityId !== row.capability.id ||
      !row.capability.active ||
      !offer.active ||
      offer.effectiveFrom > now ||
      (offer.effectiveUntil !== null && offer.effectiveUntil <= now) ||
      !activeServiceMatch(
        row.capabilityMapping,
        context.demandMapping,
        context.canonicalServiceActive,
      ) ||
      !mappingMatchesSavedSubject(
        row.capabilityMapping,
        capabilitySubject(row.capability),
      )
    )
      continue;
    const eligibility = await evaluateMarketplaceEligibility({
      vendorId: row.vendorId,
      partnerId: context.partnerId,
      workTypeId: context.workType.id,
      authorized: true,
      companyActive: row.companyActive,
      capability: {
        ...row.capability,
        capacity: context.requiredCredentials.length
          ? Math.min(row.capability.capacity, row.qualifiedWorkerCount)
          : row.capability.capacity,
      },
      capabilityMapping: row.capabilityMapping,
      demandMapping: context.demandMapping,
      canonicalServiceActive: context.canonicalServiceActive,
      offer,
      serviceAreas: row.serviceAreas,
      site: context.site,
      complianceCurrent: row.complianceCurrent,
      requiredCredentials: context.requiredCredentials,
      currentCredentials: row.currentCredentials,
      requestedCapacity: options.requestedCapacity,
      available: offer.availability?.available !== false,
      relationshipStatus: row.relationshipStatus,
      now,
    });
    candidates.push({
      vendorId: row.vendorId,
      vendorName: row.vendorName,
      capabilityId: row.capability.id,
      capabilityName: row.capability.name,
      canonicalServiceId: row.capabilityMapping.canonicalServiceId!,
      matchExplanation: row.capabilityMapping.explanation,
      offer: {
        id: offer.id,
        unitPrice: Number(offer.unitPrice),
        unit: offer.unit,
        currency: offer.currency,
        capacity: offer.capacity,
        available: offer.availability?.available !== false,
        commercialConditions: offer.commercialConditions,
      },
      rating: row.rating,
      reviewCount: row.reviewCount,
      safety: row.safety,
      safetyUnavailable: row.safetyUnavailable,
      completedJobs: row.completedJobs,
      onTimeRate: row.onTimeRate,
      priorPartnerJobs: row.priorPartnerJobs,
      complianceCurrent: row.complianceCurrent,
      relationshipStatus: row.relationshipStatus,
      eligibility,
    });
  }
  return rankMarketplaceVendors({
    candidates,
    sort: options.sort,
    weights: options.weights,
  });
}
const completedStatuses = [
  "completed",
  "approved",
  "awaiting_payment",
  "funds_dispersed",
];
const currentMapping = and(
  eq(mappings.status, "active"),
  isNull(mappings.supersededAt),
);

/** Lazy persistence adapter. Search never invokes the classifier and never writes records. */
export function createPostgresPartnerMarketplaceStore(
  connection?: Pick<typeof import("@workspace/db").db, "select">,
  options: { complianceSummary?: typeof marketplaceComplianceSummary } = {},
): PartnerMarketplaceStore {
  const database = async () => connection ?? (await import("@workspace/db")).db;
  return {
    async authorize(session, partnerId) {
      const db = await database();
      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.id, session.userId!));
      if (!user || user.suspendedAt || user.sessionVersion !== session.sv)
        return false;
      if (session.role === "admin") return user.role === "admin";
      const [membership] = await db
        .select()
        .from(memberships)
        .where(
          and(
            eq(memberships.id, session.activeMembershipId!),
            eq(memberships.userId, user.id),
            eq(memberships.orgType, "partner"),
            eq(memberships.partnerId, partnerId),
            inArray(memberships.role, ["admin", "member", "ap"]),
            isNull(memberships.vendorId),
          ),
        );
      return !!membership && user.activeMembershipId === membership.id;
    },
    async loadContext(partnerId, workTypeId, siteId) {
      const db = await database();
      const [workType] = await db
        .select()
        .from(workTypes)
        .where(
          and(eq(workTypes.id, workTypeId), eq(workTypes.partnerId, partnerId)),
        );
      const [site] = await db
        .select()
        .from(sites)
        .where(
          and(
            eq(sites.id, siteId),
            eq(sites.partnerId, partnerId),
            eq(sites.isActive, true),
            eq(sites.hidden, false),
            isNull(sites.supersededAt),
          ),
        );
      if (!workType || !site) return null;
      const [mapped] = await db
        .select({ mapping: mappings, active: services.active })
        .from(mappings)
        .innerJoin(services, eq(services.id, mappings.canonicalServiceId))
        .where(
          and(
            eq(mappings.workTypeId, workTypeId),
            eq(mappings.subjectType, "partner_work_type"),
            currentMapping,
          ),
        );
      return {
        partnerId,
        workType,
        site,
        demandMapping: mapped?.mapping ?? null,
        canonicalServiceActive: mapped?.active === true,
        requiredCredentials: [
          ...new Set([
            ...(workType.requiredCertifications ?? []),
            ...(workType.blockingCertifications ?? []),
          ]),
        ],
      };
    },
    async listCandidates(context, now) {
      const db = await database();
      const matches = await db
        .select({
          capability: capabilities,
          capabilityMapping: mappings,
          offer: offers,
          vendor: vendors,
        })
        .from(offers)
        .innerJoin(
          capabilities,
          and(
            eq(capabilities.id, offers.vendorCapabilityId),
            eq(capabilities.active, true),
          ),
        )
        .innerJoin(vendors, eq(vendors.id, capabilities.vendorId))
        .innerJoin(
          mappings,
          and(
            eq(mappings.vendorCapabilityId, capabilities.id),
            eq(mappings.subjectType, "vendor_capability"),
            currentMapping,
            eq(
              mappings.canonicalServiceId,
              context.demandMapping!.canonicalServiceId!,
            ),
          ),
        )
        .where(
          and(
            eq(offers.partnerId, context.partnerId),
            eq(offers.workTypeId, context.workType.id),
            eq(offers.active, true),
          ),
        )
        .orderBy(asc(vendors.id), asc(capabilities.id));
      // Reject stale or tampered semantic mappings before any private
      // compliance projection is attempted.
      const validatedMatches = matches.filter((match) =>
        mappingMatchesSavedSubject(
          match.capabilityMapping,
          capabilitySubject(match.capability),
        ),
      );
      const uniqueVendors = [...new Map(validatedMatches.map((match) => [match.vendor.id, match.vendor])).values()];
      const complianceSummary = options.complianceSummary ?? marketplaceComplianceSummary;
      const safetyPairs = await mapWithBoundedConcurrency<
        (typeof uniqueVendors)[number],
        readonly [number, { safety: RankingCandidate["safety"]; unavailable: boolean }]
      >(uniqueVendors, 4, async (vendor) => {
        try {
          return [vendor.id, {
            safety: await complianceSummary(vendor.fleetComplianceConfiguration, vendor.id, now),
            unavailable: false,
          }] as const;
        } catch {
          // Compliance is advisory. Isolate private-storage failures to this
          // vendor rather than blanking the rest of marketplace discovery.
          return [vendor.id, { safety: null, unavailable: true }] as const;
        }
      });
      const safetyByVendor = new Map(safetyPairs);
      const result: PartnerMarketplaceCandidate[] = [];
      for (const match of validatedMatches) {
        const vendorId = match.vendor.id;
        const serviceAreas = await db
          .select()
          .from(areas)
          .where(eq(areas.vendorId, vendorId));
        const workers = await db
          .select({
            id: people.id,
            name: certifications.name,
            expiry: certifications.expirationDate,
            verifiedAt: certifications.vendorVerifiedAt,
          })
          .from(people)
          .leftJoin(
            certifications,
            and(
              eq(certifications.employeeId, people.id),
              isNull(certifications.deletedAt),
            ),
          )
          .where(
            and(
              eq(people.vendorId, vendorId),
              eq(people.isActive, true),
              isNull(people.deletedAt),
            ),
          );
        const today = now.toISOString().slice(0, 10);
        const validExpiry = (date: string | null) =>
          !!date &&
          /^\d{4}-\d{2}-\d{2}$/.test(date) &&
          Number.isFinite(new Date(date).getTime()) &&
          new Date(date).toISOString().slice(0, 10) === date &&
          date >= today;
        const certs = new Map<number, Set<string>>();
        for (const worker of workers) {
          const names = certs.get(worker.id) ?? new Set<string>();
          if (
            worker.name &&
            worker.verifiedAt &&
            worker.verifiedAt <= now &&
            (!worker.expiry || validExpiry(worker.expiry))
          )
            names.add(worker.name.trim().toLowerCase());
          certs.set(worker.id, names);
        }
        const qualifiedWorkerCount = [...certs.values()].filter((names) =>
          context.requiredCredentials.every((name) =>
            names.has(name.trim().toLowerCase()),
          ),
        ).length;
        const vendor = match.vendor;
        const complianceCurrent =
          missingVendorApprovalFields(vendor, now).length === 0 &&
          !!vendor.w9DocumentUrl &&
          [
            [vendor.wcDocumentUrl, vendor.wcExpirationDate],
            [vendor.glDocumentUrl, vendor.glExpirationDate],
            [
              vendor.autoLiabilityDocumentUrl,
              vendor.autoLiabilityExpirationDate,
            ],
          ].every(([url, expiry]) => !!url && validExpiry(expiry));
        // Only this partner's completed work contributes to performance. Standalone/private assessments and review text never enter projection.
        const history = await db
          .select({ ticket: tickets })
          .from(tickets)
          .innerJoin(sites, eq(sites.id, tickets.siteLocationId))
          .where(
            and(
              eq(tickets.vendorId, vendorId),
              eq(sites.partnerId, context.partnerId),
              inArray(tickets.status, completedStatuses),
              eq(tickets.lifecycleState, "off_site"),
            ),
          );
        const relevant = history.filter(
          ({ ticket }) =>
            ticket.workTypeId === context.workType.id ||
            ticket.canonicalServiceId ===
              context.demandMapping!.canonicalServiceId,
        );
        const reviewRows = await db
          .select({ rating: ratings.rating })
          .from(ratings)
          .innerJoin(
            tickets,
            and(
              eq(tickets.id, ratings.ticketId),
              eq(tickets.vendorId, vendorId),
            ),
          )
          .innerJoin(sites, eq(sites.id, tickets.siteLocationId))
          .where(
            and(
              eq(ratings.vendorId, vendorId),
              eq(ratings.partnerId, context.partnerId),
              eq(sites.partnerId, context.partnerId),
              inArray(tickets.status, completedStatuses),
              eq(tickets.lifecycleState, "off_site"),
            ),
          );
        const validRatings = reviewRows.filter(
          (row) =>
            Number.isInteger(row.rating) && row.rating >= 1 && row.rating <= 5,
        );
        const scheduled = relevant.filter(
          ({ ticket }) => ticket.scheduledStartAt && ticket.checkInTime,
        );
        const [relationship] = await db
          .select({
            status: relationships.status,
            catalogVersion: relationships.approvedCatalogVersionId,
          })
          .from(relationships)
          .where(
            and(
              eq(relationships.vendorId, vendorId),
              eq(relationships.partnerId, context.partnerId),
            ),
          );
        result.push({
          vendorId,
          vendorName: vendor.name,
          capability: match.capability,
          capabilityMapping: match.capabilityMapping,
          offer: match.offer,
          companyActive: true,
          serviceAreas,
          complianceCurrent,
          qualifiedWorkerCount,
          currentCredentials:
            qualifiedWorkerCount > 0 ? context.requiredCredentials : [],
          relationshipStatus: relationship?.status ?? null,
          rating: validRatings.length
            ? validRatings.reduce((sum, row) => sum + row.rating, 0) /
              validRatings.length
            : null,
          reviewCount: validRatings.length,
          safety: safetyByVendor.get(vendorId)?.safety ?? null,
          safetyUnavailable: safetyByVendor.get(vendorId)?.unavailable ?? false,
          completedJobs: relevant.length,
          priorPartnerJobs: history.length,
          onTimeRate: scheduled.length
            ? scheduled.filter(
                ({ ticket }) => ticket.checkInTime! <= ticket.scheduledStartAt!,
              ).length / scheduled.length
            : null,
        });
      }
      return result;
    },
  };
}

/** Public Partner projection uses the same current, privacy-safe company score as Fleet. */
export async function marketplaceComplianceSummary(
  raw: unknown,
  vendorId = 1,
  at = new Date(),
  projectionOptions: Parameters<typeof projectCanonicalFleetComplianceConfigurationScore>[3] = {},
): Promise<RankingCandidate["safety"]> {
  const parsed = FleetComplianceConfigurationSchema.safeParse(raw ?? {});
  const preview = parsed.success
    ? parsed.data.entries.length
      ? (await projectCanonicalFleetComplianceConfigurationScore(vendorId, parsed.data, at.toISOString(), projectionOptions)).partnerPreview
      : parsed.data.partnerScorePreview
    : null;
  if (!preview) return null;
  return {
    score: preview.score,
    source: "VNDRLY compliance score",
    refreshedAt: preview.evaluatedAt,
    reasons: preview.reasons.map((item) => item.reasonCode),
  };
}

type SafetyEvidence = {
  status: string;
  recordable: boolean | null;
  hipo: boolean;
  type: string;
  createdAt: Date;
  updatedAt: Date;
};
/** Existing VNDRLY event score formula, scoped to this partner/vendor; no evidence is not a perfect score. */
export function marketplaceSafetySummary(
  events: SafetyEvidence[],
  now: Date,
): RankingCandidate["safety"] {
  if (!events.length) return null;
  const day = 86400000;
  const open = events.filter((row) =>
    ["submitted", "under_review", "resolved"].includes(row.status),
  );
  const score = calculateSafetyEventScore({
    openRecordables: open.filter((row) => row.recordable).length,
    oldOpenHipo: open.filter(
      (row) => row.hipo && now.getTime() - row.createdAt.getTime() > 7 * day,
    ).length,
    staleOpen: open.filter(
      (row) => now.getTime() - row.updatedAt.getTime() > 30 * day,
    ).length,
    recentNearMisses: events.filter(
      (row) =>
        row.type === "near_miss" &&
        now.getTime() - row.createdAt.getTime() <= 30 * day,
    ).length,
  });
  return {
    score,
    source:
      "VNDRLY partner-scoped safety events: 100 minus 15/open recordable, 5/HiPo older than 7d, 2/stale open (cap 10), plus 2/near miss in 30d (cap 10)",
    refreshedAt: new Date(
      Math.max(...events.map((row) => row.updatedAt.getTime())),
    ).toISOString(),
    reasons: [],
  };
}
