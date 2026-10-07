import { z } from "zod/v4";
export const NativeCaptureAccountSchema = z
  .object({
    userId: z.number().int().positive(),
    membershipId: z.number().int().positive(),
    sessionVersion: z.number().int().positive(),
    orgType: z.enum(["vendor", "partner"]),
    orgId: z.number().int().positive(),
  })
  .strict();
export type NativeCaptureAccount = z.infer<typeof NativeCaptureAccountSchema>;
export function nativeCaptureBinding(account: NativeCaptureAccount): string {
  const value = NativeCaptureAccountSchema.parse(account);
  return JSON.stringify([
    "vndrly-work-capture",
    value.userId,
    value.membershipId,
    value.orgType,
    value.orgId,
    value.sessionVersion,
  ]);
}
