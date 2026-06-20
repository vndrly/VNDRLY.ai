import {
  resolveEffectiveTaxTreatment,
  type TaxTreatment,
} from "@workspace/db";
import {
  db,
  partnerVendorWorkTypeApprovalsTable,
  siteLocationsTable,
  vendorWorkTypesTable,
  workTypesTable,
} from "@workspace/db";
import { and, eq } from "drizzle-orm";

export type TicketTaxTreatmentContext = {
  workTypeTaxTreatment: TaxTreatment | null;
  effectiveTaxTreatment: TaxTreatment;
};

export function resolveTicketTaxTreatmentFromRows(args: {
  workTypeTaxTreatment: string | null | undefined;
  vendorWorkTypeTaxTreatment: string | null | undefined;
  partnerWorkTypeTaxTreatment: string | null | undefined;
  workTypeCategory: string | null | undefined;
  siteState: string | null | undefined;
}): TicketTaxTreatmentContext {
  const workTypeTaxTreatment = isTaxTreatment(args.workTypeTaxTreatment)
    ? args.workTypeTaxTreatment
    : null;
  const effectiveTaxTreatment = resolveEffectiveTaxTreatment({
    partnerTreatment: isTaxTreatment(args.partnerWorkTypeTaxTreatment)
      ? args.partnerWorkTypeTaxTreatment
      : null,
    vendorTreatment: isTaxTreatment(args.vendorWorkTypeTaxTreatment)
      ? args.vendorWorkTypeTaxTreatment
      : null,
    workTypeTreatment: workTypeTaxTreatment,
    workTypeCategory: args.workTypeCategory,
    state: args.siteState,
  });
  return { workTypeTaxTreatment, effectiveTaxTreatment };
}

function isTaxTreatment(value: string | null | undefined): value is TaxTreatment {
  return (
    value === "exempt_labor" ||
    value === "taxable_repair_service" ||
    value === "taxable_all"
  );
}

export async function loadTicketTaxTreatmentContext(args: {
  vendorId: number;
  workTypeId: number;
  siteLocationId: number;
}): Promise<TicketTaxTreatmentContext> {
  const [site] = await db
    .select({
      partnerId: siteLocationsTable.partnerId,
      state: siteLocationsTable.state,
    })
    .from(siteLocationsTable)
    .where(eq(siteLocationsTable.id, args.siteLocationId))
    .limit(1);

  const [workType] = await db
    .select({
      category: workTypesTable.category,
      taxTreatment: workTypesTable.taxTreatment,
    })
    .from(workTypesTable)
    .where(eq(workTypesTable.id, args.workTypeId))
    .limit(1);

  const [vendorWorkTypeRow] = await db
    .select({ taxTreatment: vendorWorkTypesTable.taxTreatment })
    .from(vendorWorkTypesTable)
    .where(
      and(
        eq(vendorWorkTypesTable.vendorId, args.vendorId),
        eq(vendorWorkTypesTable.workTypeId, args.workTypeId),
      ),
    )
    .limit(1);

  const [partnerApprovalRow] = site?.partnerId
    ? await db
        .select({ taxTreatment: partnerVendorWorkTypeApprovalsTable.taxTreatment })
        .from(partnerVendorWorkTypeApprovalsTable)
        .where(
          and(
            eq(partnerVendorWorkTypeApprovalsTable.partnerId, site.partnerId),
            eq(partnerVendorWorkTypeApprovalsTable.vendorId, args.vendorId),
            eq(partnerVendorWorkTypeApprovalsTable.workTypeId, args.workTypeId),
          ),
        )
        .limit(1)
    : [undefined];

  return resolveTicketTaxTreatmentFromRows({
    workTypeTaxTreatment: workType?.taxTreatment,
    vendorWorkTypeTaxTreatment: vendorWorkTypeRow?.taxTreatment,
    partnerWorkTypeTaxTreatment: partnerApprovalRow?.taxTreatment,
    workTypeCategory: workType?.category ?? null,
    siteState: site?.state ?? null,
  });
}
