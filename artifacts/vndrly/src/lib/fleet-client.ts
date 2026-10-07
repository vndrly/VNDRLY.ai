import type {
  FleetSupportChoices,
  FleetSupportRead,
  FleetSiteChoices,
  FleetSiteActivity,
  FleetOverview,
  FleetRun,
  FleetResources,
  FleetActionInput,
  FleetSetup,
  FleetMaintenancePage,
  FleetMaintenanceRecord,
  FleetMaintenanceCreate,
  FleetMaintenanceAction,
  FleetReport,
  FleetReportFilter,
  FleetSavedView,
  FleetGateObservations,
  FleetGateLink,
} from "@workspace/api-zod";
import {
  CreateFleetRunSchema,
  FleetSetupInputSchema,
  FleetWorkspacePreferenceInputSchema,
  FleetSavedViewInputSchema,
  FleetReportSchema,
  FleetEtaSchema,
  FleetDraftEditSchema,
  FleetMaintenanceRecordSchema,
  FleetGateLinkInputSchema,
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
async function request<T>(
  path: string,
  body?: unknown,
  method = "POST",
): Promise<T> {
  const response = await fetch(`/api/fleet${path}`, {
    credentials: "include",
    ...(body
      ? {
          method,
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
  editDraft: (id: string, input: z.infer<typeof FleetDraftEditSchema>) =>
    request<FleetRun>(`/runs/${encodeURIComponent(id)}/draft`, input, "PATCH"),
  eta: (id: string) =>
    request<unknown>(`/runs/${encodeURIComponent(id)}/eta`).then((data) =>
      FleetEtaSchema.parse(data),
    ),
  supportChoices: () => request<FleetSupportChoices>("/support"),
  supportCompany: (id: number, cursor?: string) =>
    request<FleetSupportRead>(
      `/support/${id}${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  siteChoices: () => request<FleetSiteChoices>("/site-activity"),
  siteActivity: (
    siteId: number,
    filters: { startsAt?: string; endsAt?: string },
  ) => {
    const query = new URLSearchParams(filters);
    return request<FleetSiteActivity>(
      `/site-activity/${siteId}${query.size ? `?${query}` : ""}`,
    );
  },
  gateObservations: (id: string) =>
    request<FleetGateObservations>(
      `/runs/${encodeURIComponent(id)}/gate-observations`,
    ),
  linkGateVisit: (
    id: string,
    input: z.infer<typeof FleetGateLinkInputSchema>,
  ) =>
    request<FleetGateLink>(`/runs/${encodeURIComponent(id)}/gate-links`, input),
  report: (filters: FleetReportFilter) => {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(filters))
      if (value !== undefined) query.set(key, String(value));
    return request<FleetReport>(
      `/reports${query.size ? `?${query}` : ""}`,
    ).then((data) => FleetReportSchema.parse(data));
  },
  savedViews: () => request<{ views: FleetSavedView[] }>("/views"),
  saveView: (input: z.infer<typeof FleetSavedViewInputSchema>) =>
    request<FleetSavedView>("/views", input),
  maintenance: (cursor?: string) =>
    request<FleetMaintenancePage>(
      `/maintenance${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  maintenanceDetail: (id: string) =>
    request<FleetMaintenanceRecord>(
      `/maintenance/${encodeURIComponent(id)}`,
    ).then((data) => FleetMaintenanceRecordSchema.parse(data)),
  createMaintenance: (input: FleetMaintenanceCreate) =>
    request<FleetMaintenanceRecord>("/maintenance", input).then((data) =>
      FleetMaintenanceRecordSchema.parse(data),
    ),
  maintenanceAction: (id: string, input: FleetMaintenanceAction) =>
    request<FleetMaintenanceRecord>(
      `/maintenance/${encodeURIComponent(id)}/actions`,
      input,
    ).then((data) => FleetMaintenanceRecordSchema.parse(data)),
  savePreference: (
    input: z.infer<typeof FleetWorkspacePreferenceInputSchema>,
  ) => request<unknown>("/preferences", input),
  setup: () => request<FleetSetup>("/setup"),
  saveSetup: (input: z.infer<typeof FleetSetupInputSchema>) =>
    request<unknown>("/setup", input),
  overview: () => request<FleetOverview>("/overview"),
  overviewPage: (cursor?: string) =>
    request<FleetOverview>(
      `/overview${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`,
    ),
  resources: () => request<FleetResources>("/resources"),
  run: (id: string) => request<FleetRun>(`/runs/${encodeURIComponent(id)}`),
  create: (input: z.infer<typeof CreateFleetRunSchema>) =>
    request<FleetRun>("/runs", input),
  action: (id: string, input: FleetActionInput) =>
    request<FleetRun>(`/runs/${encodeURIComponent(id)}/actions`, input),
};
