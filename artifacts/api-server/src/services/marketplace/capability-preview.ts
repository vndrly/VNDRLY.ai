import {
  createPostgresCandidateProvider,
  type ServiceCandidateProvider,
  type ServiceClassifier,
  type ServiceSubjectInput,
} from "../service-matching";
import {
  createConfiguredServiceClassifier,
  validateClassification,
} from "../service-matching/classifier";
import { validateSubject } from "../service-matching/candidates";

export type CapabilityPreviewInput = {
  name: string;
  description?: string | null;
};
export type CapabilityPreview = {
  provisional: true;
  status: "matched" | "review_required" | "rejected" | "pending";
  canonicalServiceId: number | null;
  canonicalServiceName: string | null;
  explanation: string;
  confidence: number;
  matchingPartnerCount: number | null;
};

/** Read-only classification: no mapping repository, recorder, or commercial writer is available here. */
export function createCapabilityPreview(dependencies: {
  candidateProvider: ServiceCandidateProvider;
  classifier: ServiceClassifier;
  activationThreshold: number;
  countMatchingDemand: (canonicalServiceId: number) => Promise<number | null>;
}) {
  return async (input: CapabilityPreviewInput): Promise<CapabilityPreview> => {
    const pending = (): CapabilityPreview => ({
      provisional: true,
      status: "pending",
      canonicalServiceId: null,
      canonicalServiceName: null,
      explanation: "Service classification is pending retry",
      confidence: 0,
      matchingPartnerCount: null,
    });
    // Candidate/classifier contracts require a positive identity for fingerprinting.
    // This internal sentinel has no corresponding subject and is never recorded or returned.
    const subject: ServiceSubjectInput = {
      subjectType: "vendor_capability",
      subjectId: Number.MAX_SAFE_INTEGER,
      name: input.name,
      description: input.description ?? null,
    };
    validateSubject(subject);
    try {
      const threshold = dependencies.activationThreshold;
      if (!Number.isFinite(threshold) || threshold < 0 || threshold > 1)
        return pending();
      const candidates = await dependencies.candidateProvider.findCandidates(
        subject,
        8,
      );
      const result = await dependencies.classifier.classify(
        subject,
        candidates,
      );
      if (result.outcome === "pending") return pending();
      validateClassification(result, candidates);
      const candidate = candidates.find(
        (item) => item.id === result.canonicalServiceId,
      );
      const matched =
        result.outcome === "matched" && result.confidence >= threshold;
      const count = matched
        ? await dependencies.countMatchingDemand(result.canonicalServiceId!)
        : null;
      if (matched && count === null) return pending(); // Concept was archived during the external classification.
      return {
        provisional: true,
        status: matched
          ? "matched"
          : result.outcome === "rejected" && result.confidence >= threshold
            ? "rejected"
            : "review_required",
        canonicalServiceId: candidate?.id ?? null,
        canonicalServiceName: candidate?.name ?? null,
        explanation: result.explanation,
        confidence: result.confidence,
        matchingPartnerCount: count,
      };
    } catch {
      return pending();
    }
  };
}

export function createConfiguredCapabilityPreview(
  countMatchingDemand: (canonicalServiceId: number) => Promise<number | null>,
) {
  const configured = process.env.SERVICE_MATCHING_ACTIVATION_THRESHOLD;
  return createCapabilityPreview({
    activationThreshold: configured?.trim() ? Number(configured) : NaN,
    candidateProvider: createPostgresCandidateProvider(),
    classifier: createConfiguredServiceClassifier(),
    countMatchingDemand,
  });
}
