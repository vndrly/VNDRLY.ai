import { createHash } from "node:crypto";
import { z } from "zod/v4";
import type { PoolClient } from "pg";
import {
  FleetApprovalReferenceSchema,
  FleetPricingBasisSchema,
  FleetRateCardRevisionSchema,
  FleetPricingIntentSchema,
  type FleetPricingIntent,
} from "@workspace/api-zod";
import { parseExactDecimal, formatExact } from "@workspace/db/format";
import {
  resolveFleetCommercialAuthority,
  requireFleetCommercialAuthority,
} from "./fleet-commercial-authority";
import { FleetError } from "./fleet-repository";
import { selectFleetRateAuthority } from "./fleet-pricing";

const positive = z.number().int().positive();
const inputSchema = z
  .object({
    billingContext: z
      .object({
        partnerId: positive,
        billingSiteId: positive,
        afeNumber: z.string().max(200),
        workDate: z.iso.date(),
        currency: z.literal("USD"),
      })
      .strict(),
    serviceId: positive,
    workAt: z.iso.datetime({ offset: true }),
    approvalRef: FleetApprovalReferenceSchema.nullable(),
    purpose: z.enum(["capture", "office_submit"]),
  })
  .strict();
const canonicalDecimal = (value: unknown) => {
  if (typeof value !== "string") return null;
  try {
    const parsed = parseExactDecimal(value);
    return parsed.coefficient < 0n ? null : formatExact(parsed);
  } catch {
    return null;
  }
};
const identity = (key: string) => {
  const h = createHash("sha256").update(key).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-8${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
/** Internal caller owns the real authenticated Fleet/ticket transaction and
 * finance capability. This resolver adds C2's actual current commercial
 * authority, then reads saved partner approvals; no caller supplies a price.
 * Missing/unsupported approval sources remain unpriced, never live-price/zero.
 */
export async function resolveFleetRateAuthority(
  client: PoolClient,
  actor: { companyId: number },
  raw: z.infer<typeof inputSchema>,
): Promise<FleetPricingIntent> {
  const input = inputSchema.parse(raw),
    context = input.billingContext,
    serverNow = new Date().toISOString();
  positive.parse(actor.companyId);
  const authority = requireFleetCommercialAuthority(
    await resolveFleetCommercialAuthority(client, actor, {
      partnerId: context.partnerId,
      billingSiteId: context.billingSiteId,
      workTypeId: input.serviceId,
      workDate: context.workDate,
      purpose: input.purpose,
      policyAt: serverNow,
    }),
  );
  const rows = await client.query(
    "SELECT pw.id,pw.approved_unit_price,pw.precise_unit_price,pw.approved_unit,pw.approved_currency,pw.approved_at,pw.approved_by_user_id,pw.fleet_rate_card,COALESCE(NULLIF(btrim(sw.afe),''),btrim(s.afe),'') AS afe_number FROM partner_vendor_work_type_approvals pw JOIN site_work_assignments sw ON sw.vendor_id=pw.vendor_id AND sw.work_type_id=pw.work_type_id AND sw.site_location_id=$3 JOIN site_locations s ON s.id=sw.site_location_id AND s.partner_id=pw.partner_id WHERE pw.vendor_id=$1 AND pw.partner_id=$2 AND pw.work_type_id=$4 FOR SHARE OF pw,sw,s",
    [
      actor.companyId,
      context.partnerId,
      context.billingSiteId,
      input.serviceId,
    ],
  );
  const row = rows.rows[0],
    unpriced = (
      reason: "approval_required" | "agreement_unresolved",
    ): FleetPricingIntent => ({
      mode: "unpriced",
      reason,
      serviceId: input.serviceId,
      approvalRef: input.approvalRef,
    });
  if (!row) return unpriced("approval_required");
  if (row.afe_number !== context.afeNumber)
    throw new FleetError("fleet.billing_afe_mismatch", 409);
  const price = canonicalDecimal(
      row.precise_unit_price ?? row.approved_unit_price,
    ),
    basis = FleetPricingBasisSchema.safeParse(row.approved_unit),
    approvedBy = positive.safeParse(row.approved_by_user_id);
  const approvedAt = new Date(row.approved_at).toISOString(),
    ref = {
      type: "partner_approval" as const,
      id: String(row.id),
      revision: approvedAt,
    };
  if (
    input.approvalRef &&
    (input.approvalRef.type !== ref.type ||
      input.approvalRef.id !== ref.id ||
      input.approvalRef.revision !== ref.revision)
  )
    return unpriced("agreement_unresolved");
  if (
    price === null ||
    !basis.success ||
    !approvedBy.success ||
    row.approved_currency !== context.currency
  )
    return unpriced("approval_required");
  // A legacy saved approval authorizes its explicit base price only. It does
  // not imply negotiated extras/minimums, an offer's later price or a quote.
  const stored = row.fleet_rate_card
    ? FleetRateCardRevisionSchema.safeParse(row.fleet_rate_card)
    : null;
  if (
    stored &&
    (!stored.success ||
      stored.data.approvalRef.type !== ref.type ||
      stored.data.approvalRef.id !== ref.id ||
      stored.data.approvalRef.revision !== ref.revision ||
      stored.data.approvedByUserId !== approvedBy.data ||
      Date.parse(stored.data.approvedAt) !== Date.parse(approvedAt) ||
      canonicalDecimal(stored.data.unitRate) !== price ||
      stored.data.basis !== basis.data)
  )
    return unpriced("approval_required");
  const card = stored?.success
    ? stored.data
    : FleetRateCardRevisionSchema.parse({
        id: identity(
          `partner-approval:${actor.companyId}:${row.id}:${context.billingSiteId}:${approvedAt}`,
        ),
        version: 1,
        vendorId: actor.companyId,
        partnerId: context.partnerId,
        billingSiteId: context.billingSiteId,
        serviceId: input.serviceId,
        approvalRef: ref,
        basis: basis.data,
        unitRate: price,
        currency: context.currency,
        currencyScale: 2,
        currencyRounding: "half_away_from_zero",
        effectiveFrom: approvedAt,
        effectiveUntil: null,
        approvedByUserId: approvedBy.data,
        approvedAt,
        minimum: null,
        detention: null,
        extras: [],
        notes: "Saved partner service approval; base price only",
      });
  const pricing = selectFleetRateAuthority([card], {
    vendorId: actor.companyId,
    partnerId: context.partnerId,
    billingSiteId: context.billingSiteId,
    serviceId: input.serviceId,
    workAt: input.workAt,
    asOf: serverNow,
  });
  if (pricing.mode === "unpriced")
    return { ...pricing, approvalRef: input.approvalRef };
  const proof = {
    version: 2,
    companyId: actor.companyId,
    billingContext: context,
    pricing,
    commercialAuthoritySnapshotId: authority.approvalSnapshotId,
  };
  const snapshotId = `fleet-rate:${createHash("sha256").update(JSON.stringify(proof)).digest("hex")}`;
  await client.query(
    "INSERT INTO assistant_action_audit(vendor_id,client_surface,input_mode,provider,tool_name,action_type,target_type,target_id,tool_output,result_status) SELECT $1,'fleet','derived','canonical','fleet_rate_authority','rate-authority-snapshot','fleet-rate-authority',$2,$3::jsonb,'completed' WHERE NOT EXISTS(SELECT 1 FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-rate-authority' AND target_id=$2)",
    [actor.companyId, snapshotId, JSON.stringify(proof)],
  );
  return pricing;
}

const retainedInputSchema = inputSchema
  .omit({ approvalRef: true, purpose: true })
  .extend({
    pricing: FleetPricingIntentSchema.options[0],
  })
  .strict();
const retainedProofSchema = z
  .object({
    version: z.literal(2),
    companyId: positive,
    billingContext: inputSchema.shape.billingContext,
    pricing: FleetPricingIntentSchema.options[0],
    commercialAuthoritySnapshotId: z.string().min(1).max(200),
  })
  .strict();
/** Internal finance caller supplies an actual saved activity binding. Current
 * commercial permission is still required; its retained approved price is
 * read from canonical proof, never rebuilt from today's catalog/approval. This
 * alone neither verifies performed work nor approves a financial charge. */
export async function readRetainedFleetRateAuthority(
  client: PoolClient,
  actor: { companyId: number },
  raw: z.infer<typeof retainedInputSchema>,
): Promise<Extract<FleetPricingIntent, { mode: "priced" }>> {
  const input = retainedInputSchema.parse(raw),
    context = input.billingContext;
  requireFleetCommercialAuthority(
    await resolveFleetCommercialAuthority(client, actor, {
      partnerId: context.partnerId,
      billingSiteId: context.billingSiteId,
      workTypeId: input.serviceId,
      workDate: context.workDate,
      purpose: "office_submit",
      policyAt: new Date().toISOString(),
    }),
  );
  const row = (
    await client.query(
      "SELECT target_id,tool_output FROM assistant_action_audit WHERE vendor_id=$1 AND target_type='fleet-rate-authority' AND tool_output->'billingContext'=$2::jsonb AND tool_output->'pricing'=$3::jsonb ORDER BY id DESC LIMIT 1",
      [actor.companyId, JSON.stringify(context), JSON.stringify(input.pricing)],
    )
  ).rows[0];
  if (!row) throw new FleetError("fleet.price_authority_unresolved", 409);
  const parsed = retainedProofSchema.safeParse(row.tool_output);
  if (!parsed.success || parsed.data.companyId !== actor.companyId)
    throw new FleetError("fleet.price_authority_unavailable", 503);
  const proof = parsed.data;
  if (
    row.target_id !==
    `fleet-rate:${createHash("sha256").update(JSON.stringify(proof)).digest("hex")}`
  )
    throw new FleetError("fleet.price_authority_unavailable", 503);
  const selected = selectFleetRateAuthority([proof.pricing.rateCard], {
    vendorId: actor.companyId,
    partnerId: context.partnerId,
    billingSiteId: context.billingSiteId,
    serviceId: input.serviceId,
    workAt: input.workAt,
    asOf: new Date().toISOString(),
  });
  if (selected.mode !== "priced")
    throw new FleetError("fleet.price_authority_unresolved", 409);
  return selected;
}
