import { createPostgresCandidateProvider, subjectFingerprint, validateSubject } from "./candidates";
import { createConfiguredServiceClassifier, pendingClassification, validateClassification } from "./classifier";
import { createClassificationRecorder, createPostgresMappingRepository } from "./activation";
import type { RecordedClassificationInput, ServiceClassification, ServiceMatchingDependencies, ServiceSubjectInput } from "./types";

export * from "./types";
export { createPostgresCandidateProvider, normalizeServiceText } from "./candidates";
export { createModelServiceClassifier, createConfiguredServiceClassifier } from "./classifier";
export { createPostgresMappingRepository } from "./activation";

export function createServiceMatching(dependencies: ServiceMatchingDependencies) {
  if (!Number.isFinite(dependencies.activationThreshold) || dependencies.activationThreshold < 0 || dependencies.activationThreshold > 1) {
    throw new Error("A calibrated service matching activation threshold in 0..1 is required");
  }
  return {
    async classifyServiceSubject(input: ServiceSubjectInput): Promise<ServiceClassification> {
      validateSubject(input);
      try {
        const observedMappingVersion = await dependencies.repository.withSubjectLock(input, async (tx) =>
          Math.max(0, ...(await tx.listMappings()).map((row) => row.mappingVersion)));
        const candidates = await dependencies.candidateProvider.findCandidates(input, 8);
        const result = await dependencies.classifier.classify(input, candidates);
        if (result.outcome === "pending") return pendingClassification(input);
        validateClassification(result, candidates);
        return { ...result, subjectFingerprint: subjectFingerprint(input), observedMappingVersion };
      } catch {
        // Provider errors and malformed completions are retryable; they never
        // replace current mappings or leak provider response/credential details.
        return pendingClassification(input);
      }
    },
    recordClassification: createClassificationRecorder(dependencies.repository, dependencies.activationThreshold),
  };
}

function configuredMatching() {
  const configured = process.env.SERVICE_MATCHING_ACTIVATION_THRESHOLD;
  // Offline evaluation must choose the initial threshold before activation.
  // No guessed policy default can silently activate production mappings.
  const activationThreshold = configured?.trim() ? Number(configured) : NaN;
  return createServiceMatching({ activationThreshold, candidateProvider: createPostgresCandidateProvider(), classifier: createConfiguredServiceClassifier(), repository: createPostgresMappingRepository() });
}

export async function classifyServiceSubject(input: ServiceSubjectInput): Promise<ServiceClassification> {
  return configuredMatching().classifyServiceSubject(input);
}

export async function recordClassification(input: RecordedClassificationInput) {
  return configuredMatching().recordClassification(input);
}
