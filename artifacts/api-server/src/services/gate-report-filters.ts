export type GateReportRange = "current_shift" | "previous_shift" | "24h" | "7d" | "14d" | "30d" | "90d" | "1y" | "custom";
export type GateReportRecordType = "all" | "arrivals" | "check_ins" | "check_outs" | "on_site" | "visitors_on_site" | "employees_on_site" | "vehicles_on_site" | "pending" | "needs_review";
export type GateReportKind = "history" | "shift_notes";
export type GateReportFormat = "pdf" | "excel" | "word";
export type GateReportFilters = {
  siteId: number;
  siteIds?: number[];
  stationId?: string;
  range: GateReportRange;
  recordType: GateReportRecordType;
  search?: string;
  recordId?: string;
  from?: string;
  to?: string;
};
export class GateReportsError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

const fail = (status: number, code: string): never => { throw new GateReportsError(status, code); };
const ranges: GateReportRange[] = ["current_shift", "previous_shift", "24h", "7d", "14d", "30d", "90d", "1y", "custom"];
const recordTypes: GateReportRecordType[] = ["all", "arrivals", "check_ins", "check_outs", "on_site", "visitors_on_site", "employees_on_site", "vehicles_on_site", "pending", "needs_review"];

export function parseGateReportFilters(input: Partial<Record<keyof GateReportFilters, unknown>>): GateReportFilters {
  const siteId = Number(input.siteId);
  if (!Number.isSafeInteger(siteId) || siteId <= 0) fail(400, "gate_report.invalid_site");
  const requestedSites = typeof input.siteIds === "string" ? input.siteIds.split(",").map(Number) : input.siteIds;
  if (requestedSites !== undefined && (!Array.isArray(requestedSites) || !requestedSites.length || requestedSites.length > 100 || requestedSites.some(id => !Number.isSafeInteger(id) || id <= 0))) fail(400, "gate_report.invalid_sites");
  const siteIds = requestedSites === undefined ? undefined : [...new Set(requestedSites as number[])];
  if (siteIds && !siteIds.includes(siteId)) fail(400, "gate_report.invalid_sites");
  const range = String(input.range ?? "current_shift") as GateReportRange;
  if (!ranges.includes(range)) fail(400, "gate_report.invalid_range");
  let window: { from: string; to: string } | undefined;
  if (range === "custom") {
    const from = typeof input.from === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(input.from) ? Date.parse(input.from) : NaN;
    const to = typeof input.to === "string" && /(?:Z|[+-]\d{2}:\d{2})$/i.test(input.to) ? Date.parse(input.to) : NaN;
    if (!Number.isFinite(from) || !Number.isFinite(to) || to <= from || to - from > 366 * 86_400_000) fail(400, "gate_report.invalid_time_window");
    window = { from: new Date(from).toISOString(), to: new Date(to).toISOString() };
  }
  const recordType = String(input.recordType ?? "all") as GateReportRecordType;
  if (!recordTypes.includes(recordType)) fail(400, "gate_report.invalid_record_type");
  const stationId = typeof input.stationId === "string" && input.stationId.trim() ? input.stationId.trim() : undefined;
  const search = typeof input.search === "string" && input.search.trim() ? input.search.trim().slice(0, 200) : undefined;
  const recordId = typeof input.recordId === "string" ? input.recordId.trim() : undefined;
  if (input.recordId !== undefined && (!recordId || !/^(visit|employee):[1-9]\d*$/.test(recordId))) fail(400, "gate_report.invalid_record_id");
  return { siteId, ...(siteIds ? { siteIds } : {}), ...(stationId ? { stationId } : {}), range, recordType, ...(window ?? {}), ...(search ? { search } : {}), ...(recordId ? { recordId } : {}) };
}

