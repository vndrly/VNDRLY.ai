import type { ServiceMapping, ServiceMappingSubjectType } from "@workspace/db/schema";

export interface ServiceSubjectInput {
  subjectType: ServiceMappingSubjectType;
  subjectId: number;
  name: string;
  description?: string | null;
  category?: string | null;
}

export interface ServiceCandidate {
  id: number;
  code: string;
  name: string;
  category: string;
  definition: string;
  inclusionGuidance: string | null;
  exclusionGuidance: string | null;
  aliases: string[];
}

export interface ServiceClassification {
  outcome: "matched" | "novel" | "rejected" | "pending";
  canonicalServiceId: number | null;
  confidence: number;
  explanation: string;
  evidence: Record<string, unknown>;
  modelVersion: string;
  subjectFingerprint: string;
  /** Stamped by the matching engine before the external model call. */
  observedMappingVersion?: number;
  proposedService?: { name: string; definition: string };
  retryable?: boolean;
}

export interface ServiceCandidateProvider {
  findCandidates(input: ServiceSubjectInput, limit: number): Promise<ServiceCandidate[]>;
}

export interface ServiceClassifier {
  classify(input: ServiceSubjectInput, candidates: ServiceCandidate[]): Promise<ServiceClassification>;
}

export type StoredServiceMapping = ServiceMapping;
export type NewServiceMapping = Omit<StoredServiceMapping, "id" | "createdAt">;

export interface MappingTransaction {
  loadSubject(): Promise<(ServiceSubjectInput & { active: boolean }) | null>;
  listMappings(): Promise<StoredServiceMapping[]>;
  isCanonicalServiceActive(id: number): Promise<boolean>;
  supersede(id: number, at: Date): Promise<void>;
  insert(row: NewServiceMapping): Promise<StoredServiceMapping>;
}

export interface MappingRepository {
  /** Transaction with an exclusive lock covering the subject, including its first mapping. */
  withSubjectLock<T>(subject: ServiceSubjectInput, run: (tx: MappingTransaction) => Promise<T>): Promise<T>;
}

export interface RecordedClassificationInput {
  subject: ServiceSubjectInput;
  classification: ServiceClassification;
  actorUserId?: number | null;
  actorProcess: string;
}

export interface CurrentServiceMapping {
  status: "recorded" | "pending";
  mapping: StoredServiceMapping | null;
  currentMapping: StoredServiceMapping | null;
  retryable: boolean;
}

export interface ServiceMatchingDependencies {
  candidateProvider: ServiceCandidateProvider;
  classifier: ServiceClassifier;
  repository: MappingRepository;
  activationThreshold: number;
}
