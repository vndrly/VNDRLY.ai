import { z } from "zod/v4";
import {
  FleetAvailabilityInputSchema,
  FleetAvailabilityReadSchema,
  FleetAvailabilityReceiptSchema,
} from "./fleet-availability";
import { FleetScheduleSchema } from "./fleet-planning";
import { fleetAvailabilityFingerprintValues } from "./fleet-availability-client";
export const WorkHubAvailabilityInputSchema = FleetAvailabilityInputSchema.omit(
  { driverUserId: true },
)
  .extend({
    window: FleetScheduleSchema.refine(
      (value) =>
        Date.parse(value.plannedEndAt) - Date.parse(value.plannedStartAt) <=
        31 * 86400000,
      "Availability intervals are bounded to 31 days",
    ),
  })
  .strict();
export const WorkHubAvailabilityReadSchema = FleetAvailabilityReadSchema.omit({
  driverUserId: true,
})
  .extend({
    userId: z.number().int().positive(),
    companyId: z.number().int().positive(),
    actorMembershipId: z.number().int().positive(),
    actorSessionVersion: z.number().int().positive(),
  })
  .strict();
export const WorkHubAvailabilityReceiptSchema =
  FleetAvailabilityReceiptSchema.omit({ driverUserId: true })
    .extend({
      userId: z.number().int().positive(),
      actorMembershipId: z.number().int().positive(),
      actorSessionVersion: z.number().int().positive(),
    })
    .strict();
export const WorkHubAvailabilityReadbackSchema = z
  .object({ receipt: WorkHubAvailabilityReceiptSchema.nullable() })
  .strict();
export type WorkHubAvailabilityInput = z.infer<
  typeof WorkHubAvailabilityInputSchema
>;
export type WorkHubAvailabilityReceipt = z.infer<
  typeof WorkHubAvailabilityReceiptSchema
>;
export function workHubAvailabilityFingerprintValues(
  actorUserId: number,
  companyId: number,
  input: WorkHubAvailabilityInput,
) {
  return fleetAvailabilityFingerprintValues(actorUserId, companyId, {
    ...input,
    driverUserId: actorUserId,
  });
}
