import { z } from "zod/v4";
export const FleetBillingModeSchema = z.enum(["batch", "singles"]);
export const FleetWorkDateSchema = z.iso.date();
const billingContext = {
  afeNumber: z.string().trim().max(200),
  workDate: FleetWorkDateSchema,
};
export const FleetBillingUnitSchema = z.enum([
  "per_job",
  "lump_sum",
  "per_hour",
  "per_day",
]);
export const FleetRunBillingInputSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("new_ticket"),
      workTypeId: z.number().int().positive(),
      ...billingContext,
    })
    .strict(),
  z
    .object({
      mode: z.literal("existing_ticket"),
      ticketId: z.number().int().positive(),
      ...billingContext,
    })
    .strict(),
]);
export const FleetRunBillingSnapshotSchema = z
  .object({
    ...billingContext,
    unit: FleetBillingUnitSchema.optional(),
    quantity: z
      .number()
      .positive()
      .finite()
      .max(1000000)
      .multipleOf(0.01)
      .optional(),
    billedLineId: z.number().int().positive().nullable().optional(),
  })
  .strict();
export const FleetFinalizeTicketInputSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
const FleetDestinationFieldsSchema = z
  .object({
    id: z.uuid(),
    revision: z.number().int().positive(),
    name: z.string().trim().min(1).max(160),
    kind: z.enum(["disposal", "delivery", "pickup", "yard"]),
    address: z.string().trim().min(1).max(500),
    latitude: z.number().min(-90).max(90).nullable(),
    longitude: z.number().min(-180).max(180).nullable(),
    materials: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
    hours: z.string().max(500).default(""),
    instructions: z.string().max(2000).default(""),
    active: z.boolean().default(true),
    ownerType: z.enum(["vendor", "partner"]),
    ownerId: z.number().int().positive(),
    roles: z
      .array(
        z.enum([
          "partner_site",
          "pickup",
          "terminal",
          "disposal",
          "base",
          "maintenance",
          "other",
        ]),
      )
      .min(1)
      .optional(),
    timeZone: z
      .string()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Choose a valid time zone")
      .optional(),
    geofenceRadiusMeters: z
      .number()
      .positive()
      .max(100000)
      .nullable()
      .optional(),
    entryPoint: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
      })
      .strict()
      .nullable()
      .optional(),
    contacts: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(160),
            phone: z.string().max(60).nullable(),
            email: z.email().nullable(),
          })
          .strict(),
      )
      .max(20)
      .optional(),
    permittedCompanyIds: z
      .array(z.number().int().positive())
      .max(200)
      .optional(),
    appointmentNotes: z.string().max(2000).optional(),
    requiredPermitReferences: z
      .array(z.string().trim().min(1).max(200))
      .max(50)
      .optional(),
    activeFrom: z.iso.datetime({ offset: true }).nullable().optional(),
    activeUntil: z.iso.datetime({ offset: true }).nullable().optional(),
  })
  .strict();
function validateDestination(
  value: {
    latitude: number | null;
    longitude: number | null;
    activeFrom?: string | null;
    activeUntil?: string | null;
  },
  ctx: z.RefinementCtx,
) {
  if ((value.latitude === null) !== (value.longitude === null))
    ctx.addIssue({
      code: "custom",
      path: ["latitude"],
      message: "Coordinates must be a pair or both unknown",
    });
  if (
    value.activeFrom &&
    value.activeUntil &&
    Date.parse(value.activeUntil) <= Date.parse(value.activeFrom)
  )
    ctx.addIssue({
      code: "custom",
      path: ["activeUntil"],
      message: "Active end must follow active start",
    });
}
export const FleetDestinationSchema =
  FleetDestinationFieldsSchema.superRefine(validateDestination);
export const FleetDestinationInputSchema = FleetDestinationFieldsSchema.omit({
  revision: true,
  ownerType: true,
  ownerId: true,
})
  .extend({ id: z.uuid().optional() })
  .superRefine(validateDestination);
export type FleetDestination = z.infer<typeof FleetDestinationSchema>;
export const FleetDestinationSaveSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    destination: FleetDestinationInputSchema,
  })
  .strict();
export const FleetDestinationReceiptSchema = z
  .object({
    version: z.number().int().positive(),
    destination: FleetDestinationSchema,
  })
  .strict();
export const FleetDestinationDirectorySchema = z
  .object({
    version: z.number().int().positive(),
    defaultMode: FleetBillingModeSchema,
    destinations: z.array(FleetDestinationSchema),
    canManage: z.boolean(),
    sitePolicy: z
      .object({ mode: FleetBillingModeSchema.optional() })
      .passthrough()
      .nullable(),
    sites: z.array(
      z.object({ siteId: z.number().int().positive(), name: z.string() }),
    ),
  })
  .strict();
export const FleetTicketPlanSchema = z
  .object({
    billingWorkflow: z.literal(true).optional(),
    billingUnit: FleetBillingUnitSchema.optional(),
    afeNumber: z.string().trim().max(200).optional(),
    workDate: FleetWorkDateSchema.optional(),
    finalizationOperationId: z.uuid().optional(),
    version: z.number().int().positive(),
    siteId: z.number().int().positive(),
    vendorId: z.number().int().positive(),
    partnerId: z.number().int().positive(),
    mode: FleetBillingModeSchema,
    rateCents: z.number().int().min(0).max(100000000),
    currency: z.literal("USD"),
    closure: z.enum(["shift", "day", "manual"]),
    closesAt: z.iso.datetime().nullable(),
    destinations: z.array(FleetDestinationSchema).max(30),
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
  .strict()
  .superRefine((plan, ctx) => {
    if (
      plan.billingWorkflow &&
      (plan.afeNumber === undefined || plan.workDate === undefined)
    )
      ctx.addIssue({
        code: "custom",
        message: "Explicit billing AFE and work date required",
      });
    if (!plan.billingWorkflow && !plan.destinations.length)
      ctx.addIssue({
        code: "custom",
        path: ["destinations"],
        message: "Approved destination required for commercial routing",
      });
  });
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
