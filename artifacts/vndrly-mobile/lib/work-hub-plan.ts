import type { StoredUser } from "./auth";
export type NativePlanStep = {
  id: string;
  specialist: string;
  toolNames: string[];
  dependsOn: string[];
  state: "pending" | "waiting" | "failed" | "completed" | "cancelled";
  resultReferences: string[];
  deadlineAt?: string;
  detail?: string;
  completion?:
    | { kind: "planned_read_observed" }
    | {
        kind: "canonical_ticket_action_saved";
        action: "submit" | "approve" | "cancel";
        ticketId: number;
      };
};
export type NativePlanProjection = {
  taskId: string;
  taskVersion: number;
  taskStatus: string;
  title: string;
  plan: {
    schemaVersion: 1;
    id: string;
    version: number;
    identity: { userId: number; organizationKey: string };
    steps: NativePlanStep[];
  };
  verifiedCompletionStepIds: string[];
  eligibleStepIds: string[];
  overdueStepIds: string[];
  permissionSource: "current_platform_session";
  backgroundExecutionAvailable: false;
  executionStarted: false;
  recordedCompletionRequiresReadback: true;
};
export const isPlanTaskId = (value: string) =>
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export function isCoordinatedPlanDescription(value: unknown): boolean {
  if (typeof value !== "string" || value.length > 20_000) return false;
  try {
    const plan = JSON.parse(value);
    return (
      plan?.schemaVersion === 1 &&
      typeof plan.id === "string" &&
      Array.isArray(plan.steps)
    );
  } catch {
    return false;
  }
}
export function planAccountKey(user: StoredUser): string {
  const organization =
    user.role === "partner" && user.partnerId
      ? `partner:${user.partnerId}`
      : ["vendor", "field_employee"].includes(user.role) && user.vendorId
        ? `vendor:${user.vendorId}`
        : "";
  return `${user.id}|${user.activeMembershipId ?? ""}|${organization}`;
}
export function readNativePlanProjection(
  value: unknown,
  taskId: string,
  user: StoredUser,
): NativePlanProjection {
  const projection = value as NativePlanProjection;
  const organizationKey = planAccountKey(user).split("|")[2];
  const strings = (items: unknown, max: number) =>
    Array.isArray(items) &&
    items.length <= max &&
    items.every(
      (item) =>
        typeof item === "string" && item.length > 0 && item.length <= 1000,
    );
  if (
    !organizationKey ||
    !isPlanTaskId(taskId) ||
    projection?.taskId !== taskId ||
    !Number.isInteger(projection.taskVersion) ||
    projection.taskVersion < 1 ||
    typeof projection.title !== "string" ||
    typeof projection.taskStatus !== "string" ||
    projection.permissionSource !== "current_platform_session" ||
    projection.backgroundExecutionAvailable !== false ||
    projection.executionStarted !== false ||
    projection.recordedCompletionRequiresReadback !== true ||
    projection.plan?.schemaVersion !== 1 ||
    projection.plan.identity?.userId !== user.id ||
    projection.plan.identity.organizationKey !== organizationKey ||
    !Number.isInteger(projection.plan.version) ||
    projection.plan.version < 1 ||
    !Array.isArray(projection.plan.steps) ||
    projection.plan.steps.length < 1 ||
    projection.plan.steps.length > 100 ||
    !strings(projection.verifiedCompletionStepIds, 100) ||
    !strings(projection.eligibleStepIds, 100) ||
    !strings(projection.overdueStepIds, 100)
  )
    throw new Error("Plan unavailable for current account");
  const ids = new Set<string>();
  for (const step of projection.plan.steps) {
    if (
      typeof step.id !== "string" ||
      !step.id ||
      ids.has(step.id) ||
      typeof step.specialist !== "string" ||
      !["pending", "waiting", "failed", "completed", "cancelled"].includes(
        step.state,
      ) ||
      !strings(step.toolNames, 50) ||
      !strings(step.dependsOn, 100) ||
      !strings(step.resultReferences, 100) ||
      (step.deadlineAt !== undefined &&
        !Number.isFinite(Date.parse(step.deadlineAt))) ||
      (step.detail !== undefined && typeof step.detail !== "string")
    )
      throw new Error("Invalid plan projection");
    ids.add(step.id);
  }
  if (
    projection.plan.steps.some((step) =>
      step.dependsOn.some((id) => !ids.has(id)),
    ) ||
    [
      ...projection.verifiedCompletionStepIds,
      ...projection.eligibleStepIds,
      ...projection.overdueStepIds,
    ].some((id) => !ids.has(id))
  )
    throw new Error("Invalid plan projection");
  return projection;
}
