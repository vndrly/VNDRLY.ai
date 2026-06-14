/** Display buckets for partner/vendor spend-by-line-type analytics. */
export type AnalyticsLineTypeBucket =
  | "labor"
  | "equipment"
  | "materials"
  | "mileage"
  | "per_diem"
  | "markup"
  | "discount"
  | "other";

export const ANALYTICS_LINE_TYPE_ORDER: readonly AnalyticsLineTypeBucket[] = [
  "labor",
  "equipment",
  "materials",
  "mileage",
  "per_diem",
  "markup",
  "discount",
  "other",
] as const;

export const ANALYTICS_LINE_TYPE_LABELS: Record<AnalyticsLineTypeBucket, string> = {
  labor: "Labor",
  equipment: "Equipment",
  materials: "Materials",
  mileage: "Mileage",
  per_diem: "Per diem",
  markup: "Markup",
  discount: "Discount",
  other: "Other",
};

/** Maps raw `ticket_line_items.type` strings to a stable analytics bucket. */
export function normalizeLineTypeForAnalytics(raw: string): AnalyticsLineTypeBucket {
  const key = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
  switch (key) {
    case "labor":
    case "labor_regular":
    case "labor_overtime":
    case "labor_ot":
    case "overtime":
    case "check_in_labor":
    case "check_in_overtime":
      return "labor";
    case "equipment":
      return "equipment";
    case "material":
    case "materials":
    case "parts":
      return "materials";
    case "mileage":
    case "mileage_auto":
      return "mileage";
    case "per_diem":
    case "perdiem":
      return "per_diem";
    case "markup":
      return "markup";
    case "discount":
      return "discount";
    default:
      return "other";
  }
}

export type AggregatedLineTypeSpend = {
  type: AnalyticsLineTypeBucket;
  label: string;
  total: number;
};

export function aggregateSpendByLineType(
  rows: ReadonlyArray<{ type: string; total: number }>,
  options?: { smallSliceThreshold?: number },
): AggregatedLineTypeSpend[] {
  const buckets = new Map<AnalyticsLineTypeBucket, number>();
  for (const row of rows) {
    const bucket = normalizeLineTypeForAnalytics(row.type);
    buckets.set(bucket, (buckets.get(bucket) ?? 0) + row.total);
  }

  let entries: AggregatedLineTypeSpend[] = ANALYTICS_LINE_TYPE_ORDER.map((type) => ({
    type,
    label: ANALYTICS_LINE_TYPE_LABELS[type],
    total: buckets.get(type) ?? 0,
  })).filter((entry) => entry.total > 0);

  const threshold = options?.smallSliceThreshold ?? 0.02;
  const grandTotal = entries.reduce((sum, entry) => sum + entry.total, 0);
  if (grandTotal > 0 && threshold > 0) {
    let rolledIntoOther = 0;
    entries = entries.filter((entry) => {
      if (entry.type === "other") return true;
      if (entry.total / grandTotal < threshold) {
        rolledIntoOther += entry.total;
        return false;
      }
      return true;
    });
    if (rolledIntoOther > 0) {
      const other = entries.find((entry) => entry.type === "other");
      if (other) {
        other.total += rolledIntoOther;
      } else {
        entries.push({
          type: "other",
          label: ANALYTICS_LINE_TYPE_LABELS.other,
          total: rolledIntoOther,
        });
      }
    }
  }

  return entries.sort((a, b) => b.total - a.total);
}
