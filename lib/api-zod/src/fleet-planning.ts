import { z } from "zod/v4";

export const FleetScheduleSchema = z
  .object({
    plannedStartAt: z.iso.datetime(),
    plannedEndAt: z.iso.datetime(),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }, "Use an actual IANA timezone"),
  })
  .strict()
  .refine(
    (value) =>
      Date.parse(value.plannedEndAt) > Date.parse(value.plannedStartAt),
    "Planned end must follow planned start",
  );
const requirement = z
  .object({
    id: z
      .string()
      .trim()
      .regex(/^[a-z0-9_-]{1,50}$/),
    label: z.string().trim().min(1).max(200),
    required: z.boolean(),
  })
  .strict();
export const FleetOperationalProfileSchema = z
  .object({
    name: z.string().trim().min(1).max(100),
    inspectionItems: z.array(requirement).max(50),
    manifestFields: z.array(requirement).max(50),
  })
  .strict()
  .superRefine((value, context) => {
    for (const key of ["inspectionItems", "manifestFields"] as const) {
      if (new Set(value[key].map((item) => item.id)).size !== value[key].length)
        context.addIssue({
          code: "custom",
          path: [key],
          message: "Requirement IDs must be unique",
        });
    }
  });
export const FleetInspectionResponsesSchema = z
  .array(
    z
      .object({
        id: requirement.shape.id,
        outcome: z.enum(["passed", "defect_reported", "not_applicable"]),
        notes: z.string().trim().min(1).max(1000).optional(),
      })
      .strict(),
  )
  .max(50);
export const FleetManifestValuesSchema = z.record(
  requirement.shape.id,
  z.string().trim().min(1).max(1000),
);
export const FleetDraftEditSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    schedule: FleetScheduleSchema.nullable().optional(),
    stops: z
      .array(
        z
          .object({
            id: z.uuid(),
            siteId: z.number().int().positive(),
            kind: z.enum(["pickup", "delivery", "return"]),
            sequence: z.number().int().nonnegative(),
          })
          .strict(),
      )
      .min(1)
      .max(50)
      .optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.title !== undefined ||
      value.schedule !== undefined ||
      value.stops !== undefined,
    "Supply an explicit draft change",
  );
export type FleetOperationalProfile = z.infer<
  typeof FleetOperationalProfileSchema
>;
export type FleetInspectionResponses = z.infer<
  typeof FleetInspectionResponsesSchema
>;
export function checkFleetInspectionRequirements(
  profile: FleetOperationalProfile | null | undefined,
  responses: FleetInspectionResponses | undefined,
  overall: "passed" | "defect_reported",
) {
  const actual = responses ?? [];
  if (new Set(actual.map((item) => item.id)).size !== actual.length)
    return false;
  const configured = profile?.inspectionItems ?? [];
  if (actual.some((item) => !configured.some((rule) => rule.id === item.id)))
    return false;
  if (
    configured.some(
      (item) =>
        item.required &&
        !actual.some(
          (answer) =>
            answer.id === item.id && answer.outcome !== "not_applicable",
        ),
    )
  )
    return false;
  return (
    overall !== "passed" ||
    actual.every((item) => item.outcome !== "defect_reported")
  );
}
export function checkFleetManifestRequirements(
  profile: FleetOperationalProfile | null | undefined,
  values: Record<string, string> | undefined,
) {
  const configured = profile?.manifestFields ?? [],
    actual = values ?? {};
  return (
    Object.keys(actual).every((id) =>
      configured.some((item) => item.id === id),
    ) && configured.every((item) => !item.required || !!actual[item.id]?.trim())
  );
}
