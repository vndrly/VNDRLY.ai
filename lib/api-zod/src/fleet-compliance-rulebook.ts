import { z } from "zod/v4";
/** Research reference only: these classifications are supplied by a designated
 * reviewer, never guessed from a run title, crude description, or GPS point. */
const classification = z
  .object({
    jurisdiction: z.enum(["federal", "OK", "TX"]),
    carrierType: z.enum(["for_hire", "private"]),
    commodity: z.enum([
      "nonhaz_property",
      "ok_restricted_property",
      "ok_deleterious",
      "federal_387_9_1m",
      "federal_387_9_5m",
      "tx_oil_fuel_rule",
      "tx_high_hazard_rule",
      "unclassified",
    ]),
    gvwrLb: z.number().int().positive().nullable(),
    regulatedOperation: z.boolean().nullable(),
    classificationReviewed: z.boolean(),
    carrierAllVehiclesUnder10000: z.boolean().nullable().optional(),
  })
  .strict();
export const FLEET_COMPLIANCE_RESEARCH_AS_OF = "2026-10-16";
export const FLEET_OK_CHAPTER_30_SOURCE =
  "https://oklahoma.gov/content/dam/ok/en/occ/documents/ajls/jls-courts/rules/2026/chapter%2030%20MCC%20and%20Transportation%20Network%20Companies%20_eff%2008-01-2026.pdf";
export function classifyFleetInsuranceReference(input: unknown) {
  const value = classification.parse(input),
    source = {
      url:
        value.jurisdiction === "federal"
          ? "https://www.fmcsa.dot.gov/registration/insurance-filing-requirements"
          : value.jurisdiction === "TX"
            ? "https://www.txdmv.gov/motor-carriers/txdmv-number"
            : FLEET_OK_CHAPTER_30_SOURCE,
      section:
        value.jurisdiction === "federal"
          ? "49 CFR 387; FMCSA filing requirements chart"
          : value.jurisdiction === "TX"
            ? "Insurance Requirements; 43 TAC 218.16"
            : value.carrierType === "private"
              ? "OAC 165:30-15-6"
              : "OAC 165:30-3-11",
      checkedAt: FLEET_COMPLIANCE_RESEARCH_AS_OF,
    };
  const unresolved = {
    status: "needs_review" as const,
    minimumUSD: null,
    source,
  };
  if (
    !value.classificationReviewed ||
    value.regulatedOperation === null ||
    value.commodity === "unclassified"
  )
    return unresolved;
  if (!value.regulatedOperation)
    return { status: "not_applicable" as const, minimumUSD: null, source };
  let minimumUSD: string | null = null;
  if (value.jurisdiction === "federal") {
    if (
      value.commodity === "federal_387_9_1m" &&
      value.carrierType === "for_hire"
    )
      minimumUSD = "1000000";
    else if (value.commodity === "federal_387_9_5m") minimumUSD = "5000000";
    else if (
      value.commodity === "nonhaz_property" &&
      value.carrierType === "for_hire" &&
      value.gvwrLb !== null
    )
      minimumUSD = value.gvwrLb >= 10001 ? "750000" : "300000";
  } else if (value.jurisdiction === "OK") {
    if (value.commodity === "ok_deleterious") minimumUSD = "750000";
    else if (
      value.commodity === "ok_restricted_property" &&
      value.carrierType === "for_hire"
    )
      minimumUSD = "350000";
    else if (value.commodity === "nonhaz_property") {
      if (value.carrierType === "private") minimumUSD = "350000";
      else if (value.gvwrLb !== null) {
        if (
          value.gvwrLb >= 10000 ||
          value.carrierAllVehiclesUnder10000 === false
        )
          minimumUSD = "750000";
        else if (value.carrierAllVehiclesUnder10000 === true)
          minimumUSD = "300000";
      }
    }
  } else {
    if (value.commodity === "tx_oil_fuel_rule") minimumUSD = "1000000";
    else if (value.commodity === "tx_high_hazard_rule") minimumUSD = "5000000";
    else if (
      value.commodity === "nonhaz_property" &&
      value.gvwrLb !== null &&
      value.gvwrLb > 26000
    )
      minimumUSD = "500000";
  }
  return minimumUSD === null
    ? unresolved
    : { status: "reference_only" as const, minimumUSD, source };
}
