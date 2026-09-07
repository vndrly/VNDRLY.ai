import { createHash } from "node:crypto";
import { classifyToolResult } from "./tool-result";

export interface AskVIdempotencyResult<T> {
  hit: boolean;
  value: T;
}
export interface AskVMutationScope {
  userId: number;
  organizationKey: string;
  sessionId: string;
  key: string;
  fingerprint: string;
}
export function stableArguments(value: unknown): string {
  function sort(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(sort);
    if (!input || typeof input !== "object") return input;
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => [k, sort(v)]),
    );
  }
  return JSON.stringify(sort(value ?? {}));
}
export function mutationIdempotencyKey(
  userId: number,
  toolName: string,
  input: unknown,
): string {
  return createHash("sha256")
    .update(stableArguments([userId, toolName, input]))
    .digest("hex");
}
export function mutationScopeKey(scope: AskVMutationScope): string {
  return mutationIdempotencyKey(scope.userId, "askv-operation", [
    scope.organizationKey,
    scope.sessionId,
    scope.key,
  ]);
}
/** In-process join only. Durable writes also reserve a persisted audit row below. */
export class AskVIdempotencyStore {
  private readonly values = new Map<
    string,
    { value: unknown; expiresAt: number }
  >();
  private readonly calls = new Map<
    string,
    { fingerprint: string; promise: Promise<unknown>; expiresAt: number }
  >();
  constructor(private readonly now = () => Date.now()) {}
  peek<T>(userId: number, key: string): T | undefined {
    const entry = this.values.get(`${userId}:${key}`);
    if (entry && entry.expiresAt > this.now()) return entry.value as T;
    this.values.delete(`${userId}:${key}`);
    return undefined;
  }
  remember<T>(userId: number, key: string, value: T): AskVIdempotencyResult<T> {
    for (const [storedKey, entry] of this.values)
      if (entry.expiresAt <= this.now()) this.values.delete(storedKey);
    const previous = this.peek<T>(userId, key);
    if (previous !== undefined) return { hit: true, value: previous };
    this.values.set(`${userId}:${key}`, {
      value,
      expiresAt: this.now() + 3_600_000,
    });
    return { hit: false, value };
  }
  async run<T>(
    scope: AskVMutationScope,
    operation: () => Promise<T>,
  ): Promise<AskVIdempotencyResult<T>> {
    for (const [key, value] of this.calls)
      if (value.expiresAt <= this.now()) this.calls.delete(key);
    const key = mutationScopeKey(scope);
    const prior = this.calls.get(key);
    if (prior) {
      if (prior.fingerprint !== scope.fingerprint)
        throw new Error(
          "This action key was already used with different arguments.",
        );
      return { hit: true, value: (await prior.promise) as T };
    }
    const promise = Promise.resolve().then(operation);
    this.calls.set(key, {
      fingerprint: scope.fingerprint,
      promise,
      expiresAt: Number.POSITIVE_INFINITY,
    });
    try {
      return { hit: false, value: await promise };
    } finally {
      const entry = this.calls.get(key);
      if (entry) entry.expiresAt = this.now() + 3_600_000;
    }
  }
}
export const askvIdempotency = new AskVIdempotencyStore();

/**
 * Reserve before calling the canonical API. The reservation commits independently
 * of the domain mutation, so a crash/timeout cannot cause an automatic second write.
 * An interrupted reservation is intentionally reported as uncertain until reviewed.
 */
export async function runPersistentAskVMutation(
  scope: AskVMutationScope,
  operation: () => Promise<string>,
): Promise<AskVIdempotencyResult<string>> {
  const joined = await askvIdempotency.run(scope, async () => {
    const { db, assistantActionAuditTable: table } =
      await import("@workspace/db");
    const { and, eq, sql } = await import("drizzle-orm");
    const actionType = `askv-idempotency:${mutationScopeKey(scope)}`;
    const reservation = await db.transaction(async (tx) => {
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${actionType}, 0))`,
      );
      const [prior] = await tx
        .select()
        .from(table)
        .where(
          and(eq(table.userId, scope.userId), eq(table.actionType, actionType)),
        )
        .limit(1);
      if (prior) {
        if (
          (prior.toolInput as { fingerprint?: string } | null)?.fingerprint !==
          scope.fingerprint
        ) {
          throw new Error(
            "This action key was already used with different arguments.",
          );
        }
        // A JSON-looking string in jsonb is decoded again by Drizzle after
        // node-postgres reads it. Keep new results in an object envelope and
        // accept completed legacy rows that were decoded to structured JSON.
        if (prior.errorCode === null) {
          const stored = prior.toolOutput;
          if (typeof stored === "string") return { output: stored };
          if (
            stored &&
            typeof stored === "object" &&
            "format" in stored &&
            stored.format === "askv-operation-result-v1" &&
            "output" in stored &&
            typeof stored.output === "string"
          ) {
            return { output: stored.output };
          }
          return { output: JSON.stringify(stored ?? null) };
        }
        return {
          output: JSON.stringify({
            ok: false,
            outcomeUnknown: true,
            error:
              "This action may already have completed. Check the current record before trying a new action.",
            code: "assistant.action_outcome_unknown",
          }),
        };
      }
      const [created] = await tx
        .insert(table)
        .values({
          userId: scope.userId,
          clientSurface: "api",
          inputMode: "web_voice",
          provider: "openai_realtime",
          toolName: "askv_operation_reservation",
          actionType,
          toolInput: { fingerprint: scope.fingerprint },
          resultStatus: "failure",
          errorCode: "assistant.action_pending",
        })
        .returning({ id: table.id });
      return { id: created!.id };
    });
    if ("output" in reservation)
      return { hit: true, value: reservation.output! };
    const output = await operation();
    await db
      .update(table)
      .set({
        toolOutput: { format: "askv-operation-result-v1", output },
        resultStatus: classifyToolResult(output, true),
        errorCode: null,
      })
      .where(eq(table.id, reservation.id));
    return { hit: false, value: output };
  });
  return { hit: joined.hit || joined.value.hit, value: joined.value.value };
}
