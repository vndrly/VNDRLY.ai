import { sql } from "drizzle-orm";
import type { WorkHubGovernanceOwner } from "@workspace/api-zod";

type LockExecutor = { execute(query: unknown): Promise<unknown> };

/** Lock order is global retention minimum, then owner governance. Never reverse it. */
export async function acquireGlobalRetentionLock(executor: LockExecutor): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext('work-hub:governance:minimum'))`);
}

export async function acquireOwnerGovernanceLock(executor: LockExecutor, owner: WorkHubGovernanceOwner): Promise<void> {
  await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'work-hub:governance:owner'}), hashtext(${`${owner.type}:${owner.id}`}))`);
}

export async function acquireRetentionPublicationLocks(executor: LockExecutor, owner: WorkHubGovernanceOwner): Promise<void> {
  await acquireGlobalRetentionLock(executor);
  await acquireOwnerGovernanceLock(executor, owner);
}
