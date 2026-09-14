export type SafetyDependencyName = "askv" | "mapbox" | "push";
export type SafetyIncidentStatus = "open" | "awaiting_response" | "acknowledged" | "escalated" | "closed";
export type SafetyIncidentSeverity = "low" | "medium" | "high" | "critical";

export interface SafetyIncidentEvidence {
  actorUserId: number;
  kind: "note" | "photo" | "document" | "location";
  value: string;
  createdAt: Date;
}

export interface SafetyIncident {
  id: number;
  organizationId: number;
  reportedByUserId: number;
  source: "manual" | "possible_crash" | "platform_crash";
  severity: SafetyIncidentSeverity;
  status: SafetyIncidentStatus;
  originalReport: string;
  persisted: true;
  createdAt: Date;
  responseDeadlineAt: Date | null;
  degradedCapabilities: SafetyDependencyName[];
  safetyChainSnapshot: number[];
  configurationWarning: "missing_safety_chain" | null;
  assignedResponderUserId: number | null;
  acknowledgedAt: Date | null;
  acknowledgedByUserId: number | null;
  evidence: SafetyIncidentEvidence[];
  evidenceHold: { placedByUserId: number; reason: string; placedAt: Date } | null;
  closedAt: Date | null;
  closedByUserId: number | null;
}

export interface SafetyIncidentInput {
  organizationId: number;
  reportedByUserId: number;
  source: SafetyIncident["source"];
  severity: SafetyIncidentSeverity;
  originalReport: string;
  startedAt?: Date;
}

export interface SafetyResponseRepository {
  createIncident(input: Omit<SafetyIncident, "id">): Promise<SafetyIncident>;
  findIncident(id: number): Promise<SafetyIncident | null>;
  saveIncident(incident: SafetyIncident): Promise<SafetyIncident>;
}

export interface SafetyResponseDependencies {
  repository: SafetyResponseRepository;
  dependencyHealth: Record<SafetyDependencyName, boolean>;
  findSafetyChain(organizationId: number): Promise<number[]>;
  findActiveAdmins(organizationId: number): Promise<number[]>;
  notify(userIds: number[], payload: { incidentId: number; severity: SafetyIncidentSeverity; status: SafetyIncidentStatus }): Promise<void>;
}

export function createInMemorySafetyResponseRepository(): SafetyResponseRepository {
  const rows = new Map<number, SafetyIncident>();
  let nextId = 1;
  const copy = (value: SafetyIncident): SafetyIncident => structuredClone(value);
  return {
    async createIncident(input) {
      const row = { ...input, id: nextId++ } as SafetyIncident;
      rows.set(row.id, copy(row));
      return copy(row);
    },
    async findIncident(id) {
      const row = rows.get(id);
      return row ? copy(row) : null;
    },
    async saveIncident(incident) {
      rows.set(incident.id, copy(incident));
      return copy(incident);
    },
  };
}

function unavailableCapabilities(health: Record<SafetyDependencyName, boolean>): SafetyDependencyName[] {
  return (["askv", "mapbox", "push"] as const).filter((name) => !health[name]);
}

export async function createIncident(
  input: SafetyIncidentInput,
  dependencies: SafetyResponseDependencies,
): Promise<SafetyIncident> {
  const createdAt = input.startedAt ?? new Date();
  const configuredChain = await dependencies.findSafetyChain(input.organizationId);
  const fallbackAdmins = configuredChain.length === 0
    ? await dependencies.findActiveAdmins(input.organizationId)
    : [];
  const recipients = configuredChain.length > 0 ? configuredChain : fallbackAdmins;
  const incident = await dependencies.repository.createIncident({
    organizationId: input.organizationId,
    reportedByUserId: input.reportedByUserId,
    source: input.source,
    severity: input.severity,
    status: input.source === "possible_crash" ? "awaiting_response" : "open",
    originalReport: input.originalReport,
    persisted: true,
    createdAt,
    responseDeadlineAt: input.source === "possible_crash" ? new Date(createdAt.getTime() + 60_000) : null,
    degradedCapabilities: unavailableCapabilities(dependencies.dependencyHealth),
    safetyChainSnapshot: recipients,
    configurationWarning: configuredChain.length === 0 ? "missing_safety_chain" : null,
    assignedResponderUserId: null,
    acknowledgedAt: null,
    acknowledgedByUserId: null,
    evidence: [],
    evidenceHold: null,
    closedAt: null,
    closedByUserId: null,
  });
  if (dependencies.dependencyHealth.push && input.source !== "possible_crash" && recipients.length > 0) {
    await dependencies.notify(recipients, { incidentId: incident.id, severity: incident.severity, status: incident.status });
  }
  return incident;
}

export async function startPossibleCrashCountdown(
  input: SafetyIncidentInput & { source: "possible_crash" },
  dependencies: SafetyResponseDependencies,
): Promise<SafetyIncident> {
  return createIncident(input, dependencies);
}

async function requireIncident(id: number, repository: SafetyResponseRepository): Promise<SafetyIncident> {
  const incident = await repository.findIncident(id);
  if (!incident) throw new Error("Safety incident not found");
  return incident;
}

export async function escalateIncident(
  id: number,
  now: Date,
  dependencies: Pick<SafetyResponseDependencies, "repository" | "notify">,
): Promise<SafetyIncident> {
  const incident = await requireIncident(id, dependencies.repository);
  if (incident.status === "acknowledged" || incident.status === "closed") return incident;
  if (incident.responseDeadlineAt && now < incident.responseDeadlineAt) {
    throw new Error("Response window is still active");
  }
  incident.status = "escalated";
  const saved = await dependencies.repository.saveIncident(incident);
  if (saved.safetyChainSnapshot.length > 0) {
    await dependencies.notify(saved.safetyChainSnapshot, { incidentId: saved.id, severity: saved.severity, status: saved.status });
  }
  return saved;
}

export async function acknowledgeIncident(id: number, userId: number, repository: SafetyResponseRepository): Promise<SafetyIncident> {
  const incident = await requireIncident(id, repository);
  incident.status = "acknowledged";
  incident.acknowledgedAt = new Date();
  incident.acknowledgedByUserId = userId;
  incident.assignedResponderUserId = userId;
  return repository.saveIncident(incident);
}

export async function appendIncidentEvidence(
  id: number,
  evidence: Omit<SafetyIncidentEvidence, "createdAt">,
  repository: SafetyResponseRepository,
): Promise<SafetyIncident> {
  const incident = await requireIncident(id, repository);
  incident.evidence.push({ ...evidence, createdAt: new Date() });
  return repository.saveIncident(incident);
}

export async function placeEvidenceHold(id: number, userId: number, reason: string, repository: SafetyResponseRepository): Promise<SafetyIncident> {
  const incident = await requireIncident(id, repository);
  incident.evidenceHold = { placedByUserId: userId, reason, placedAt: new Date() };
  return repository.saveIncident(incident);
}

export async function closeIncident(
  id: number,
  actor: { userId: number; role: "assigned_responder" | "safety_manager" | "company_admin" | "worker" },
  repository: SafetyResponseRepository,
): Promise<SafetyIncident> {
  const incident = await requireIncident(id, repository);
  const assigned = incident.assignedResponderUserId === actor.userId;
  if (!(actor.role === "safety_manager" || actor.role === "company_admin" || (actor.role === "assigned_responder" && assigned))) {
    throw new Error("Actor is not authorized to close this incident");
  }
  incident.status = "closed";
  incident.closedAt = new Date();
  incident.closedByUserId = actor.userId;
  return repository.saveIncident(incident);
}
