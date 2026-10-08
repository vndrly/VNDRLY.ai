import { z } from "zod/v4";
export const WorkHubShiftOpeningInputSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    open: z.boolean(),
  })
  .strict();
export const WorkHubShiftOpeningReceiptSchema = z
  .object({
    operationId: z.uuid(),
    actorUserId: z.number().int().positive(),
    ownerOrgType: z.enum(["vendor", "partner"]),
    ownerOrgId: z.number().int().positive(),
    shiftId: z.uuid(),
    previousVersion: z.number().int().positive(),
    resultingVersion: z.number().int().positive(),
    open: z.boolean(),
    commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    recordedAt: z.iso.datetime(),
    physicalAttendanceVerified: z.literal(false),
  })
  .strict();
export const WorkHubShiftOpeningReadbackSchema = z
  .object({ receipt: WorkHubShiftOpeningReceiptSchema.nullable() })
  .strict();
export type WorkHubShiftOpeningInput = z.infer<
  typeof WorkHubShiftOpeningInputSchema
>;
export type WorkHubShiftOpeningReceipt = z.infer<
  typeof WorkHubShiftOpeningReceiptSchema
>;
export function workHubShiftOpeningFingerprintValues(
  shiftId: string,
  actorUserId: number,
  ownerOrgType: "vendor" | "partner",
  ownerOrgId: number,
  input: WorkHubShiftOpeningInput,
) {
  return {
    shiftId,
    actorUserId,
    ownerOrgType,
    ownerOrgId,
    ...WorkHubShiftOpeningInputSchema.parse(input),
  };
}
