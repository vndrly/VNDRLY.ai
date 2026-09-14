import { createHash } from "node:crypto";

export type ImplementationAExportDataset = "payroll" | "quickbooks-time" | "assets" | "staffing" | "safety";
export type ImplementationAExportScope = { ownerOrgId: number; managedOrganizationId?: string; siteIds?: number[] };
type ExportRow = Record<string, unknown> & { ownerOrgId: number; managedOrganizationId?: string; siteId?: number };

const HEADERS: Record<ImplementationAExportDataset, string[]> = {
  payroll: ["worker", "employer", "sponsor", "site", "hours"],
  "quickbooks-time": ["worker", "employer", "sponsor", "site", "hours"],
  assets: ["assetId", "name", "category", "status", "holder", "condition"],
  staffing: ["assignmentId", "worker", "employer", "sponsor", "site", "startsAt", "endsAt", "status"],
  safety: ["eventId", "reportedAt", "severity", "status", "acknowledgement"],
};

const quote = (value: unknown) => {
  const raw = value == null ? "" : String(value);
  const text = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function visible(row: ExportRow, scope: ImplementationAExportScope) {
  if (row.ownerOrgId !== scope.ownerOrgId) return false;
  if (scope.managedOrganizationId && row.managedOrganizationId !== scope.managedOrganizationId) return false;
  if (scope.siteIds?.length && (typeof row.siteId !== "number" || !scope.siteIds.includes(row.siteId))) return false;
  return true;
}

export function buildImplementationAExport(input: {
  dataset: ImplementationAExportDataset;
  scope: ImplementationAExportScope;
  rows: ExportRow[];
  includeSensitivePayroll?: boolean;
}) {
  const headers = [...HEADERS[input.dataset]];
  if (input.includeSensitivePayroll && ["payroll", "quickbooks-time"].includes(input.dataset)) headers.push("payRate");
  const rows = input.rows.filter((row) => visible(row, input.scope));
  const csv = [headers.join(","), ...rows.map((row) => headers.map((header) => quote(row[header])).join(","))].join("\r\n") + "\r\n";
  const sha256 = createHash("sha256").update(csv, "utf8").digest("hex");
  return {
    headers,
    rows: rows.map((row) => Object.fromEntries(headers.map((header) => [header, row[header] ?? null]))),
    csv,
    sha256,
    audit: { dataset: input.dataset, format: "csv", scope: input.scope, rowCount: rows.length, hash: sha256, result: "completed" as const },
  };
}

export function previewImplementationAExport(input: { dataset: ImplementationAExportDataset; scope: ImplementationAExportScope; includeSensitivePayroll?: boolean }) {
  const headers = [...HEADERS[input.dataset]];
  if (input.includeSensitivePayroll && ["payroll", "quickbooks-time"].includes(input.dataset)) headers.push("payRate");
  return {
    dataset: input.dataset,
    format: "csv" as const,
    scope: input.scope,
    headers,
    excludedSensitiveFields: input.includeSensitivePayroll ? [] : input.dataset === "assets" ? ["incidentDetail"] : ["payRate", "wages", "taxData"],
  };
}
