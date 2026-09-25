import type { SessionPayload } from "../lib/session";
import type { WorkHubCapability, WorkHubOwner } from "@workspace/api-zod";
import { deriveWorkHubCapabilities, WorkHubAccessError } from "./context-access";

export type ExportDataset =
  | "payroll-hours"
  | "quickbooks-time"
  | "inventory-custody"
  | "staffing"
  | "safety-response";

export type WorkHubCapabilities = {
  canUploadFile: boolean;
  canCreateNote: boolean;
  canEditNote: boolean;
  canCreateAsset: boolean;
  canManageAsset: boolean;
  canCheckOutAsset: boolean;
  canVerifyIssuedAsset: boolean;
  canViewExports: boolean;
  allowedExportDatasets: ExportDataset[];
  canManageGateLocations: boolean;
};

const EXPORT_DATASETS: readonly ExportDataset[] = [
  "payroll-hours",
  "quickbooks-time",
  "inventory-custody",
  "staffing",
  "safety-response",
];

export function allowedExportDatasets(capabilities: ReadonlySet<WorkHubCapability>): ExportDataset[] {
  return EXPORT_DATASETS.filter((dataset) => capabilities.has(`export.${dataset}` as WorkHubCapability));
}

export function resolveWorkHubCapabilities(
  viewer: SessionPayload & { userId: number },
  ownerId: number,
): WorkHubCapabilities {
  if (viewer.vendorId !== ownerId && viewer.partnerId !== ownerId)
    throw new WorkHubAccessError("not_found");
  const owner: WorkHubOwner = viewer.vendorId === ownerId
    ? { type: "vendor", id: ownerId }
    : { type: "partner", id: ownerId };
  const grants = new Set(deriveWorkHubCapabilities({
    session: viewer,
    owner,
    context: { kind: "organization", id: ownerId },
    participant: true,
  }));
  const datasets = allowedExportDatasets(grants);
  return {
    canUploadFile: grants.has("file.upload"),
    canCreateNote: grants.has("note.create"),
    canEditNote: grants.has("note.edit"),
    canCreateAsset: grants.has("asset.create"),
    canManageAsset: grants.has("asset.manage"),
    canCheckOutAsset: grants.has("asset.checkout"),
    canVerifyIssuedAsset: grants.has("asset.verify-issued"),
    canViewExports: datasets.length > 0,
    allowedExportDatasets: datasets,
    canManageGateLocations: grants.has("gate.location.manage"),
  };
}
