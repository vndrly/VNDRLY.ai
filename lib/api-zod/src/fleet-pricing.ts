import { z } from "zod/v4";
import { FleetTimeZoneSchema } from "./fleet-details";

export const FleetExactDecimalSchema = z.string().regex(/^-?(?:0|[1-9]\d{0,14})(?:\.\d{1,9})?$/, "Exact numeric(24,9) decimal string required");
const nonnegativeDecimal = FleetExactDecimalSchema.refine(value => !value.startsWith("-") || /^-0(?:\.0+)?$/.test(value), "Nonnegative decimal required");
const positiveDecimal = nonnegativeDecimal.refine(value => /[1-9]/.test(value), "Positive decimal required");
const timestamp = z.iso.datetime({ offset: true });
const positiveId = z.number().int().positive();
export const FleetPricingBasisSchema = z.enum(["per_job", "per_hour", "per_day", "lump_sum", "per_load", "per_mile", "per_barrel", "per_us_gallon", "per_short_ton"]);
export const FleetQuantityUnitSchema = z.enum(["run", "load", "hour", "day", "mile", "barrel", "us_gallon", "short_ton", "flat"]);
export const FleetApprovalReferenceSchema = z.object({ type: z.enum(["partner_approval", "site_agreement", "approved_quote", "authorized_catalog", "legacy"]), id: z.string().trim().min(1).max(200), revision: z.string().trim().min(1).max(200) }).strict();
export const FleetAdditionalChargeKindSchema = z.enum(["detention", "mobilization", "deadhead", "return", "additional_equipment", "after_hours", "toll", "permit", "disposal", "fuel_surcharge", "reimbursement", "cleaning", "cancellation"]);
export const FleetRateCardRevisionSchema = z.object({
  id: z.uuid(), version: positiveId, vendorId: positiveId, serviceId: positiveId, partnerId: positiveId.nullable(), billingSiteId: positiveId.nullable(),
  approvalRef: FleetApprovalReferenceSchema, basis: FleetPricingBasisSchema, unitRate: nonnegativeDecimal, currency: z.literal("USD"), currencyScale: z.literal(2), currencyRounding: z.literal("half_away_from_zero"),
  effectiveFrom: timestamp, effectiveUntil: timestamp.nullable(), approvedByUserId: positiveId, approvedAt: timestamp,
  minimum: z.object({ amount: nonnegativeDecimal, scope: z.enum(["run", "load", "day", "ticket"]) }).strict().nullable(),
  detention: z.object({ ratePerHour: nonnegativeDecimal, freeMinutes: nonnegativeDecimal, incrementMinutes: positiveDecimal, rounding: z.enum(["half_away_from_zero", "toward_zero", "away_from_zero"]), allowHourlyOverlap: z.boolean() }).strict().nullable(),
  extras: z.array(z.object({ code: z.string().trim().min(1).max(100), kind: FleetAdditionalChargeKindSchema, basis: z.enum(["flat", "per_unit", "percent"]), rate: nonnegativeDecimal, unit: FleetQuantityUnitSchema.nullable(), eligibleChargeCodes: z.array(z.string().min(1).max(100)), requiresApproval: z.boolean(), agreementReference: z.string().trim().min(1).max(500) }).strict()),
  notes: z.string().max(2000),
}).strict().superRefine((value, ctx) => {
  if (value.effectiveUntil && Date.parse(value.effectiveUntil) <= Date.parse(value.effectiveFrom)) ctx.addIssue({ code: "custom", path: ["effectiveUntil"], message: "Rate end must follow start" });
  if (new Set(value.extras.map(row => row.code)).size !== value.extras.length) ctx.addIssue({ code: "custom", path: ["extras"], message: "Additional charge codes must be unique" });
  for (const extra of value.extras) {
    if (extra.basis === "percent" && !extra.eligibleChargeCodes.length) ctx.addIssue({ code: "custom", path: ["extras"], message: "Percentage charges need named eligible charge codes" });
    if (extra.basis === "per_unit" && extra.unit === null) ctx.addIssue({ code: "custom", path: ["extras"], message: "Unit charge requires its explicit unit" });
  }
});
export type FleetRateCardRevision = z.infer<typeof FleetRateCardRevisionSchema>;
/** Partner-owned agreement terms; identity, approver and revision are server facts. */
export const FleetAgreementTermsSchema = FleetRateCardRevisionSchema.pick({ basis:true,unitRate:true,effectiveFrom:true,effectiveUntil:true,minimum:true,detention:true,extras:true,notes:true });
export const SaveFleetAgreementSchema = z.object({ operationId:z.uuid(), expectedApprovalRevision:z.string().min(1).max(200), terms:FleetAgreementTermsSchema }).strict();
export type SaveFleetAgreement = z.infer<typeof SaveFleetAgreementSchema>;

export const FleetPricingIntentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("priced"), rateCard: FleetRateCardRevisionSchema }).strict(),
  z.object({ mode: z.literal("unpriced"), reason: z.enum(["offline_reference_missing", "agreement_unresolved", "service_unresolved", "approval_required"]), serviceId: positiveId.nullable(), approvalRef: FleetApprovalReferenceSchema.nullable() }).strict(),
]);
export type FleetPricingIntent = z.infer<typeof FleetPricingIntentSchema>;
export const FleetQuantityEvidenceSchema = z.object({ id: z.uuid(), cycleId: z.uuid().nullable(), kind: z.enum(["planned", "picked_up", "delivered", "accepted", "billable"]), quantity: nonnegativeDecimal, unit: FleetQuantityUnitSchema, source: z.enum(["meter", "scale", "manifest", "recipient", "manual", "reviewed_conversion"]), evidenceReferences: z.array(z.string().trim().min(1).max(1000)), capturedAt: timestamp, recordedByUserId: positiveId, conversion: z.object({ originalQuantity: nonnegativeDecimal, originalUnit: FleetQuantityUnitSchema, factor: positiveDecimal, divisor:positiveDecimal.optional(), rounding:z.enum(["half_away_from_zero","toward_zero","away_from_zero"]).optional(), reviewedByUserId: positiveId, reviewedAt: timestamp }).strict().optional() }).strict().superRefine((value, ctx) => {
  if ((value.source === "reviewed_conversion") !== Boolean(value.conversion)) ctx.addIssue({ code: "custom", path: ["conversion"], message: "Conversion source and reviewed factor must be recorded together" });
});
export type FleetQuantityEvidence = z.infer<typeof FleetQuantityEvidenceSchema>;
/** A reviewer selects retained source identities, never replaces the driver's
 * original quantity or supplies a different reviewer identity. */
export const FleetQuantityReviewSelectionSchema = z.object({
  evidenceId: z.uuid(), expectedReviewRevision: z.number().int().nonnegative(),
  decision: z.enum(["accept_as_billable", "reject"]),
  reason: z.string().trim().min(1).max(2000),
  conversion:z.object({unit:FleetQuantityUnitSchema,factor:positiveDecimal,divisor:positiveDecimal,rounding:z.enum(["half_away_from_zero","toward_zero","away_from_zero"])}).strict().optional(),
}).strict();
export const FleetQuantityReviewSchema = z.object({
  version: z.literal(2), revision: positiveId, operationId: z.uuid(), vendorId: positiveId,
  evidenceId: z.uuid(), reportOperationId: z.uuid(), reportFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
  activityId: z.uuid(), originalActivityVersion: positiveId, ticketId: positiveId,
  decision: z.enum(["accept_as_billable", "reject"]), reason: z.string().trim().min(1).max(2000),
  reviewedByUserId: positiveId, reviewedAt: timestamp,
  reportedReviewAt: timestamp, reportedReviewTimeZone: FleetTimeZoneSchema,
  quantity: FleetQuantityEvidenceSchema.nullable(), independentInstrumentVerification: z.literal(false),
}).strict().superRefine((value, ctx) => {
  if ((value.decision === "accept_as_billable") !== (value.quantity !== null) ||
      (value.quantity && (value.quantity.kind !== "billable" || value.quantity.id !== value.evidenceId)))
    ctx.addIssue({ code: "custom", message: "Endorsement requires its exact original report identity; rejection has no billable quantity" });
});
export type FleetQuantityReview = z.infer<typeof FleetQuantityReviewSchema>;
export const FleetChargeSchema = z.object({
  billingContext:z.object({vendorId:positiveId,partnerId:positiveId,billingSiteId:positiveId,afeNumber:z.string().max(200),workDate:z.iso.date(),minimumGroupKey:z.string().min(1).max(500)}).strict().optional(),
  calculation:z.object({kind:z.literal("detention_minutes"),billableMinutes:nonnegativeDecimal,ratePerHour:nonnegativeDecimal,quantityDisplayScale:z.literal(9),amountDisplayScale:z.literal(36)}).strict().optional(),
  id: z.uuid(), revision: positiveId, code: z.string().trim().min(1).max(100), ticketId: positiveId, runId: z.uuid().nullable(), cycleId: z.uuid().nullable(), serviceId: positiveId,
  kind: z.enum(["primary", "minimum_top_up", "adjustment", ...FleetAdditionalChargeKindSchema.options]),
  description: z.string().trim().min(1).max(2000), quantity: FleetExactDecimalSchema, unit: FleetQuantityUnitSchema, unitRate: nonnegativeDecimal,
  exactAmount: z.string().max(140).regex(/^-?(?:0|[1-9]\d{0,63})(?:\.\d{1,72})?$/), currencyAmount: z.string().regex(/^-?(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/), currency: z.literal("USD"),
  rateCardId: z.uuid(), rateCardVersion: positiveId, approvalRef: FleetApprovalReferenceSchema, quantityEvidenceIds: z.array(z.uuid()),
  eligibleChargeIds: z.array(z.uuid()), adjustsChargeId: z.uuid().nullable(), taxTreatment: z.string().trim().min(1).max(100),
  reviewedByUserId: positiveId.nullable(), reviewedAt: timestamp.nullable(),
}).strict().superRefine((value, ctx) => {
  if (value.kind !== "adjustment" && (value.quantity.startsWith("-") || value.exactAmount.startsWith("-") || value.currencyAmount.startsWith("-"))) ctx.addIssue({ code: "custom", message: "Only an explicit adjustment can carry a negative charge" });
  if ((value.reviewedAt === null) !== (value.reviewedByUserId === null)) ctx.addIssue({ code: "custom", path: ["reviewedAt"], message: "Review requires both actor and time" });
});
export type FleetCharge = z.infer<typeof FleetChargeSchema>;
export const FleetTicketBillingV2Schema = z.object({ billingVersion:z.literal(2),legacyPlanReference:z.string().regex(/^fleet-legacy-plan:[a-f0-9]{64}$/).optional(),version: z.literal(2), revision: positiveId, vendorId: positiveId, partnerId: positiveId, billingSiteId: positiveId, afeNumber: z.string().max(200), workDate: z.iso.date(), currency: z.literal("USD"), batchingAllowed: z.boolean(), serviceIds: z.array(positiveId).min(1), reviewedChargeIds: z.array(z.uuid()), finalizedAt: timestamp.nullable(), finalizationOperationId: z.uuid().nullable() }).strict();
export type FleetTicketBillingV2 = z.infer<typeof FleetTicketBillingV2Schema>;
/** Canonical finance-only state, never an activity-create request field. The
 * ticket groups work; every execution retains its own actual rate authority. */
export const FleetRunBillingV2Schema=z.object({
  version:z.literal(2),revision:positiveId,ticketId:positiveId,ticketRevisionAtBinding:positiveId,
  context:FleetTicketBillingV2Schema.pick({vendorId:true,partnerId:true,billingSiteId:true,afeNumber:true,workDate:true,currency:true}),
  serviceId:positiveId,pricing:FleetPricingIntentSchema,
  requestedAgreementReference:z.string().trim().min(1).max(500).nullable().optional(),
  reportedPricing:FleetPricingIntentSchema.optional(),
  review:z.discriminatedUnion("status",[
    z.object({status:z.literal("pending"),reason:z.string().trim().min(1).max(2000).nullable()}).strict(),
    z.object({status:z.literal("reviewed"),operationId:z.uuid(),reviewedByUserId:positiveId,reviewedAt:timestamp,chargeRevision:positiveId}).strict(),
  ]),
}).strict().superRefine((value,ctx)=>{
  const issue=(message:string)=>ctx.addIssue({code:"custom",message});
  if(value.pricing.mode==="unpriced"){
    if(value.pricing.serviceId!==null && value.pricing.serviceId!==value.serviceId)issue("Unresolved pricing must retain the same service");
    if(value.review.status==="reviewed")issue("Unpriced work requires actual office price resolution before financial approval");
    return;
  }
  const card=value.pricing.rateCard;
  if(card.vendorId!==value.context.vendorId || card.serviceId!==value.serviceId || (card.partnerId!==null && card.partnerId!==value.context.partnerId) || (card.billingSiteId!==null && card.billingSiteId!==value.context.billingSiteId) || card.currency!==value.context.currency)issue("Per-activity pricing authority must match the exact billing context");
});
export type FleetRunBillingV2=z.infer<typeof FleetRunBillingV2Schema>;
