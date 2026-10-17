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
  FleetDestinationSaveSchema,
  FleetRunOrderPageSchema,
  FleetRunOrderSchema,
  FleetRunOrderSaveSchema,
  FleetRunOrderReceiptSchema,
  FleetRunOrderHistorySchema,
  FleetRunOrderLocationsSchema,
  FleetComplianceAssessmentsSchema,
  FleetComplianceSubjectsQuerySchema,
  FleetComplianceRegisterQuerySchema,
  FleetComplianceRegisterPageSchema,
  FleetComplianceRecordSchema,
  FleetComplianceVerifySchema,
  FleetComplianceRecordReceiptSchema,
  FleetComplianceConfigurationViewSchema,
  FleetComplianceReviewerSaveSchema,
  FleetDestinationReceiptSchema,
  FleetDestinationDirectorySchema,
  FleetDetailPageSchema,
  FleetRigPackagePageSchema,
  FleetResourceReceiptSchema,
  FleetDetailSchema,
  FleetRigPackageSchema,
  FleetInventorySchema,
  FleetInventoryDetailSchema,
  FleetInventoryReceiptSchema,
  FleetAssetCreateSchema,
  FleetAssetEnrollmentSchema,
  FleetAssetEditSchema,
  FleetReviewPacketSchema,
  FleetReplacementInputSchema,
  FleetReplacementActionSchema,
  FleetReplacementSchema,
  FleetCargoTransferInputSchema,
  FleetCargoTransferActionSchema,
  FleetCargoTransferSchema,
  CreateFleetRunSchema,
  FleetSetupInputSchema,
  FleetWorkspacePreferenceInputSchema,
  FleetSavedViewInputSchema,
  FleetReportSchema,
  FleetEtaSchema,
  FleetDraftEditSchema,
  FleetEvidenceInputSchema,
  FleetEvidenceSchema,
  FleetMaintenanceRecordSchema,
  FleetGateLinkInputSchema,
} from "@workspace/api-zod";
import type { z } from "zod/v4";
import type {
  FleetBillingOptions,
  FleetBillingTicket,
} from "@/components/fleet-billing";
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
      "Choose a current driver from the company's available pool with access to this Detail's resource group.",
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
  runOrders:(after?:number)=>request<unknown>(`/run-orders${after?`?after=${after}`:""}`).then(value=>FleetRunOrderPageSchema.parse(value)),
  runOrder:(id:string)=>request<unknown>(`/run-orders/${encodeURIComponent(id)}`).then(value=>FleetRunOrderSchema.parse(value)),
  runOrderLocations:(id:string)=>request<unknown>(`/run-orders/${encodeURIComponent(id)}/locations`).then(value=>FleetRunOrderLocationsSchema.parse(value)),
  assessCompliance:(subjects:z.input<typeof FleetComplianceSubjectsQuerySchema>["subjects"])=>request<unknown>("/compliance/assessments",FleetComplianceSubjectsQuerySchema.parse({subjects})).then(value=>FleetComplianceAssessmentsSchema.parse(value)),
  complianceRegister:(query:z.input<typeof FleetComplianceRegisterQuerySchema>={})=>{
    const parsed=FleetComplianceRegisterQuerySchema.parse(query),params=new URLSearchParams();
    Object.entries(parsed).forEach(([key,value])=>{if(value!==undefined)params.set(key,String(value));});
    return request<unknown>(`/compliance?${params}`).then(value=>FleetComplianceRegisterPageSchema.parse(value));
  },
  privateComplianceRecord:(id:string,revision:number)=>request<unknown>(`/compliance/${encodeURIComponent(id)}/private?revision=${revision}`).then(value=>FleetComplianceRecordSchema.parse(value)),
  reviewCompliance:(input:z.input<typeof FleetComplianceVerifySchema>)=>request<unknown>(`/compliance/${encodeURIComponent(input.evidenceId)}/review`,FleetComplianceVerifySchema.parse(input)).then(value=>FleetComplianceRecordReceiptSchema.parse(value)),
  complianceConfiguration:()=>request<unknown>("/compliance/configuration").then(value=>FleetComplianceConfigurationViewSchema.parse(value)),
  saveComplianceReviewers:(input:z.input<typeof FleetComplianceReviewerSaveSchema>)=>request<unknown>("/compliance/reviewers",FleetComplianceReviewerSaveSchema.parse(input)).then(value=>FleetComplianceConfigurationViewSchema.pick({version:true,reviewerUserIds:true}).parse(value)),
  saveRunOrder:(input:z.input<typeof FleetRunOrderSaveSchema>)=>request<unknown>("/run-orders",FleetRunOrderSaveSchema.parse(input)).then(value=>FleetRunOrderSchema.parse(value)),
  runOrderReceipt:(id:string)=>request<unknown>(`/run-orders/operations/${encodeURIComponent(id)}`).then(value=>FleetRunOrderReceiptSchema.parse(value)),
  runOrderHistory:(id:string,after?:number)=>request<unknown>(`/run-orders/${encodeURIComponent(id)}/history${after?`?after=${after}`:""}`).then(value=>FleetRunOrderHistorySchema.parse(value)),
  commercial: (siteId?:number) =>
    request<unknown>(`/commercial${siteId?`?siteId=${siteId}`:""}`).then((value) =>
      FleetDestinationDirectorySchema.parse(value),
    ),
  saveDestination: (input: z.infer<typeof FleetDestinationSaveSchema>) =>
    request<unknown>(
      "/destinations",
      FleetDestinationSaveSchema.parse(input),
    ).then((value) => FleetDestinationReceiptSchema.parse(value)),
  details: (after?: string) =>
    request<unknown>(
      `/details${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    ).then((value) => FleetDetailPageSchema.parse(value)),
  rigPackages: (after?: string) =>
    request<unknown>(
      `/rig-packages${after ? `?after=${encodeURIComponent(after)}` : ""}`,
    ).then((value) => FleetRigPackagePageSchema.parse(value)),
  saveDetail: (input: {
    operationId: string;
    expectedVersion: number;
    detail: import("@workspace/api-zod").FleetDetail;
  }) =>
    request<unknown>("/details", input).then((value) =>
      FleetDetailSchema.parse(value),
    ),
  saveRigPackage: (input: {
    operationId: string;
    expectedVersion: number;
    package: import("@workspace/api-zod").FleetRigPackage;
  }) =>
    request<unknown>("/rig-packages", input).then((value) =>
      FleetRigPackageSchema.parse(value),
    ),
  billingOptions: (
    siteId: number,
    afeNumber: string,
    workDate: string,
    fleetId?: string,
  ) =>
    request<FleetBillingOptions>(
      `/billing-options?${new URLSearchParams({ siteId: String(siteId), afeNumber, workDate, ...(fleetId ? { fleetId } : {}) })}`,
    ),
  billingTicket: (ticketId: number) =>
    request<FleetBillingTicket>(`/tickets/${ticketId}/plan`),
  finalizeBillingTicket: (
    ticketId: number,
    input: { operationId: string; expectedVersion: number },
  ) =>
    request<{ ticketId: number; status: string; operationId: string }>(
      `/tickets/${ticketId}/finalize`,
      input,
    ),
  inventory: (after?: string, fleetId?: string) => {
    const params = new URLSearchParams({
      ...(after ? { after } : {}),
      ...(fleetId ? { fleetId } : {}),
    });
    return request<unknown>(
      `/inventory${params.size ? `?${params}` : ""}`,
    ).then((value) => FleetInventorySchema.parse(value));
  },
  inventoryAsset: (id: string) =>
    request<unknown>(`/inventory/${encodeURIComponent(id)}`).then((value) =>
      FleetInventoryDetailSchema.parse(value),
    ),
  createAsset: (input: z.infer<typeof FleetAssetCreateSchema>) =>
    request<unknown>("/inventory", FleetAssetCreateSchema.parse(input)).then(
      (value) => FleetInventoryReceiptSchema.parse(value),
    ),
  enrollAsset: (
    id: string,
    input: z.infer<typeof FleetAssetEnrollmentSchema>,
  ) =>
    request<unknown>(
      `/inventory/${encodeURIComponent(id)}/enroll`,
      FleetAssetEnrollmentSchema.parse(input),
    ).then((value) => FleetInventoryReceiptSchema.parse(value)),
  editAsset: (id: string, input: z.infer<typeof FleetAssetEditSchema>) =>
    request<unknown>(
      `/inventory/${encodeURIComponent(id)}`,
      FleetAssetEditSchema.parse(input),
      "PATCH",
    ).then((value) => FleetInventoryReceiptSchema.parse(value)),
  reviewPacket: (id: string) =>
    request<unknown>(`/runs/${encodeURIComponent(id)}/review-packet`).then(
      (value) => FleetReviewPacketSchema.parse(value),
    ),
  evidence: (id: string) =>
    request<{ runId: string; evidence: unknown[] }>(
      `/runs/${encodeURIComponent(id)}/evidence`,
    ).then((data) => ({
      runId: data.runId,
      evidence: data.evidence.map((item) => FleetEvidenceSchema.parse(item)),
    })),
  addEvidence: (id: string, input: z.infer<typeof FleetEvidenceInputSchema>) =>
    request<unknown>(`/runs/${encodeURIComponent(id)}/evidence`, input).then(
      (data) => FleetEvidenceSchema.parse(data),
    ),
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
  replacements: (id: string) =>
    request<{ runId: string; replacements: unknown[] }>(
      `/runs/${encodeURIComponent(id)}/replacements`,
    ).then((value) => ({
      runId: value.runId,
      replacements: value.replacements.map((item) =>
        FleetReplacementSchema.parse(item),
      ),
    })),
  proposeReplacement: (
    id: string,
    input: z.infer<typeof FleetReplacementInputSchema>,
  ) =>
    request<unknown>(
      `/runs/${encodeURIComponent(id)}/replacements`,
      input,
    ).then((value) => FleetReplacementSchema.parse(value)),
  replacementAction: (
    id: string,
    replacementId: string,
    input: z.infer<typeof FleetReplacementActionSchema>,
  ) =>
    request<unknown>(
      `/runs/${encodeURIComponent(id)}/replacements/${encodeURIComponent(replacementId)}/actions`,
      input,
    ).then((value) => FleetReplacementSchema.parse(value)),
  cargoTransfers: (id: string) =>
    request<{ runId: string; transfers: unknown[] }>(
      `/runs/${encodeURIComponent(id)}/cargo-transfers`,
    ).then((value) => ({
      runId: value.runId,
      transfers: value.transfers.map((item) =>
        FleetCargoTransferSchema.parse(item),
      ),
    })),
  cargoTransfer: (id: string) =>
    request<unknown>(`/cargo-transfers/${encodeURIComponent(id)}`).then(
      (value) => FleetCargoTransferSchema.parse(value),
    ),
  proposeCargo: (input: z.infer<typeof FleetCargoTransferInputSchema>) =>
    request<unknown>("/cargo-transfers", input).then((value) =>
      FleetCargoTransferSchema.parse(value),
    ),
  cargoAction: (
    id: string,
    input: z.infer<typeof FleetCargoTransferActionSchema>,
  ) =>
    request<unknown>(
      `/cargo-transfers/${encodeURIComponent(id)}/actions`,
      input,
    ).then((value) => FleetCargoTransferSchema.parse(value)),
  resources: () => request<FleetResources>("/resources"),
  run: (id: string) => request<FleetRun>(`/runs/${encodeURIComponent(id)}`),
  create: (input: z.infer<typeof CreateFleetRunSchema>) =>
    request<FleetRun>("/runs", input),
  action: (id: string, input: FleetActionInput) =>
    request<FleetRun>(`/runs/${encodeURIComponent(id)}/actions`, input),
};
