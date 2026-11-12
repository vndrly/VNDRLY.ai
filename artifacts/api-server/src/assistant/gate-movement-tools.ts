import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { AskVToolDefinition } from "./tool-registry";
import type { SessionPayload } from "../lib/session";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";

export const GATE_MOVEMENT_TOOL_NAMES = ["query_gate_visit_movements", "confirm_gate_visit_movement"] as const;
const positiveId = z.number().int().positive();
export const GateMovementRead = z.object({ siteId: positiveId, visitId: positiveId.optional() }).strict();
export const GateMovementAction = z.object({
  siteId: positiveId, visitId: positiveId, gateId: z.uuid(),
  kind: z.enum(["enter", "leave", "route"]),
  destinationGateId: z.uuid().nullable().optional(),
  destination: z.enum(["site_exit", "remain"]).optional(),
  destinationId: z.uuid().optional(),
}).strict();

export function gateMovementOperationId(key: string) {
  if (!key.trim()) throw Error("Server-bound operation identity required");
  const hex = createHash("sha256").update(JSON.stringify(["askv-gate-movement", key])).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}
export function gateMovementRequest(name: string, input: Record<string, unknown>) {
  if (name === "query_gate_visit_movements") {
    const parsed = GateMovementRead.parse(input);
    return { method: "GET" as const, path: `/gate-change-over/movements?siteId=${parsed.siteId}`, body: {} };
  }
  const { confirmed, idempotencyKey, voiceSessionId: _voice, ...fields } = input;
  if (confirmed !== true || typeof idempotencyKey !== "string") throw Error("Server-bound confirmation required");
  const command = GateMovementAction.parse(fields);
  if (command.kind === "enter" && (command.destinationId || command.destinationGateId || command.destination === "site_exit"))
    throw Error("Arrival cannot also route to another destination");
  if (command.destinationId && command.destinationGateId) throw Error("Choose one exact destination");
  return { method: "POST" as const, path: "/gate-change-over/movements", body: { ...command, operationId: gateMovementOperationId(idempotencyKey) } };
}
function record(value: unknown): Record<string, any> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, any> : {};
}
export function projectGateMovements(input: unknown, value: unknown) {
  const args = GateMovementRead.parse(input), snapshot = record(value);
  if (snapshot.error || snapshot.ok === false) return snapshot;
  if (!Array.isArray(snapshot.visits) || !Array.isArray(snapshot.gates))
    return { ok: false, status: "unavailable", error: "The current Gate records could not be read." };
  return { ok: true, siteId: args.siteId, gates: snapshot.gates,
    visits: args.visitId ? snapshot.visits.filter((v: any) => v.id === args.visitId) : snapshot.visits,
    checkedAt: new Date().toISOString() };
}
export function verifyGateMovement(input: z.infer<typeof GateMovementAction>, operationId: string, value: unknown) {
  const snapshot = record(value);
  const visit = Array.isArray(snapshot.visits) ? snapshot.visits.find((v: any) => v.id === input.visitId) : undefined;
  const movement = Array.isArray(visit?.movements) ? visit.movements.find((m: any) => m.operationId === operationId) : undefined;
  const matches = !snapshot.error && snapshot.ok !== false && movement && movement.gateId === input.gateId && movement.kind === input.kind &&
    (input.kind === "enter" || (input.destinationId ? movement.destinationId === input.destinationId :
      movement.destinationGateId === (input.destinationGateId ?? null) &&
      (input.destinationGateId || movement.destination === (input.destination ?? "remain"))));
  if (!matches) return { ok: false, status: "outcome_unknown", operationId, visitId: input.visitId,
    error: "The movement is not verified. Read this visit's movements using the original operation ID; do not create a replacement action." };
  return { ok: true, status: "saved", operationId, visitId: input.visitId, siteId: input.siteId,
    movement, presence: visit.presence, checkOutTime: visit.checkOutTime, verification: "canonical_readback", refresh: ["gate", "visits"] };
}
/** Both text and voice dispatch through this canonical, permission-checked API. */
export async function executeGateMovement(input: Record<string, unknown>, session: SessionPayload) {
  const request = gateMovementRequest("confirm_gate_visit_movement", input);
  const { operationId, ...command } = request.body as z.infer<typeof GateMovementAction> & { operationId: string };
  try {
    const saved = record(await callNaturalVoiceDomainApi(request.path, "POST", request.body, session));
    if ((saved.error || saved.ok === false) && !(typeof saved.status === "number" && saved.status >= 500)) return saved;
  } catch {
    // A lost response can follow a commit. Reconcile before reporting or retrying.
  }
  return readGateMovementOutcome(input, session);
}
/** Reconnect recovery is read-only and retains the original server-bound operation. */
export async function readGateMovementOutcome(input: Record<string, unknown>, session: SessionPayload) {
  const { operationId, ...command } = gateMovementRequest("confirm_gate_visit_movement", input).body as z.infer<typeof GateMovementAction> & { operationId: string };
  try {
    return verifyGateMovement(command, operationId, await callNaturalVoiceDomainApi(`/gate-change-over/movements?siteId=${command.siteId}`, "GET", {}, session));
  } catch { return verifyGateMovement(command, operationId, null); }
}
const roles = ["admin", "partner", "vendor", "field_employee"] as const;
export const GATE_MOVEMENT_TOOLS: AskVToolDefinition[] = [
  { name: GATE_MOVEMENT_TOOL_NAMES[0], description: "Read authorized Gate topology, active and inactive gates, visits, exact movement history and current presence. Supply visitId to resume or reconcile one visit. Saved operation IDs are evidence; absence after a timeout is not permission to submit a new action.", inputSchema: z.toJSONSchema(GateMovementRead) as AskVToolDefinition["inputSchema"], roles: [...roles], mutating: false, confirmation: "none", risk: "read", execution: "server", pack: "screen", auditTarget: "site" },
  { name: GATE_MOVEMENT_TOOL_NAMES[1], description: "Prepare an exact inner Gate arrival (enter), inner departure (leave), or routing change (route) on an existing property visit. Read current movements and topology first. Return to inner uses enter on the SAME visit, never a new property check-in. Requires server confirmation; operation identity is server-owned. Outer departure and early turnaround use confirm_visitor_check_out, NOT this tool. The canonical API rejects inactive gates, wrong-company visits and conflicting concurrent movements. Saved success includes fresh canonical readback.", inputSchema: z.toJSONSchema(GateMovementAction) as AskVToolDefinition["inputSchema"], roles: [...roles], mutating: true, confirmation: "required", risk: "high", execution: "server", pack: "screen", auditTarget: "site" },
];
