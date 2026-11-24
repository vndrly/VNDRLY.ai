export type AskVRevenueCall = { name: string; input: unknown; output: string };
export type AskVRevenueComparison = {
  title: string;
  years: [string, string];
  totals: [number, number];
  rows: Array<{ label: string; previous: number; current: number }>;
};

type RevenueResult = { role?: string; preset?: string; periodLabel?: string; breakdown?: string; rows?: unknown };

function parseCall(call: AskVRevenueCall) {
  if (call.name !== "query_revenue_summary") return null;
  let result: RevenueResult;
  try { result = JSON.parse(call.output) as RevenueResult; } catch { return null; }
  const preset = result.preset ?? (typeof call.input === "object" && call.input !== null ? (call.input as { preset?: string }).preset : undefined);
  if ((preset !== "ytd" && preset !== "last_year") || !Array.isArray(result.rows)) return null;
  const rows = new Map<string, number>();
  for (const item of result.rows) {
    if (!item || typeof item !== "object") return null;
    const row = item as Record<string, unknown>;
    const label = row.workTypeName ?? row.partnerName ?? row.vendorName ?? row.siteName;
    const amount = row.amount ?? row.total;
    if (typeof label !== "string" || label.length > 120 || (typeof amount !== "string" && typeof amount !== "number")) return null;
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) return null;
    rows.set(label, (rows.get(label) ?? 0) + value);
  }
  return { preset, role: result.role, breakdown: result.breakdown, label: result.periodLabel, rows };
}

/** Build a chart only from two authorized, matching data-tool receipts. */
export function askVRevenueComparison(calls: AskVRevenueCall[] | undefined): AskVRevenueComparison | null {
  if (!calls) return null;
  const parsed = calls.map(parseCall).filter((value): value is NonNullable<typeof value> => value !== null);
  const previous = parsed.find(call => call.preset === "last_year");
  const current = parsed.find(call => call.preset === "ytd" && call.role === previous?.role && call.breakdown === previous?.breakdown);
  if (!previous || !current || !previous.label || !current.label) return null;
  const labels = new Set([...previous.rows.keys(), ...current.rows.keys()]);
  const rows = [...labels].map(label => ({ label, previous: previous.rows.get(label) ?? 0, current: current.rows.get(label) ?? 0 }));
  rows.sort((a, b) => b.current - a.current || b.previous - a.previous);
  return {
    title: `${current.role === "partner" ? "Spend" : "Revenue"} by ${current.breakdown === "vendor" ? "vendor" : current.breakdown === "partner" ? "partner" : current.breakdown === "site" ? "site" : "work type"}`,
    years: [previous.label, current.label],
    totals: [rows.reduce((sum, row) => sum + row.previous, 0), rows.reduce((sum, row) => sum + row.current, 0)],
    rows: rows.slice(0, 20),
  };
}
