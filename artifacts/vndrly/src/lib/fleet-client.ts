import type {
  FleetOverview,
  FleetRun,
  FleetResources,
  FleetActionInput,
  FleetSetup,
} from "@workspace/api-zod";
import {
  CreateFleetRunSchema,
  FleetSetupInputSchema,
  FleetWorkspacePreferenceInputSchema,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
export class FleetRequestError extends Error {
  constructor(
    public code: string,
    public status: number,
  ) {
    super(code);
  }
}
export function fleetErrorMessage(error: unknown, fallback: string) {
  if (!(error instanceof FleetRequestError)) return fallback;
  const messages: Record<string, string> = {
    "fleet.qualifications_required":
      "The driver needs the fleet's current verified certifications.",
    "fleet.driver_unavailable":
      "The driver is not currently available in this company.",
    "fleet.driver_grant_required":
      "The driver needs an explicit grant for this fleet and every run site.",
    "fleet.equipment_on_hold":
      "This equipment has an active hold. Choose eligible equipment.",
    "fleet.equipment_unavailable":
      "This equipment is unavailable for dispatch.",
    "fleet.equipment_custody_conflict":
      "This equipment is checked out to another person.",
    "fleet.assignment_conflict":
      "The driver or equipment already has an active run.",
    "fleet.version_conflict":
      "The record changed. Refresh and review the current version.",
    "fleet.site_forbidden":
      "This run includes a site that is no longer authorized.",
    "fleet.stop_order_conflict": "Use the current stop in the saved run order.",
    "fleet.load_required": "Record the pickup load before departing this stop.",
    "fleet.delivery_required":
      "Record delivery for each undelivered load before departing.",
    "fleet.correction_notes_required":
      "Describe the corrections before resubmitting closeout.",
    "fleet.operation_conflict":
      "This saved request differs from its original attempt. Refresh and prepare a new change.",
  };
  return messages[error.code] ?? fallback;
}
async function request<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(`/api/fleet${path}`, {
    credentials: "include",
    ...(body
      ? {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }
      : {}),
  });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new FleetRequestError(
      typeof payload.code === "string" ? payload.code : "fleet.request_failed",
      response.status,
    );
  }
  return response.json();
}
export const fleetClient = {
  savePreference: (
    input: z.infer<typeof FleetWorkspacePreferenceInputSchema>,
  ) => request<unknown>("/preferences", input),
  setup: () => request<FleetSetup>("/setup"),
  saveSetup: (input: z.infer<typeof FleetSetupInputSchema>) =>
    request<unknown>("/setup", input),
  overview: () => request<FleetOverview>("/overview"),
  resources: () => request<FleetResources>("/resources"),
  run: (id: string) => request<FleetRun>(`/runs/${encodeURIComponent(id)}`),
  create: (input: z.infer<typeof CreateFleetRunSchema>) =>
    request<FleetRun>("/runs", input),
  action: (id: string, input: FleetActionInput) =>
    request<FleetRun>(`/runs/${encodeURIComponent(id)}/actions`, input),
};
