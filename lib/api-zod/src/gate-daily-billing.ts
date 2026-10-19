import { z } from "zod/v4";
import {
  GateBillingPeriodInputSchema,
  GateBillingPeriodSchema,
  type calculateGateBillingPeriod,
} from "./gate-billing-period";
const rule = GateBillingPeriodInputSchema.shape.partialDayRule;
export const GateDailyBillingConfigureSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().min(0),
    workTypeId: z.number().int().positive(),
    startDay: z.iso.date(),
    agreementReference: z.string().trim().min(1).max(1000),
    partialDayRule: rule,
    confirmedUnbilledStart: z.literal(true),
    autoInvoiceEveryDays: z
      .number()
      .int()
      .min(1)
      .max(366)
      .nullable()
      .default(null),
  })
  .strict();
export const GateDailyBillingCloseSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    previewFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    continueBilling: z.boolean().default(true),
    acknowledgeCoverageGaps: z.boolean().default(false),
    minimumCompletedDays: z
      .number()
      .int()
      .min(1)
      .max(3660)
      .nullable()
      .default(null),
  })
  .strict();
export const GateDailyBillingConfigSchema = z
  .object({
    version: z.number().int().positive(),
    stationId: z.uuid(),
    vendorId: z.number().int().positive(),
    partnerId: z.number().int().positive(),
    siteId: z.number().int().positive(),
    workTypeId: z.number().int().positive(),
    periodStartDay: z.iso.date(),
    openTicketId: z.number().int().positive().nullable(),
    agreementReference: z.string(),
    partialDayRule: rule,
    dailyRateCents: z.number().int().min(0).max(100000000),
    approvalId: z.number().int().positive(),
    approvalAt: z.string(),
    afe: z.string(),
    lastBilledThroughDay: z.iso.date().nullable(),
    autoInvoiceEveryDays: z.number().int().min(1).max(366).nullable(),
  })
  .strict();
export const GateDailyBillingPostSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    siteId: z.number().int().positive(),
    siteName: z.string(),
    partnerId: z.number().int().positive(),
    partnerName: z.string().default(""),
  })
  .strict();
export const GateDailyBillingPostsSchema = z
  .object({
    items: z.array(GateDailyBillingPostSchema),
    nextCursor: z.uuid().nullable(),
  })
  .strict();
export const GateDailyBillingServiceSchema = z
  .object({
    id: z.number().int().positive(),
    name: z.string(),
    dailyRateCents: z.number().int().nonnegative(),
  })
  .strict();
export const GateDailyBillingSetupSchema = z
  .object({
    post: GateDailyBillingPostSchema,
    config: GateDailyBillingConfigSchema.nullable(),
    services: z.array(GateDailyBillingServiceSchema),
    automationNotice: z
      .object({ code: z.string(), recordedAt: z.iso.datetime() })
      .strict()
      .nullable()
      .default(null),
  })
  .strict();
export const GateDailyBillingResultSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("submitted"),
      ticketId: z.number().int().positive(),
      nextTicketId: z.number().int().positive().nullable(),
      billedThroughDay: z.iso.date(),
      invoiceStatus: z.literal("awaiting_partner_approval"),
    })
    .strict(),
  z
    .object({
      status: z.literal("not_due"),
      ticketId: z.number().int().positive().nullable(),
      nextTicketId: z.null(),
      billedThroughDay: z.null(),
      invoiceStatus: z.literal("not_created"),
    })
    .strict(),
]);
export type GateDailyBillingConfig = z.infer<
  typeof GateDailyBillingConfigSchema
>;
export type GateDailyBillingPost = z.infer<typeof GateDailyBillingPostSchema>;
export type GateDailyBillingSetup = z.infer<typeof GateDailyBillingSetupSchema>;
export type GateDailyBillingConfigure = z.input<
  typeof GateDailyBillingConfigureSchema
>;
export type GateDailyBillingClose = z.input<typeof GateDailyBillingCloseSchema>;
export type GateDailyBillingResult = z.infer<
  typeof GateDailyBillingResultSchema
>;
export type GateDailyBillingPreview = {
  config: GateDailyBillingConfig;
  period: ReturnType<typeof calculateGateBillingPeriod>;
  fingerprint: string;
  invoiceStatus: "awaiting_partner_approval";
};

export const GateDailyBillingPreviewSchema = z
  .object({
    config: GateDailyBillingConfigSchema,
    period: GateBillingPeriodSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    invoiceStatus: z.literal("awaiting_partner_approval"),
  })
  .strict();

export const GateDailyBillingReceiptSchema = z.discriminatedUnion("state", [
  z
    .object({
      state: z.literal("not_found"),
      operationId: z.uuid(),
      stationId: z.uuid(),
      result: z.null(),
    })
    .strict(),
  z
    .object({
      state: z.literal("completed"),
      operationId: z.uuid(),
      stationId: z.uuid(),
      recordedAt: z.iso.datetime(),
      kind: z.enum(["configure", "invoice_now"]),
      result: z.union([
        GateDailyBillingConfigSchema,
        GateDailyBillingResultSchema,
      ]),
    })
    .strict(),
]);
