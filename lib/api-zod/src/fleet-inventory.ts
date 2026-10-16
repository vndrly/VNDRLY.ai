import { z } from "zod/v4";
import { AssetAliasSchema } from "./implementation-a/assets";

export const FleetAssetFieldsSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    manufacturer: z.string().trim().max(120).default(""),
    model: z.string().trim().max(120).default(""),
  })
  .strict();
export const FleetAssetCreateSchema = FleetAssetFieldsSchema.extend({
  operationId: z.uuid(),
  category: z.enum([
    "truck",
    "trailer",
    "vehicle",
    "dolly",
    "tank",
    "pump",
    "accessory",
  ]),
  legalOwner: z.string().trim().min(1).max(200),
  identifier: AssetAliasSchema.refine(
    (a) => /[a-z0-9]/i.test(a.value),
    "Enter an identifier",
  ),
}).strict();
export const FleetAssetEnrollmentSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
export const FleetAssetEditSchema = FleetAssetFieldsSchema.extend({
  operationId: z.uuid(),
  expectedVersion: z.number().int().positive(),
}).strict();
export const FleetInventoryAssetSchema = FleetAssetFieldsSchema.extend({
  id: z.uuid(),
  category: z.string(),
  status: z.string(),
  version: z.number().int().positive(),
  legalOwner: z.string(),
  held: z.boolean(),
  fleetIds: z.array(z.uuid()),
  aliases: z.array(AssetAliasSchema.extend({ kind: z.string() })),
  currentHolderUserId: z.number().int().positive().nullable(),
}).strict();
export const FleetInventorySchema = z.object({
  canManage: z.boolean(),
  version: z.number().int().positive(),
  fleets: z.array(z.object({ id: z.uuid(), name: z.string() })),
  assets: z.array(FleetInventoryAssetSchema),
  nextCursor: z.uuid().nullable(),
});
export const FleetInventoryDetailSchema = z.object({
  canManage: z.boolean(),
  asset: FleetInventoryAssetSchema,
  history: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      note: z.string().nullable(),
      recordedAt: z.string(),
    }),
  ),
  runs: z.array(
    z.object({
      id: z.uuid(),
      title: z.string(),
      status: z.string(),
      ticketId: z.number().nullable(),
    }),
  ),
  maintenance: z.array(
    z.object({ id: z.string(), status: z.string(), notes: z.string() }),
  ),
  historyLimited: z.boolean(),
});
export const FleetInventoryReceiptSchema = z.object({
  operationId: z.uuid(),
  assetId: z.uuid(),
  version: z.number().int().positive(),
  fleetVersion: z.number().int().positive(),
  fingerprint: z.string(),
});
export type FleetInventory = z.infer<typeof FleetInventorySchema>;
export type FleetInventoryAsset = z.infer<typeof FleetInventoryAssetSchema>;
export type FleetInventoryDetail = z.infer<typeof FleetInventoryDetailSchema>;
