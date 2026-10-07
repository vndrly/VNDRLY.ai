import type { FleetActionInput, FleetRun, FleetOverview } from "@workspace/api-zod";

/** The server supplies actions for this exact actor and revision. */
export function fleetActionInput(run: FleetRun, action: FleetActionInput["action"], operationId: string, fields: Partial<FleetActionInput> = {}): FleetActionInput {
  if (!run.allowedActions.includes(action)) throw new Error("This Fleet action is unavailable for your current assignment.");
  return { ...fields, action, operationId, expectedVersion: run.version };
}

export function fleetRunLabel(run: FleetRun): string {
  return `${run.title} · ${run.status.replaceAll("_", " ")}`;
}
export function fleetHomeRoute(overview: Pick<FleetOverview, "enabled" | "capabilities" | "preference">): string | null {
  if (!overview.enabled) return null;
  if (overview.preference?.defaultWorkspace === "fleet_desk" && overview.capabilities.canDispatch) return "/(tabs)/fleet";
  if (overview.preference?.defaultWorkspace === "fleet_my_day" && overview.capabilities.canDrive) return "/(tabs)/fleet?view=my-day";
  return null;
}

export function fleetErrorMessage(error: unknown): string {
  const code = (error as { code?: string })?.code;
  const messages: Record<string, string> = {
    "fleet.version_conflict": "This run changed. Refresh its current assignment before trying again.",
    "fleet.assignment_conflict": "The driver or equipment already has conflicting work.",
    "fleet.qualifications_required": "The driver does not have every required current qualification.",
    "fleet.equipment_on_hold": "This equipment has a safety hold. Dispatch cannot release it.",
    "fleet.equipment_custody_conflict": "This equipment is in another person's custody.",
    "fleet.equipment_unavailable": "This equipment is unavailable for assignment.",
    "fleet.site_stop_work": "The site has stopped work. This operation is blocked.",
    "fleet.site_forbidden": "Your current Fleet grant does not cover this site.",
    "fleet.fleet_forbidden": "Your current account does not have access to this fleet.",
    "fleet.action_forbidden": "This action is unavailable for your current role, assignment or run phase.",
    "fleet.meter_regression": "The supplied meter reading is lower than the saved reading for these units.",
    "fleet.capture_time_invalid": "The original capture time is outside the server's accepted range.",
    "fleet.company_admin_required": "Fleet setup requires the current company's administrator grant.",
    "fleet.operation_conflict": "This operation reference belongs to a different request. Read the saved outcome first.",
    "fleet.ticket_not_found": "The selected ticket is unavailable under your current company, site and ticket permissions.",
    "fleet.stop_order_conflict": "This stop is not the next permitted stop for the run.",
  };
  return (code && messages[code]) || (error instanceof Error ? error.message : "Fleet operation failed.");
}
