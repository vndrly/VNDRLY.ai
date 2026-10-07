import { z } from "zod/v4";
import {
  AssetConditionSchema,
  AssetCustodyCommandSchema,
} from "./implementation-a/assets";

export const AssetTransferInputSchema = AssetCustodyCommandSchema.extend({
  toHolderUserId: z.number().int().positive(),
}).strict();
export const AssetTransferRecipientsSchema = z
  .object({
    assetId: z.uuid(),
    version: z.number().int().positive(),
    holderUserId: z.number().int().positive(),
    actorUserId: z.number().int().positive(),
    canTransfer: z.boolean(),
    recipients: z
      .array(
        z
          .object({
            userId: z.number().int().positive(),
            displayName: z.string().min(1).max(200),
          })
          .strict(),
      )
      .max(50),
    truncated: z.boolean(),
  })
  .strict();
export const AssetTransferReceiptSchema = z
  .object({
    assetId: z.uuid(),
    operationId: z.uuid(),
    actorUserId: z.number().int().positive(),
    fromHolderUserId: z.number().int().positive(),
    toHolderUserId: z.number().int().positive(),
    condition: AssetConditionSchema,
    commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    recordedAt: z.iso.datetime(),
    physicalHandoffVerified: z.literal(false),
  })
  .strict();
export const AssetTransferReadbackSchema = z
  .object({
    receipt: AssetTransferReceiptSchema.nullable(),
    currentVersion: z.number().int().positive(),
  })
  .strict();
export type AssetTransferInput = z.infer<typeof AssetTransferInputSchema>;
export type AssetTransferRecipients = z.infer<
  typeof AssetTransferRecipientsSchema
>;
export type AssetTransferReceipt = z.infer<typeof AssetTransferReceiptSchema>;

/** Matches the canonical service array exactly; currentVersion is not an original receipt revision. */
export function assetTransferFingerprintValues(
  assetId: string,
  actorUserId: number,
  fromHolderUserId: number,
  input: AssetTransferInput,
): unknown[] {
  return [
    "transfer",
    assetId,
    actorUserId,
    fromHolderUserId,
    input.toHolderUserId,
    input.condition,
    input.note?.trim() ?? "",
    [...input.photos].sort(),
    input.expectedReturnAt
      ? new Date(input.expectedReturnAt).toISOString()
      : null,
  ];
}
