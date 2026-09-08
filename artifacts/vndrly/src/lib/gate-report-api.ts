export interface GateReportEntry {
  id: string;
  kind: "visitor" | "employee_checkin";
  category: string;
  name: string;
  company: string | null;
  purpose: string | null;
  siteLocationId: number;
  siteName: string;
  partnerId: number;
  checkInTime: string;
  checkOutTime: string | null;
  currentOnsite: boolean;
  incomplete: string[];
}
export interface GateReportResult {
  snapshotId: string;
  generatedAt: string;
  filters: { from: string; to: string; siteLocationId: number | null; partnerId: number | null; company: string; purpose: string; category: string; recordKind: string };
  totals: { entries: number; visitorEntries: number; employeeCheckins: number; currentOnsiteEntries: number; uniqueRecordedIdentities: number; unidentifiedEntries: number; incompleteEntries: number; unclassifiedEntries: number; pendingAdmissionEntries: number };
  rows: GateReportEntry[];
  nextOffset: number | null;
}
const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
export async function loadGateReport(filters: Record<string, string>, signal: AbortSignal): Promise<GateReportResult> {
  let result: GateReportResult | undefined;
  const rows: GateReportEntry[] = [];
  let params = new URLSearchParams(filters);
  do {
    const response = await fetch(`${BASE}/api/gate-report?${params}`, { credentials: "include", signal });
    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      throw new Error(body.message || `HTTP ${response.status}`);
    }
    const page = await response.json() as GateReportResult;
    if (result && (result.snapshotId !== page.snapshotId || result.totals.entries !== page.totals.entries)) throw new Error("Report snapshot changed; run the report again");
    result ??= page;
    rows.push(...page.rows);
    if (page.nextOffset === null) break;
    if (page.nextOffset <= rows.length - page.rows.length || page.rows.length === 0) throw new Error("Invalid report pagination");
    params = new URLSearchParams({ snapshotId: page.snapshotId, offset: String(page.nextOffset) });
    // Avoid flooding the shared visit-read rate limiter during large exports.
    await new Promise(resolve => setTimeout(resolve, 500));
    if (signal.aborted) throw new DOMException("Aborted", "AbortError");
  } while (true);
  if (!result || rows.length !== result.totals.entries || new Set(rows.map(row => row.id)).size !== rows.length) throw new Error("Report is incomplete; run the report again");
  return { ...result, rows, nextOffset: null };
}
