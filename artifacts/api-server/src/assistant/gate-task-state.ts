import { createHash } from "node:crypto";
import { z } from "zod/v4";
import { normalizePlateState } from "@workspace/plate-state";
import { stableArguments } from "./askv-idempotency";
import type { SessionPayload } from "../lib/session";
import type { AskVToolDefinition } from "./tool-registry";

const id = z.number().int().positive();
const text = z.string().max(2000).nullable().optional();
export const GateTaskFields = z.object({
  firstName: text, lastName: text, company: text, vehiclePlate: text, plateState: text,
  purpose: text, notes: text, siteLocationId: id.nullable().optional(), siteId: id.nullable().optional(),
  gateStationId: z.uuid().nullable().optional(), gateId: z.uuid().nullable().optional(),
  visitId: id.nullable().optional(), destinationGateId: z.uuid().nullable().optional(), destinationId: z.uuid().nullable().optional(),
  destination: z.enum(["site_exit", "remain"]).nullable().optional(), kind: z.enum(["enter", "leave", "route"]).nullable().optional(),
  expectedDurationMinutes: z.number().int().positive().nullable().optional(),
  hostType: z.enum(["partner", "vendor"]).nullable().optional(), hostPartnerId: id.nullable().optional(), hostVendorId: id.nullable().optional(),
  entryCategory: z.enum(["visitor", "routine_vendor_work", "partner_admin", "vendor_admin"]).nullable().optional(),
}).strict();
export const GateTaskUpdate = z.object({
  expectedVersion: z.number().int().nonnegative(),
  action: z.enum(["start", "correct", "cancel"]),
  taskType: z.enum(["check_in", "check_out", "movement"]).optional(),
  fields: GateTaskFields.optional(),
}).strict();
export type GateTaskState = { version: number; taskType: "check_in" | "check_out" | "movement"; state: "draft" | "cancelled" | "saved" | "outcome_unknown"; fields: z.infer<typeof GateTaskFields>; execution?: { toolName: string; result: string; fingerprint?: string; movementInput?: Record<string, unknown> } };
function executionFingerprint(input: unknown) {
  const { confirmed: _confirmed, idempotencyKey: _key, voiceSessionId: _voice, latitude: _lat, longitude: _lng, ...fields } = (input ?? {}) as Record<string, unknown>;
  return createHash("sha256").update(stableArguments(fields)).digest("hex");
}

/** Corrections are patches, not replacement drafts; null explicitly clears a field. */
export function transitionGateTask(current: GateTaskState | null, input: unknown): GateTaskState {
  const change = GateTaskUpdate.parse(input);
  if (change.fields?.plateState) change.fields.plateState = normalizePlateState(change.fields.plateState) ?? change.fields.plateState;
  if (change.expectedVersion !== (current?.version ?? 0)) throw Error("This Gate draft changed on another turn or device. Read it again before correcting it.");
  if (change.action === "start") {
    if (!change.taskType) throw Error("Choose the Gate task type.");
    if (current?.state === "draft" || current?.state === "outcome_unknown") throw Error("Resolve the existing draft before starting another.");
    return { version: change.expectedVersion + 1, taskType: change.taskType, state: "draft", fields: change.fields ?? {} };
  }
  if (!current || current.state !== "draft") throw Error("Read or start an active Gate draft first.");
  if (change.taskType && change.taskType !== current.taskType) throw Error("Cancel the existing task before changing its type.");
  if (change.action === "cancel") {
    if (change.fields) throw Error("Cancellation cannot also edit fields.");
    return { ...current, version: current.version + 1, state: "cancelled" };
  }
  return { ...current, version: current.version + 1, fields: { ...current.fields, ...change.fields } };
}

export function gateTaskActionType(userId: number, organization: string, conversationId: number) {
  return `askv-gate-draft:${createHash("sha256").update(JSON.stringify([userId, organization, conversationId])).digest("hex")}`;
}

const gateTaskActionTypes: Record<string, GateTaskState["taskType"]> = {
  confirm_visitor_check_in: "check_in", confirm_visitor_check_out: "check_out", confirm_gate_visit_movement: "movement",
};
export function gateTaskExecutionGuard(task: GateTaskState | null, toolName: string, rawInput: unknown): string | null {
  if (!task) return null;
  const input = (rawInput ?? {}) as Record<string, unknown>;
  if (task.taskType !== gateTaskActionTypes[toolName]) throw Error("This action does not match the saved Gate task. Read the draft first.");
  if (task.state === "cancelled") throw Error("This Gate task was cancelled. Start a new draft before executing.");
  for (const [key, value] of Object.entries(task.fields)) {
    if (value == null ? input[key] != null : input[key] !== value)
      throw Error(`The action differs from the saved Gate draft (${key}). Read and prepare the corrected draft first.`);
  }
  if (task.state === "saved" || task.state === "outcome_unknown") {
    if (!task.execution || task.execution.toolName !== toolName) throw Error("The saved Gate task needs reconciliation.");
    if (task.execution.fingerprint && task.execution.fingerprint !== executionFingerprint(rawInput)) throw Error("This is a different action from the reserved Gate task. Resolve the original task first.");
    return task.execution.result;
  }
  return null;
}

/** Serialize execution with corrections; retain results across new turns and restarts. */
export async function executeWithGateTask(session: SessionPayload, conversationId: number | undefined, toolName: string, input: unknown, execute: () => Promise<string>): Promise<string> {
  if (!gateTaskActionTypes[toolName] || !conversationId) return execute();
  const { db, assistantActionAuditTable: audit, assistantConversationsTable: conversations } = await import("@workspace/db");
  const { and, eq, sql } = await import("drizzle-orm");
  const { organizationKeyFromSession } = await import("./askv-pending-confirmation");
  const { classifyToolResult } = await import("./tool-result");
  const actionType = gateTaskActionType(session.userId!, organizationKeyFromSession(session), conversationId);
  let executionStarted = false;
  try {
    const reservation = await db.transaction(async tx => {
      const owner = await tx.select({ id: conversations.id }).from(conversations)
        .where(and(eq(conversations.id, conversationId), eq(conversations.userId, session.userId!))).for("update");
      if (!owner.length) throw Error("Conversation unavailable.");
      const [row] = await tx.select().from(audit).where(and(eq(audit.userId, session.userId!), eq(audit.actionType, actionType))).limit(1);
      const task = (row?.toolOutput ?? null) as GateTaskState | null;
      const previous = gateTaskExecutionGuard(task, toolName, input);
      if (previous) return { previous, row: null, task: null };
      if (row && task) {
        const pending = JSON.stringify({ ok: false, status: "outcome_unknown", error: "This Gate action is reserved or awaiting reconciliation. Do not submit another action." });
        const movementInput = toolName === "confirm_gate_visit_movement" ? input as Record<string, unknown> : undefined;
        await tx.update(audit).set({ toolOutput: { ...task, version: task.version + 1, state: "outcome_unknown", execution: { toolName, result: pending, movementInput, fingerprint: executionFingerprint(input) } } }).where(eq(audit.id, row.id));
      }
      return { previous: null, row, task };
    });
    if (reservation.previous) return reservation.previous;
    executionStarted = true;
    let result: string;
    try { result = await execute(); }
    catch { result = JSON.stringify({ ok: false, status: "outcome_unknown", error: "Gate outcome is uncertain. Read the original operation before retrying." }); }
    const { row, task } = reservation;
    if (row && task) {
      let parsed: Record<string, unknown>;
      try { parsed = JSON.parse(result); } catch { parsed = { status: "outcome_unknown" }; }
      const state = classifyToolResult(result, true) === "success" ? "saved" : parsed?.status === "outcome_unknown" || parsed?.outcomeUnknown === true ? "outcome_unknown" : "draft";
      await db.update(audit).set({ toolOutput: { ...task, version: task.version + 2, state, execution: { toolName, result, fingerprint: executionFingerprint(input), movementInput: toolName === "confirm_gate_visit_movement" ? input : undefined } } }).where(and(eq(audit.id, row.id), sql`${audit.toolOutput}->>'version' = ${String(task.version + 1)}`));
    }
    return result;
  } catch (error) { return JSON.stringify({ ok: false, ...(executionStarted ? { status: "outcome_unknown" } : {}), error: executionStarted ? "The Gate result could not be persisted. Read the original operation; do not submit a replacement." : error instanceof Error ? error.message : "Gate task could not execute" }); }
}

/** Uses the existing durable assistant store; no new database schema or business record. */
export async function accessGateTask(session: SessionPayload, conversationId: number, update?: unknown): Promise<GateTaskState | null> {
  if (!session.userId || !Number.isSafeInteger(conversationId) || conversationId <= 0 || (!session.vendorId && !session.partnerId))
    throw Error("A signed-in company conversation is required for a Gate draft.");
  const { db, assistantActionAuditTable: audit, assistantConversationsTable: conversations } = await import("@workspace/db");
  const { and, eq } = await import("drizzle-orm");
  const { organizationKeyFromSession } = await import("./askv-pending-confirmation");
  const actionType = gateTaskActionType(session.userId, organizationKeyFromSession(session), conversationId);
  return db.transaction(async tx => {
    // All draft updates for this conversation serialize; ownership is checked inside the lock.
    const query = tx.select({ id: conversations.id }).from(conversations)
      .where(and(eq(conversations.id, conversationId), eq(conversations.userId, session.userId!)));
    const owner = update === undefined ? await query : await query.for("update");
    if (!owner.length) throw Error("Conversation unavailable.");
    const [row] = await tx.select().from(audit).where(and(eq(audit.userId, session.userId!), eq(audit.actionType, actionType))).limit(1);
    const current = (row?.toolOutput ?? null) as GateTaskState | null;
    if (update === undefined) return current;
    const next = transitionGateTask(current, update);
    if (row) await tx.update(audit).set({ toolOutput: next }).where(eq(audit.id, row.id));
    else await tx.insert(audit).values({ userId: session.userId, vendorId: session.vendorId, partnerId: session.partnerId,
      conversationId, clientSurface: "api", inputMode: "shared", provider: "application", toolName: "update_gate_task",
      actionType, resultStatus: "success", toolOutput: next });
    return next;
  });
}

export async function runGateTaskTool(name: string, input: unknown, session: SessionPayload, conversationId?: number) {
  try {
    let task: GateTaskState | null;
    if (name === "read_gate_task") {
      z.object({}).strict().parse(input);
      task = await accessGateTask(session, conversationId!);
      if (task?.state === "outcome_unknown" && task.execution) {
        const result = await reconcileGateTaskOutcome(task, session);
        if (result) {
          const { db, assistantActionAuditTable: audit } = await import("@workspace/db");
          const { and, eq, sql } = await import("drizzle-orm");
          const { organizationKeyFromSession } = await import("./askv-pending-confirmation");
          const next: GateTaskState = { ...task, version: task.version + 1, state: "saved", execution: { ...task.execution, result: JSON.stringify(result) } };
          // Never overwrite a completion that arrived while the read was in flight.
          await db.update(audit).set({ toolOutput: next }).where(and(eq(audit.userId, session.userId!),
            eq(audit.actionType, gateTaskActionType(session.userId!, organizationKeyFromSession(session), conversationId!)),
            sql`${audit.toolOutput}->>'version' = ${String(task.version)}`));
          task = await accessGateTask(session, conversationId!);
        }
      }
    } else {
      const { idempotencyKey: _key, voiceSessionId: _voice, confirmed: _confirmed, ...fields } = (input ?? {}) as Record<string, unknown>;
      task = await accessGateTask(session, conversationId!, fields);
      const { askvPendingConfirmations, askVConfirmationScopeId, organizationKeyFromSession } = await import("./askv-pending-confirmation");
      askvPendingConfirmations.clear(session.userId!, organizationKeyFromSession(session), askVConfirmationScopeId(conversationId, `typed:${conversationId}`));
    }
    const publicTask = task?.execution ? { ...task, execution: { toolName: task.execution.toolName, result: task.execution.result } } : task;
    return { ok: true, task: publicTask, businessActionExecuted: false,
      nextStep: "A draft is never approval or proof of a saved visit. Re-read current authorized Gate records, prepare the exact fields, and obtain confirmation through the existing action tool. After saved or cancelled, start a new draft for a different task. An uncertain check-in requires record reconciliation; never submit a replacement automatically." };
  } catch (error) { return { ok: false, error: error instanceof Error ? error.message : "Gate draft unavailable" }; }
}
/** Only persisted receipts can enter this recovery path; it never sends a POST. */
export async function reconcileGateTaskOutcome(task: GateTaskState, session: SessionPayload): Promise<Record<string, unknown> | null> {
  if (task.state !== "outcome_unknown" || !task.execution) return null;
  if (task.execution.movementInput) {
    const { readGateMovementOutcome } = await import("./gate-movement-tools");
    const result = await readGateMovementOutcome(task.execution.movementInput, session);
    return result.ok ? result : null;
  }
  let prior: Record<string, any>;
  try { prior = JSON.parse(task.execution.result); } catch { return null; }
  if (!prior.savedReceipt || !["check_in", "check_out"].includes(task.taskType)) return null;
  const { verifySavedGateVisit } = await import("./natural-voice-write-tools");
  if (await verifySavedGateVisit(prior.savedReceipt, session, task.taskType === "check_out")) return null;
  return { ok: true, status: "saved", visitId: prior.savedReceipt.id, action: task.taskType === "check_in" ? "visitor_checked_in" : "visitor_checked_out", verification: "canonical_readback", refresh: ["gate", "visits"] };
}
export const GATE_TASK_TOOLS: AskVToolDefinition[] = [
  { name: "read_gate_task", description: "Resume the signed-in person's saved Gate draft in this conversation and company after correction, page change, interruption or reconnect. No model-supplied actor, company or conversation accepted. Read before updating. The draft is not authority or proof of a saved visit.", inputSchema: { type: "object", properties: {}, additionalProperties: false }, roles: ["vendor", "field_employee", "partner", "admin"], mutating: false, confirmation: "none", risk: "read", execution: "server", pack: "screen", auditTarget: "task" },
  { name: "update_gate_task", description: "Save or correct the operational Gate draft, not a visit. Read read_gate_task first and supply its exact version (0 if none). Start collects the user's supplied fields and currently selected authorized Gate; correct PATCHES only explicitly changed fields (null clears); cancel ends the draft. Corrections preserve the other fields and invalidate old confirmation. Never silently change site, gate, person or company from a page change. Do not store inferred values as if the user supplied them. No business action executes.", inputSchema: z.toJSONSchema(GateTaskUpdate) as AskVToolDefinition["inputSchema"], roles: ["vendor", "field_employee", "partner", "admin"], mutating: true, confirmation: "none", risk: "low", execution: "server", pack: "screen", auditTarget: "task" },
];
