import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  FleetWorkCommandSchema,
  FleetWorkScopeSchema,
  FleetWorkReceiptSchema,
  FleetWorkReferenceSchema,
  FleetReconciliationCaseSchema,
  serializeFleetWorkCommand,
  createFleetWorkState,
  appendFleetWorkIntent,
  applyFleetWorkReceipt,
  type FleetWorkCommand,
  type FleetWorkScope,
  type FleetWorkReceipt,
  type FleetWorkReference,
  type FleetReconciliationCase,
} from "@workspace/api-zod";
import type { FleetActor } from "./fleet-ops";
import { FleetError } from "./fleet-repository";

type Applied = Pick<
  Extract<FleetWorkReceipt, { status: "applied" }>,
  "mappings" | "canonicalReferences"
>;
export type FleetWorkExecution = Applied & {
  afterCommit?: Array<() => Promise<unknown>>;
};
/** The implementation rechecks the live session and serializes original-scope
 * receipts, mappings and business effects in ONE actual database transaction.
 * execute must roll back all its effects before propagating a business refusal.
 * Private originals never belong in ordinary audit JSON or tool transcripts. */
export type FleetWorkTransaction = {
  requireProvisioning(scope: FleetWorkScope, write: boolean): Promise<void>;
  readReceipt(
    scope: FleetWorkScope,
    operationId: string,
  ): Promise<FleetWorkReceipt | null>;
  saveReceipt(receipt: FleetWorkReceipt): Promise<void>;
  saveCase(value: FleetReconciliationCase, original?:FleetWorkCommand): Promise<void>;
  execute(command: FleetWorkCommand): Promise<FleetWorkExecution>;
};
export type FleetWorkRepository = {
  transaction<T>(
    actor: FleetActor,
    work: (tx: FleetWorkTransaction) => Promise<T>,
  ): Promise<T>;
};
export const fleetWorkFingerprint = (command: FleetWorkCommand) =>
  createHash("sha256").update(serializeFleetWorkCommand(command)).digest("hex");
function requireOriginalActor(
  actor: FleetActor,
  scope: FleetWorkScope,
  write = false,
) {
  if (
    scope.owner.type !== "vendor" ||
    actor.companyId !== scope.owner.id ||
    actor.userId !== scope.userId ||
    actor.activeMembershipId !== scope.membershipId ||
    actor.sv !== scope.sessionVersion ||
    !["vendor", "field_employee"].includes(actor.role ?? "")
  )
    throw new FleetError("fleet.work_scope_changed", 403);
  if (write && actor.readOnly) throw new FleetError("fleet.read_only", 403);
}
function originalReferences(command: FleetWorkCommand) {
  const result: FleetWorkReference[] = [],
    queue: unknown[] = [command.payload],
    keys = new Set<string>();
  for (let i = 0; i < queue.length; i++) {
    const value = queue[i];
    if (!value || typeof value !== "object") continue;
    const parsed = FleetWorkReferenceSchema.safeParse(value);
    if (parsed.success) {
      const key = JSON.stringify(parsed.data);
      if (!keys.has(key)) {
        keys.add(key);
        result.push(parsed.data);
      }
      continue;
    }
    queue.push(...(Array.isArray(value) ? value : Object.values(value)));
  }
  return result;
}
function refusal(
  error: unknown,
): { reason: FleetReconciliationCase["reason"]; denied: boolean } | null {
  if (!(error instanceof FleetError) || error.status >= 500) return null;
  const code = error.code;
  if (code.includes("version") || code.includes("stale"))
    return { reason: "stale_revision", denied: false };
  if (
    code.includes("ticket") &&
    (code.includes("closed") ||
      code.includes("final") ||
      code.includes("status"))
  )
    return { reason: "closed_ticket", denied: false };
  if (code.includes("assignment"))
    return { reason: "changed_assignment", denied: false };
  if (
    code.includes("reservation") ||
    code.includes("resource_conflict") ||
    code.includes("custody") ||
    code.includes("hold")
  )
    return { reason: "resource_conflict", denied: false };
  if (code.includes("price") || code.includes("rate"))
    return { reason: "unresolved_price", denied: false };
  if (code.includes("destination") || code.includes("location"))
    return { reason: "unresolved_location", denied: false };
  if (code.includes("session"))
    return { reason: "expired_session", denied: true };
  if ([401, 403, 404].includes(error.status))
    return { reason: "missing_authority", denied: true };
  return { reason: "invalid_command", denied: false };
}
function resolutions(
  reason: FleetReconciliationCase["reason"],
): FleetReconciliationCase["allowedResolutions"] {
  switch (reason) {
    case "closed_ticket":
      return ["link_open_ticket", "create_ticket", "retain_record_only"];
    case "changed_assignment":
    case "resource_conflict":
    case "stale_revision":
      return ["correct_assignment", "retain_record_only"];
    case "unresolved_location":
      return ["resolve_location", "retain_record_only"];
    case "unresolved_price":
      return ["resolve_price", "retain_record_only"];
    case "missing_authority":
    case "expired_session":
      return ["renew_authority", "retain_record_only"];
    default:
      return ["retain_record_only"];
  }
}
/** Same receipt-first entry point for connected writes and reconnect replay.
 * A result means canonical acceptance only after repository COMMIT. It never
 * means a notification was delivered, a driver started, or a partner approved. */
export function createFleetWorkService(
  repository: FleetWorkRepository,
  now = () => new Date(),
) {
  const read = async (
    actor: FleetActor,
    rawScope: unknown,
    operationId: string,
  ) => {
    const scope = FleetWorkScopeSchema.parse(rawScope);
    requireOriginalActor(actor, scope);
    return repository.transaction(actor, async (tx) => {
      await tx.requireProvisioning(scope, false);
      const found = await tx.readReceipt(scope, operationId);
      if (found && !isDeepStrictEqual(found.scope, scope))
        throw new FleetError("fleet.work_scope_changed", 403);
      return found ? FleetWorkReceiptSchema.parse(found) : null;
    });
  };
  const apply = async (
    actor: FleetActor,
    raw: unknown,
  ): Promise<FleetWorkReceipt> => {
    const command = FleetWorkCommandSchema.parse(raw);
    requireOriginalActor(actor, command.scope, true);
    const fingerprint = fleetWorkFingerprint(command),
      effects: Array<() => Promise<unknown>> = [];
    const transactionalActor = { ...actor };
    if(command.kind==="replacement.propose"||command.kind==="replacement.action"||command.kind==="cargo.propose"||command.kind==="cargo.action"){
      transactionalActor.schedulingDriverUserIds=[command.payload.baseAssignment.detail.driverUserId];
      if(command.payload.activity.type==="canonical"&&typeof command.payload.activity.id==="string"){transactionalActor.runId=command.payload.activity.id;transactionalActor.schedulingRunId=command.payload.activity.id;}
    }
    if(command.kind==="activity.reconcile"&&command.payload.recoveryDriverUserId)transactionalActor.schedulingDriverUserIds=[command.payload.recoveryDriverUserId];
    if (command.kind === "detail.save")
      transactionalActor.schedulingDriverUserIds = [
        command.payload.detail.driverUserId,
      ];
    if (command.kind === "workday.event")
      transactionalActor.schedulingDriverUserIds = [actor.userId];
    if (command.kind === "activity.create")
      transactionalActor.schedulingDriverUserIds = [
        command.payload.detailSnapshot.detail.driverUserId,
      ];
    if (
      command.kind === "activity.action" ||
      command.kind === "activity.legacy_action"
    ) {
      const p = command.payload;
      transactionalActor.schedulingDriverUserIds = [
        command.kind === "activity.action"
          ? command.payload.baseAssignment.detail.driverUserId
          : command.payload.base.driverUserId,
        ...(p.action.driverUserId ? [p.action.driverUserId] : []),
      ];
      if (
        p.activity.type === "canonical" &&
        typeof p.activity.id === "string"
      ) {
        transactionalActor.runId = p.activity.id;
        transactionalActor.schedulingRunId = p.activity.id;
      }
    }
    const result = await repository.transaction(
      transactionalActor,
      async (tx) => {
        await tx.requireProvisioning(command.scope, false);
        const prior = await tx.readReceipt(command.scope, command.operationId);
        if (prior) {
          if (!isDeepStrictEqual(prior.scope, command.scope))
            throw new FleetError("fleet.work_scope_changed", 403);
          if (prior.fingerprint !== fingerprint)
            throw new FleetError("fleet.operation_conflict");
          return FleetWorkReceiptSchema.parse(
            prior.status === "applied"
              ? { ...prior, status: "duplicate" }
              : prior,
          );
        }
        await tx.requireProvisioning(command.scope, true);
        const recordedAt = now().toISOString(),
          base = {
            version: 2 as const,
            operationId: command.operationId,
            scope: command.scope,
            fingerprint,
            recordedAt,
          };
        for (const dependency of command.dependencies) {
          const receipt = await tx.readReceipt(command.scope, dependency);
          if (
            !receipt ||
            !isDeepStrictEqual(receipt.scope, command.scope) ||
            !["applied", "duplicate"].includes(receipt.status)
          )
            return FleetWorkReceiptSchema.parse({
              ...base,
              status: "retry_later",
              reason: "invalid_dependency",
              retryAt: new Date(Date.parse(recordedAt) + 5000).toISOString(),
            });
        }
        let execution: FleetWorkExecution;
        try {
          execution = await tx.execute(command);
        } catch (error) {
          if (
            error instanceof FleetError &&
            error.code === "fleet.work_dependency_unresolved"
          )
            return FleetWorkReceiptSchema.parse({
              ...base,
              status: "retry_later",
              reason: "invalid_dependency",
              retryAt: new Date(Date.parse(recordedAt) + 5000).toISOString(),
            });
          const failure = refusal(error);
          if (!failure) throw error;
          const caseId = randomUUID(),
            value = FleetReconciliationCaseSchema.parse({
              id: caseId,
              version: 1,
              scope: command.scope,
              operationId: command.operationId,
              reason: failure.reason,
              originalReferences: originalReferences(command),
              allowedResolutions: resolutions(failure.reason),
              createdAt: recordedAt,
            });
          await tx.saveCase(value,command);
          const receipt = FleetWorkReceiptSchema.parse({
            ...base,
            status: failure.denied ? "denied" : "needs_reconciliation",
            reason: failure.reason,
            caseId,
          });
          await tx.saveReceipt(receipt);
          return receipt;
        }
        const receipt = FleetWorkReceiptSchema.parse({
          ...base,
          status: "applied",
          mappings: execution.mappings,
          canonicalReferences: execution.canonicalReferences,
        });
        applyFleetWorkReceipt(
          appendFleetWorkIntent(
            createFleetWorkState(command.scope),
            command,
            fingerprint,
          ),
          receipt,
        );
        await tx.saveReceipt(receipt);
        effects.push(...(execution.afterCommit ?? []));
        return receipt;
      },
    );
    // Failure to send a notice cannot uncommit business work or encourage replay.
    // Providers retain their own delivery outcome; no delivery claim is emitted.
    await Promise.allSettled(
      effects.map((effect) => Promise.resolve().then(effect)),
    );
    return result;
  };
  return { apply, read };
}
