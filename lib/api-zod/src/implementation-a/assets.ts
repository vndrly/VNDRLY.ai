import { z } from "zod/v4";

export const AssetOwnerSchema = z.object({ type: z.enum(["vendor", "partner"]), id: z.number().int().positive() });
export const AssetAliasSchema = z.object({ kind: z.enum(["vin", "plate", "serial", "asset_tag", "model", "other"]), jurisdiction: z.string().trim().min(2).max(32).optional(), value: z.string().trim().min(1).max(200) });
export const AssetConditionSchema = z.enum(["new", "good", "fair", "damaged", "missing", "stolen"]);
export const CreateAssetSchema = z.object({ name: z.string().trim().min(1).max(200), category: z.string().trim().min(1).max(80), legalOwner: z.string().trim().min(1).max(200), responsibleOwner: AssetOwnerSchema, aliases: z.array(AssetAliasSchema).max(50).default([]), provisional: z.boolean().default(false), manufacturer: z.string().trim().max(120).optional(), model: z.string().trim().max(120).optional() });
export const AssetCustodyCommandSchema = z.object({ operationId: z.string().uuid(), expectedVersion: z.number().int().positive(), condition: AssetConditionSchema, confirmed: z.literal(true), note: z.string().trim().max(2_000).optional(), photos: z.array(z.string().url()).max(20).default([]), expectedReturnAt: z.iso.datetime().optional() });
export type AssetAlias = z.infer<typeof AssetAliasSchema>;
export type CreateAsset = z.infer<typeof CreateAssetSchema>;
