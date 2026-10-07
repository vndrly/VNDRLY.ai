import { pool } from "@workspace/db";

/**
 * Isolated private persistence for approved background delegations. An OAuth
 * grant is not a delegation. Callers validate every stored record and current
 * authority before using it; this store does not authorize domain commands.
 * Keep the column outside ordinary Drizzle user projections.
 */
export async function withPlanExecutionRecords<T>(
  userId: number,
  operation: (records: unknown[]) => Promise<T>,
  connectionPool: typeof pool = pool,
): Promise<T> {
  if (!Number.isSafeInteger(userId) || userId < 1) throw new Error("Invalid execution owner");
  const client = await connectionPool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ assistant_plan_executions: unknown }>(
      "SELECT assistant_plan_executions FROM users WHERE id = $1 FOR UPDATE",
      [userId],
    );
    if (!result.rows[0]) throw new Error("Execution owner unavailable");
    const records = result.rows[0].assistant_plan_executions ?? [];
    if (!Array.isArray(records)) throw new Error("Invalid private execution storage");
    const output = await operation(records);
    await client.query(
      "UPDATE users SET assistant_plan_executions = $2::jsonb WHERE id = $1",
      [userId, JSON.stringify(records)],
    );
    await client.query("COMMIT");
    return output;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
