import { z } from "zod/v4";
export const InventoryPolicyFieldsSchema = z
  .object({
    identifierRequired: z.boolean(),
    photosRequiredOnCheckout: z.boolean(),
    photosRequiredOnReturn: z.boolean(),
    supervisorApprovalRequired: z.boolean(),
    expectedReturnRequired: z.boolean(),
  })
  .strict();
export const InventoryPolicyCommandSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    confirmed: z.literal(true),
    policy: InventoryPolicyFieldsSchema,
  })
  .strict();
export const InventoryMergeCommandSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
    mergedAssetId: z.uuid(),
    mergedExpectedVersion: z.number().int().positive(),
    reason: z.string().trim().min(1).max(2000),
    confirmed: z.literal(true),
  })
  .strict();
export const InventoryOwnerSchema = z
  .object({
    type: z.enum(["vendor", "partner"]),
    id: z.number().int().positive(),
  })
  .strict();
export const InventoryPolicyReadSchema = z
  .object({
    owner: InventoryOwnerSchema,
    category: z.string().min(1).max(80),
    version: z.number().int().nonnegative(),
    policy: InventoryPolicyFieldsSchema,
  })
  .strict();
export const InventoryManagementReceiptSchema = z
  .object({
    operationId: z.uuid(),
    actorUserId: z.number().int().positive(),
    owner: InventoryOwnerSchema,
    action: z.enum(["policy", "merge"]),
    targetId: z.string().min(1),
    commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    previousVersion: z.number().int().nonnegative(),
    version: z.number().int().positive(),
    mergedAssetId: z.uuid().optional(),
    mergedPreviousVersion: z.number().int().positive().optional(),
    mergedVersion: z.number().int().positive().optional(),
    policy: InventoryPolicyFieldsSchema.optional(),
    previousPolicy: InventoryPolicyFieldsSchema.optional(),
    recordedAt: z.iso.datetime(),
    status: z.literal("applied"),
    physicalPossessionVerified: z.literal(false),
    legalOwnershipVerified: z.literal(false),
  })
  .strict()
  .superRefine((r, c) => {
    if (
      r.action === "policy" &&
      (!r.policy ||
        !r.previousPolicy ||
        r.mergedAssetId !== undefined ||
        r.mergedPreviousVersion !== undefined ||
        r.mergedVersion !== undefined)
    )
      c.addIssue({
        code: "custom",
        message: "Exact policy receipt fields required",
      });
    if (
      r.action === "merge" &&
      (!r.mergedAssetId ||
        !r.mergedPreviousVersion ||
        !r.mergedVersion ||
        r.policy !== undefined ||
        r.previousPolicy !== undefined)
    )
      c.addIssue({
        code: "custom",
        message: "Exact two-asset receipt fields required",
      });
  });
export const InventoryManagementReadbackSchema = z
  .object({ receipt: InventoryManagementReceiptSchema.nullable() })
  .strict();
export type InventoryManagementReceipt = z.infer<
  typeof InventoryManagementReceiptSchema
>;
export function inventoryManagementFingerprintValues(
  action: "policy" | "merge",
  actorUserId: number,
  owner: z.infer<typeof InventoryOwnerSchema>,
  targetId: string,
  input: unknown,
) {
  return [
    action,
    actorUserId,
    InventoryOwnerSchema.parse(owner),
    targetId,
    action === "policy"
      ? InventoryPolicyCommandSchema.parse(input)
      : InventoryMergeCommandSchema.parse(input),
  ];
}
