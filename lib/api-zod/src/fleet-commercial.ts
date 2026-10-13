import { z } from "zod/v4";
export const FleetBillingModeSchema = z.enum(["batch", "singles"]);
export const FleetDestinationSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    kind: z.enum(["disposal", "delivery", "pickup", "yard"]),
    address: z.string().trim().min(1).max(500),
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    materials: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    hours: z.string().max(500).default(""),
    instructions: z.string().max(2000).default(""),
    active: z.boolean().default(true),
    ownerType: z.enum(["vendor", "partner"]),
    ownerId: z.number().int().positive(),
  })
  .strict();
export type FleetDestination = z.infer<typeof FleetDestinationSchema>;
export const FleetTicketPlanSchema = z
  .object({
    version: z.number().int().positive(),
    siteId: z.number().int().positive(),
    vendorId: z.number().int().positive(),
    partnerId: z.number().int().positive(),
    mode: FleetBillingModeSchema,
    rateCents: z.number().int().min(0).max(100000000),
    currency: z.literal("USD"),
    closure: z.enum(["shift", "day", "manual"]),
    closesAt: z.iso.datetime().nullable(),
    destinations: z.array(FleetDestinationSchema).min(1).max(30),
    closedAt: z.iso.datetime().nullable().default(null),
    createdByUserId: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    operations: z
      .array(
        z.object({
          id: z.uuid(),
          fingerprint: z.string(),
          actorUserId: z.number().int().positive(),
        }),
      )
      .max(100)
      .default([]),
  })
  .strict();
export type FleetTicketPlan = z.infer<typeof FleetTicketPlanSchema>;
export const FleetRunCommercialSchema = z
  .object({
    ticketId: z.number().int().positive(),
    originSiteId: z.number().int().positive(),
    mode: FleetBillingModeSchema,
    rateCents: z.number().int().nonnegative().optional(),
    currency: z.literal("USD"),
    approvedDestinations: z.array(FleetDestinationSchema).min(1).max(30),
    destinationId: z.uuid().nullable().default(null),
    billedLineId: z.number().int().positive().nullable().optional(),
  })
  .strict();
export const FleetCommercialSettingsSchema = z
  .object({
    version: z.number().int().positive().default(1),
    defaultMode: FleetBillingModeSchema.default("singles"),
    destinations: z.array(FleetDestinationSchema).max(500).default([]),
    operations: z
      .array(
        z.object({
          id: z.uuid(),
          actorUserId: z.number().int().positive(),
          fingerprint: z.string(),
        }),
      )
      .max(1000)
      .default([]),
  })
  .strict();
