import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { PlanStepInput } from "./coordinated-plan";
function savedGateAction(value: unknown) {
  const action = z
    .object({
      state: z.literal("completed"),
      toolName: z.enum([
        "confirm_visitor_check_in",
        "confirm_visitor_check_out",
      ]),
      executionFingerprint: z.string().min(1),
      arguments: z.record(z.string(), z.unknown()),
      result: z.string(),
    })
    .parse(value);
  const receipt = z
    .object({
      ok: z.literal(true),
      action: z.enum(["visitor_checked_in", "visitor_checked_out"]),
      visitId: z.number().int().positive(),
    })
    .passthrough()
    .parse(JSON.parse(action.result));
  if (receipt.error) throw Error("Gate action failed");
  if (
    receipt.action !==
    (action.toolName === "confirm_visitor_check_in"
      ? "visitor_checked_in"
      : "visitor_checked_out")
  )
    throw Error("Gate receipt type mismatch");
  return { action, receipt };
}
/** The current actor's durable accepted receipt supplies the ID; model input never substitutes it. */
export function savedGateVisitResourceId(value: unknown) {
  return savedGateAction(value).receipt.visitId;
}
export function verifySavedGateVisitCompletion(
  step: PlanStepInput,
  actionValue: unknown,
  currentValue: unknown,
) {
  if (step.completion?.kind !== "canonical_gate_visit_action_saved")
    throw Error("Unsupported Gate intent");
  const desired = step.completion,
    tool =
      desired.action === "check_in"
        ? "confirm_visitor_check_in"
        : "confirm_visitor_check_out";
  if (step.toolNames.length !== 1 || step.toolNames[0] !== tool)
    throw Error("Gate intent/tool mismatch");
  const { action, receipt } = savedGateAction(actionValue);
  const current = z
    .object({
      id: z.number().int().positive(),
      siteLocationId: z.number().int().positive(),
      firstName: z.string(),
      lastName: z.string(),
      hostType: z.enum(["vendor", "partner"]),
      hostVendorId: z.number().int().positive().nullable(),
      hostPartnerId: z.number().int().positive().nullable(),
      checkInTime: z.string().datetime(),
      checkOutTime: z.string().datetime().nullable(),
      autoCheckedOut: z.boolean(),
    })
    .parse(currentValue);
  if (
    action.toolName !== tool ||
    current.id !== receipt.visitId ||
    current.siteLocationId !== desired.siteLocationId
  )
    throw Error("Gate canonical target mismatch");
  if (desired.action === "check_in") {
    const hostKey =
      desired.hostType === "vendor" ? "hostVendorId" : "hostPartnerId";
    if (
      action.arguments.siteLocationId !== desired.siteLocationId ||
      action.arguments.firstName !== desired.firstName ||
      action.arguments.lastName !== desired.lastName ||
      action.arguments.hostType !== desired.hostType ||
      action.arguments[hostKey] !== desired.hostId ||
      current.firstName !== desired.firstName ||
      current.lastName !== desired.lastName ||
      current.hostType !== desired.hostType ||
      current[hostKey] !== desired.hostId
    )
      throw Error("Gate check-in intent changed");
  } else if (
    desired.visitId !== current.id ||
    action.arguments.visitId !== desired.visitId ||
    current.checkOutTime === null ||
    current.autoCheckedOut
  )
    throw Error("Explicit Gate checkout not recorded");
  return {
    resourceId: current.id,
    evidenceHash: createHash("sha256")
      .update(
        JSON.stringify({
          executionFingerprint: action.executionFingerprint,
          arguments: action.arguments,
          receipt,
          current,
        }),
      )
      .digest("hex"),
  };
}
