export function buildJurisdictionLabel(args: {
  state: string | null | undefined;
  county: string | null | undefined;
  city: string | null | undefined;
  localTaxRate: string;
  combinedTaxRate: string;
}): string {
  const state = args.state?.trim().toUpperCase() ?? "";
  const local = parseFloat(args.localTaxRate);
  const combined = parseFloat(args.combinedTaxRate);
  const pct = (combined * 100).toFixed(2);

  const place =
    args.city?.trim() ||
    (local > 0 && args.county?.trim() ? args.county.trim() : null) ||
    args.county?.trim() ||
    null;

  if (place) {
    return `${place} (${pct}%)`;
  }
  if (state) {
    return `${state} — outside city limits (${pct}%)`;
  }
  return `Combined rate ${pct}%`;
}
