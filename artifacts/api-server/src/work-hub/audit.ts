import { db, workHubAuditLogTable } from "@workspace/db";
import type { WorkHubOwner } from "@workspace/api-zod";

export type WorkHubAuditInput = {
  actorUserId: number | null;
  owner: WorkHubOwner;
  action: string;
  subjectType: string;
  subjectId: string | number;
  priorVersion?: number | null;
  newVersion?: number | null;
  source: "web" | "ios" | "askv" | "worker" | "connector" | "provider_webhook";
  operationId?: string | null;
  metadata?: Record<string, unknown>;
};

const SECRET_KEYS = /(?:token|secret|password|authorization|cookie|audio|transcript|body|content)/i;

export function redactWorkHubAuditMetadata(metadata: Record<string, unknown> = {}): Record<string, unknown> {
  return Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, SECRET_KEYS.test(key) ? "[redacted]" : value]));
}

type WorkHubAuditExecutor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function appendWorkHubAudit(input: WorkHubAuditInput, executor: WorkHubAuditExecutor = db): Promise<void> {
  await executor.insert(workHubAuditLogTable).values({
    actorUserId: input.actorUserId,
    ownerOrgType: input.owner.type,
    ownerOrgId: input.owner.id,
    action: input.action,
    subjectType: input.subjectType,
    subjectId: String(input.subjectId),
    priorVersion: input.priorVersion ?? null,
    newVersion: input.newVersion ?? null,
    source: input.source,
    operationId: input.operationId ?? null,
    metadata: redactWorkHubAuditMetadata(input.metadata),
  });
}
