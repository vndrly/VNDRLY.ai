/** Shared identity and context for askV's Gate workflows, rendered by Next Steps. */
export const GATE_GUIDED_WORKFLOW_KEYS = [
  "first-watch", "gate-staffing-recovery", "gate-watch-handoff",
  "gate-vehicle-check-in", "gate-inner-arrival", "gate-vehicle-check-out",
  "gate-early-turnaround", "gate-return-to-inner", "gate-map-and-log",
  "gate-shift-scheduling", "gate-station-management", "gate-staff-visibility",
] as const;
export type GateGuidedWorkflowKey = typeof GATE_GUIDED_WORKFLOW_KEYS[number];
export type GateSetupProgressHint = { kind: "gate_setup_progress"; workflowKey: "first-watch"; state: "actionable" | "waiting" | "complete" | "unavailable" };
export function parseGateSetupProgressHint(value: unknown): GateSetupProgressHint | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const source = value as Record<string, unknown>;
  return source.kind === "gate_setup_progress" && source.workflowKey === "first-watch" && ["actionable", "waiting", "complete", "unavailable"].includes(String(source.state))
    ? { kind: "gate_setup_progress", workflowKey: "first-watch", state: source.state as GateSetupProgressHint["state"] } : undefined;
}
export type AskVGateWorkflow = {
  key: GateGuidedWorkflowKey;
  title: string;
  action?: { title: string; href: string } | null;
  message?: string | null;
  context?: {
    siteId?: number; stationId?: string | null; shiftId?: string | null;
    watchId?: string | null; ticketId?: number | null; vehicleId?: number | string;
    alertId?: string; movementId?: string; day?: string; employeeUserId?: number;
    siteName?: string; stationName?: string | null;
  };
};
export type AskVGateGuidance = {
  companyId: number;
  state: "checking" | "unavailable" | "ready";
  active: AskVGateWorkflow | null;
  available: AskVGateWorkflow[];
  /** Current form guidance is a UI hint, never proof of a saved business outcome. */
  control?: { prompt: string; targetId: string };
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
const text = (value: unknown, limit: number) => typeof value === "string" && value.length <= limit ? value : undefined;
const positive = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value > 0;
export const isGateGuidedWorkflowKey = (value: unknown): value is GateGuidedWorkflowKey => GATE_GUIDED_WORKFLOW_KEYS.includes(value as GateGuidedWorkflowKey);

function workflow(value: unknown): AskVGateWorkflow | null {
  const raw = record(value);
  if (!isGateGuidedWorkflowKey(raw.key) || !text(raw.title, 200)) return null;
  const action = record(raw.action);
  const href = text(action.href, 1500);
  const safeAction = text(action.title, 200) && href && /^\/(?:gate(?:[/?#]|$)|gate-locations(?:[/?#]|$)|field-employees(?:[/?#]|$)|work-hub\/calendar(?:[/?#]|$))/.test(href) && !/[\\\r\n]/.test(href)
    ? { title: action.title as string, href } : null;
  const source = record(raw.context);
  const context: NonNullable<AskVGateWorkflow["context"]> = {};
  for (const key of ["siteId", "ticketId", "employeeUserId"] as const) if (positive(source[key])) context[key] = source[key];
  for (const key of ["stationId", "shiftId", "watchId", "alertId", "movementId"] as const) if (typeof source[key] === "string" && /^[a-f\d]{8}(?:-[a-f\d]{4}){3}-[a-f\d]{12}$/i.test(source[key])) context[key] = source[key];
  if (typeof source.day === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.day)) context.day = source.day;
  for (const key of ["siteName", "stationName"] as const) if (text(source[key], 200)) context[key] = source[key] as string;
  if (positive(source.vehicleId) || typeof source.vehicleId === "string" && /^[a-z\d-]{1,80}$/i.test(source.vehicleId)) context.vehicleId = source.vehicleId;
  return { key: raw.key, title: raw.title as string, action: safeAction, ...(text(raw.message, 1000) ? { message: raw.message as string } : {}), context };
}

/** Bounded display hints only; account authority and completion always come from saved records. */
export function parseAskVGateGuidance(value: unknown, companyId?: number | null): AskVGateGuidance | undefined {
  const raw = record(value);
  if (!positive(raw.companyId) || companyId !== undefined && raw.companyId !== companyId || !["checking", "unavailable", "ready"].includes(String(raw.state))) return undefined;
  const active = workflow(raw.active);
  const available = Array.isArray(raw.available) ? raw.available.slice(0, 5).map(workflow).filter((item): item is AskVGateWorkflow => Boolean(item)) : [];
  const control = record(raw.control);
  return {
    companyId: raw.companyId, state: raw.state as AskVGateGuidance["state"], active, available,
    ...(active && text(control.prompt, 1000) && text(control.targetId, 150) ? { control: { prompt: control.prompt as string, targetId: control.targetId as string } } : {}),
  };
}

export type GateWorkflowOffer = { kind: "gate_workflow_offer"; companyId: number; workflowKey: GateGuidedWorkflowKey; context: NonNullable<AskVGateWorkflow["context"]> };
/** A tool can propose a registered guide; it cannot supply a route or business action. */
export function parseGateWorkflowOffer(value: unknown, companyId?: number | null): GateWorkflowOffer | undefined {
  const raw = record(value);
  if (raw.kind !== "gate_workflow_offer" || !isGateGuidedWorkflowKey(raw.workflowKey)) return undefined;
  const guidance = parseAskVGateGuidance({ companyId: raw.companyId, state: "ready", active: { key: raw.workflowKey, title: raw.workflowKey, context: raw.context }, available: [] }, companyId);
  return guidance?.active ? { kind: "gate_workflow_offer", companyId: guidance.companyId, workflowKey: raw.workflowKey, context: guidance.active.context ?? {} } : undefined;
}
