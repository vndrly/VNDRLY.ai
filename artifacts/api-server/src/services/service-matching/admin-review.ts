import type { MappingRepository, StoredServiceMapping } from "./types";
import { subjectFingerprint } from "./candidates";

export class MarketplaceAdminError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}

export interface MappingReview {
  action: "approve" | "reject" | "remap";
  canonicalServiceId?: number;
  reason: string;
}

/** Human decisions share the classifier's subject lock and append-only versions. */
export async function reviewServiceMapping(
  repository: MappingRepository,
  source: StoredServiceMapping,
  review: MappingReview,
  actorUserId: number,
) {
  return repository.withSubjectLock(
    {
      subjectType: source.subjectType,
      subjectId: source.subjectId,
      name: "review",
    },
    async (tx) => {
      const rows = await tx.listMappings();
      const latest = rows.reduce((a, b) =>
        a.mappingVersion > b.mappingVersion ? a : b,
      );
      const current =
        rows.find(
          (row) => row.status === "active" && row.supersededAt === null,
        ) ?? null;
      const targetId =
        review.action === "remap"
          ? review.canonicalServiceId!
          : source.canonicalServiceId;
      const previousDecision = rows.find((row) => {
        const audit = row.evidence.adminReview as
          | Record<string, unknown>
          | undefined;
        return (
          audit?.sourceMappingId === source.id &&
          audit.action === review.action &&
          audit.reason === review.reason &&
          row.actorUserId === actorUserId &&
          row.canonicalServiceId === targetId
        );
      });
      if (previousDecision)
        return { mapping: previousDecision, currentMapping: current };
      if (
        latest.id !== source.id ||
        !["active", "review_required"].includes(source.status)
      )
        throw new MarketplaceAdminError(409, "service_mapping.stale_review");
      const savedSubject = await tx.loadSubject();
      if (!savedSubject?.active)
        throw new MarketplaceAdminError(
          409,
          "service_mapping.subject_inactive",
        );
      const classifiedSubject = (
        source.evidence.serviceMatching as Record<string, unknown> | undefined
      )?.subjectFingerprint;
      if (
        classifiedSubject &&
        classifiedSubject !== subjectFingerprint(savedSubject)
      )
        throw new MarketplaceAdminError(409, "service_mapping.subject_changed");
      if (
        review.action !== "reject" &&
        (targetId === null || !(await tx.isCanonicalServiceActive(targetId)))
      )
        throw new MarketplaceAdminError(
          409,
          "service_mapping.concept_inactive",
        );
      const at = new Date();
      if (current && (review.action !== "reject" || current.id === source.id))
        await tx.supersede(current.id, at);
      const mapping = await tx.insert({
        subjectType: source.subjectType,
        subjectId: source.subjectId,
        workTypeId: source.workTypeId,
        vendorCapabilityId: source.vendorCapabilityId,
        canonicalServiceId: targetId,
        status: review.action === "reject" ? "rejected" : "active",
        confidence: source.confidence,
        explanation: review.reason,
        modelVersion: source.modelVersion,
        evidence: {
          ...source.evidence,
          adminReview: {
            sourceMappingId: source.id,
            action: review.action,
            reason: review.reason,
            priorExplanation: source.explanation,
          },
        },
        mappingVersion: latest.mappingVersion + 1,
        actorUserId,
        actorProcess: "admin-service-review",
        reviewedAt: at,
        supersededAt: null,
      });
      return {
        mapping,
        currentMapping:
          mapping.status === "active"
            ? mapping
            : current?.id === source.id
              ? null
              : current,
      };
    },
  );
}

export function mappingReadback(row: StoredServiceMapping | null) {
  return (
    row && {
      ...row,
      confidence: Number(row.confidence),
      evidenceSummary: row.explanation,
    }
  );
}
