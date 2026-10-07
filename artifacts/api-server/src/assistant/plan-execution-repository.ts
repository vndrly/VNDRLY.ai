import { pool } from "@workspace/db";
import { z } from "zod/v4";
import {
  planExecutionRunSchema, planExecutionFingerprint,
  type PlanExecutionRepository,
} from "./plan-execution";
import { withPlanExecutionRecords } from "./plan-execution-store";

export const storedPlanExecutionSchema = z.object({
  run: planExecutionRunSchema,
  fence: z.number().int().nonnegative(),
  leaseUntil: z.number().int().nonnegative(),
}).strict();

export interface PrivatePlanExecutionStore {
  eligibleOwnerIds(): Promise<number[]>;
  withRecords<T>(userId: number, operation: (records: unknown[]) => Promise<T>): Promise<T>;
  reportInvalidRecord?(userId: number, index: number): void;
}

const defaultStore: PrivatePlanExecutionStore = {
  async eligibleOwnerIds() {
    // Read only owner IDs. Never project private delegations into a public user.
    const result = await pool.query<{ id: number }>(`
      SELECT id FROM users
      WHERE jsonb_typeof(assistant_plan_executions) = 'array'
        AND EXISTS (
          SELECT 1 FROM jsonb_array_elements(CASE
            WHEN jsonb_typeof(assistant_plan_executions) = 'array'
            THEN assistant_plan_executions ELSE '[]'::jsonb END) AS execution
          WHERE execution->'run'->>'state' IN ('pending', 'running', 'outcome_unknown')
            AND execution->'run'->>'cancelRequested' = 'false'
        )
      ORDER BY id
    `);
    return result.rows.map(row => row.id);
  },
  withRecords: withPlanExecutionRecords,
  reportInvalidRecord(userId, index) {
    console.warn("Invalid private execution skipped; record preserved", { userId, index });
  },
};

/** Durable per-owner claims; domain execution happens after releasing the row lock. */
export function createPrivatePlanExecutionRepository(
  store: PrivatePlanExecutionStore = defaultStore,
): PlanExecutionRepository {
  return {
    async claimNext(now, leaseUntil) {
      if (!Number.isSafeInteger(now) || !Number.isSafeInteger(leaseUntil) ||
          leaseUntil <= now || leaseUntil > now + 60_000) throw new Error("Invalid execution lease");
      for (const userId of await store.eligibleOwnerIds()) {
        const claim = await store.withRecords(userId, async records => {
          for (let index = 0; index < records.length; index++) {
            const decoded = storedPlanExecutionSchema.safeParse(records[index]);
            if (!decoded.success) {
              store.reportInvalidRecord?.(userId, index);
              continue;
            }
            const record = decoded.data;
            if (record.run.authorization.requester.userId !== userId ||
                planExecutionFingerprint(record.run.authorization) !== record.run.authorizationHash) {
              store.reportInvalidRecord?.(userId, index);
              continue;
            }
            if (record.leaseUntil > now || (record.run.nextAttemptAt !== undefined && record.run.nextAttemptAt > now) || record.run.cancelRequested ||
                !["pending", "running", "outcome_unknown"].includes(record.run.state)) continue;
            if (record.fence >= Number.MAX_SAFE_INTEGER) {
              store.reportInvalidRecord?.(userId, index);
              continue;
            }
            record.fence++;
            record.leaseUntil = leaseUntil;
            records[index] = record;
            return { run: structuredClone(record.run), fence: record.fence, leaseUntil };
          }
          return null;
        });
        if (claim) return claim;
      }
      return null;
    },
    async commit(claim, expectedRevision, next, now) {
      const parsed = planExecutionRunSchema.parse(next);
      return store.withRecords(claim.run.authorization.requester.userId, async records => {
        const index = records.findIndex(value => {
          const decoded = storedPlanExecutionSchema.safeParse(value);
          return decoded.success && decoded.data.run.authorization.id === claim.run.authorization.id;
        });
        if (index < 0) return false;
        const record = storedPlanExecutionSchema.parse(records[index]);
        if (record.fence !== claim.fence || record.leaseUntil !== claim.leaseUntil ||
            now >= record.leaseUntil || record.run.cancelRequested ||
            record.run.revision !== expectedRevision || parsed.revision !== expectedRevision + 1 ||
            parsed.authorizationHash !== record.run.authorizationHash ||
            planExecutionFingerprint(parsed.authorization) !== record.run.authorizationHash ||
            parsed.cancelRequested !== record.run.cancelRequested) return false;
        records[index] = { ...record, run: parsed };
        return true;
      });
    },
    async release(claim) {
      await store.withRecords(claim.run.authorization.requester.userId, async records => {
        const index = records.findIndex(value => {
          const decoded = storedPlanExecutionSchema.safeParse(value);
          return decoded.success && decoded.data.run.authorization.id === claim.run.authorization.id;
        });
        if (index < 0) return;
        const record = storedPlanExecutionSchema.parse(records[index]);
        if (record.fence !== claim.fence || record.leaseUntil !== claim.leaseUntil) return;
        records[index] = { ...record, leaseUntil: 0 };
      });
    },
  };
}
