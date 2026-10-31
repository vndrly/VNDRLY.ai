import type { db as database } from "@workspace/db";

export type TicketCommercialRate = {
  afe: string | null;
  unitPrice: string;
  unit: string;
  currency: string;
  dailyOtHours: string;
  weeklyOtHours: string;
  overtimeMultiplier: string;
  automaticBilling: "hourly_usd" | "manual_billing_required";
};

export function commercialBillingMode(
  terms: Record<string, unknown>,
): TicketCommercialRate["automaticBilling"] {
  const components = terms.rateComponents;
  const hasAdditionalComponents =
    components != null &&
    (typeof components !== "object" || Object.keys(components).length > 0);
  return !hasAdditionalComponents &&
    ["hour", "hourly", "per_hour", "hr"].includes(
      String(terms.unit).toLowerCase(),
    ) &&
    terms.currency === "USD"
    ? "hourly_usd"
    : "manual_billing_required";
}

/** Null is exclusively the legacy path. Marketplace tickets must never fall back. */
export function resolveTicketCommercialRate(
  ticket: { jobOfferId?: number | null; engagementJobOfferId?: number | null },
  snapshot: Record<string, unknown> | null,
  scopeSnapshot?: Record<string, unknown> | null,
): TicketCommercialRate | null {
  if (!ticket.jobOfferId && !ticket.engagementJobOfferId) return null;
  if (!snapshot) throw new Error("marketplace.acceptance_snapshot_required");
  const rules = snapshot.billingRules as Record<string, unknown> | undefined;
  const amount = (value: unknown) => {
    if (
      (typeof value !== "string" && typeof value !== "number") ||
      String(value).trim() === "" ||
      !Number.isFinite(Number(value)) ||
      Number(value) < 0
    )
      throw new Error("marketplace.invalid_commercial_snapshot");
    return String(value);
  };
  if (
    typeof snapshot.unit !== "string" ||
    typeof snapshot.currency !== "string"
  )
    throw new Error("marketplace.invalid_commercial_snapshot");
  return {
    ...snapshot,
    afe: typeof scopeSnapshot?.afeCode === "string" ? scopeSnapshot.afeCode : null,
    unitPrice: amount(snapshot.unitPrice),
    unit: snapshot.unit,
    currency: snapshot.currency,
    dailyOtHours: amount(rules?.dailyOtHours),
    weeklyOtHours: amount(rules?.weeklyOtHours),
    overtimeMultiplier: amount(rules?.overtimeMultiplier),
    automaticBilling: commercialBillingMode(snapshot),
  };
}

export function requireAutomaticHourlyRate(rate: TicketCommercialRate | null) {
  if (rate?.automaticBilling === "manual_billing_required")
    throw new Error("manual_billing_required");
  return rate;
}

export async function loadTicketCommercialRate(
  ticket: { id: number; jobOfferId?: number | null; engagementJobOfferId?: number | null; vendorId: number; siteLocationId?: number; workTypeId?: number },
  connection?: Pick<typeof database, "select">,
) {
  if (!ticket.jobOfferId && !ticket.engagementJobOfferId) return null;
  const {
    db,
    jobOfferAcceptanceSnapshotsTable: snapshots,
    jobOffersTable: offers,
  } = await import("@workspace/db");
  const { and, eq } = await import("drizzle-orm");
  const [row] = await (connection ?? db)
    .select({ terms: snapshots.commercialSnapshot, scope: snapshots.scopeSnapshot })
    .from(snapshots)
    .innerJoin(offers, eq(offers.id, snapshots.jobOfferId))
    .where(
      and(
        eq(offers.id, ticket.engagementJobOfferId ?? ticket.jobOfferId!),
        ticket.engagementJobOfferId ? undefined : eq(offers.createdTicketId, ticket.id),
        ticket.siteLocationId == null ? undefined : eq(offers.siteLocationId, ticket.siteLocationId),
        ticket.workTypeId == null ? undefined : eq(offers.workTypeId, ticket.workTypeId),
        eq(offers.vendorId, ticket.vendorId),
        eq(offers.status, "accepted"),
      ),
    );
  return resolveTicketCommercialRate(ticket, row?.terms ?? null, row?.scope);
}
