import { and, eq } from "drizzle-orm";
import { db, workHubClientOperationsTable } from "@workspace/db";
import type { WorkHubCommandEnvelope, WorkHubCommandResult } from "@workspace/api-zod";
import { WorkHubAccessError } from "./context-access";

export type WorkHubActor = { userId: number; source: "web" | "ios" | "askv" };

export async function executeWorkHubCommand<T>(
  actor: WorkHubActor,
  kind: string,
  envelope: WorkHubCommandEnvelope<unknown>,
  apply: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<WorkHubCommandResult<T>> {
  return db.transaction(async (tx) => {
    const [claimed] = await tx.insert(workHubClientOperationsTable).values({
      userId: actor.userId, commandKind: kind, operationId: envelope.operationId,
      ownerOrgType: envelope.owner.type, ownerOrgId: envelope.owner.id,
    }).onConflictDoNothing().returning({ id: workHubClientOperationsTable.id });

    if (!claimed) {
      const [existing] = await tx.select().from(workHubClientOperationsTable).where(and(
        eq(workHubClientOperationsTable.userId, actor.userId),
        eq(workHubClientOperationsTable.commandKind, kind),
        eq(workHubClientOperationsTable.operationId, envelope.operationId),
      )).limit(1);
      if (!existing || existing.ownerOrgType !== envelope.owner.type || existing.ownerOrgId !== envelope.owner.id) {
        throw new WorkHubAccessError("forbidden");
      }
      if (!existing.resultJson || !existing.appliedAt) throw new Error("work_hub.operation_in_progress");
      return { operationId: envelope.operationId, appliedAt: existing.appliedAt.toISOString(), replayed: true, resource: existing.resultJson as T };
    }

    const resource = await apply(tx);
    const appliedAt = new Date();
    await tx.update(workHubClientOperationsTable).set({ resultJson: resource as Record<string, unknown>, appliedAt })
      .where(eq(workHubClientOperationsTable.id, claimed.id));
    return { operationId: envelope.operationId, appliedAt: appliedAt.toISOString(), replayed: false, resource };
  });
}
