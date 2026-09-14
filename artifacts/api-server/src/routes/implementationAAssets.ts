import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  AssetAliasSchema,
  AssetConditionSchema,
  AssetCustodyCommandSchema,
  CreateAssetSchema,
} from "@workspace/api-zod";
import {
  assetCategoryPoliciesTable,
  db,
  managedSubcontractorRoleGrantsTable,
  managedSubcontractorWorkerSponsorshipsTable,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { databaseAssetRepository } from "../services/asset-database-repository";
import { AssetServiceError, createAssetService, type AssetOwner } from "../services/assets";

const router = Router();
const service = createAssetService(databaseAssetRepository);
const IdSchema = z.string().uuid();

async function actor(req: Request): Promise<{
  userId: number;
  owner: AssetOwner | null;
  roles: string[];
  isAssetManager: boolean;
}> {
  const session = getSessionFromRequest(req);
  if (!session?.userId) throw new AssetServiceError("asset.unauthenticated", 401);
  const owner = session.vendorId
    ? ({ type: "vendor", id: session.vendorId } as const)
    : session.partnerId
      ? ({ type: "partner", id: session.partnerId } as const)
      : null;
  const roles = [session.role, session.membershipRole, session.vendorRole].filter((role): role is string => Boolean(role));
  const isAdmin = session.role === "admin" || session.membershipRole === "admin";
  if (!isAdmin && owner?.type === "vendor") {
    const grants = await db.select({ role: managedSubcontractorRoleGrantsTable.role })
      .from(managedSubcontractorRoleGrantsTable)
      .innerJoin(
        managedSubcontractorWorkerSponsorshipsTable,
        eq(managedSubcontractorWorkerSponsorshipsTable.id, managedSubcontractorRoleGrantsTable.sponsorshipId),
      )
      .where(and(
        eq(managedSubcontractorWorkerSponsorshipsTable.workerUserId, session.userId),
        eq(managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId, owner.id),
        eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"),
        eq(managedSubcontractorRoleGrantsTable.status, "active"),
      ));
    roles.push(...grants.map((grant) => grant.role));
  }
  return { userId: session.userId, owner, roles, isAssetManager: isAdmin || roles.includes("asset_manager") };
}

function assertOwner(actual: AssetOwner, expected: AssetOwner | null, systemAdmin: boolean): void {
  if (!systemAdmin && (!expected || actual.type !== expected.type || actual.id !== expected.id)) {
    throw new AssetServiceError("asset.not_found", 404);
  }
}

async function policy(owner: AssetOwner, category: string) {
  const [row] = await db.select().from(assetCategoryPoliciesTable).where(and(
    eq(assetCategoryPoliciesTable.ownerOrgType, owner.type),
    eq(assetCategoryPoliciesTable.ownerOrgId, owner.id),
    eq(assetCategoryPoliciesTable.category, category),
  )).limit(1);
  return row ?? {
    identifierRequired: false,
    photosRequiredOnCheckout: false,
    photosRequiredOnReturn: false,
    supervisorApprovalRequired: false,
    expectedReturnRequired: false,
  };
}

function enforcePolicy(input: {
  action: "checkout" | "return";
  photos: string[];
  expectedReturnAt?: string;
  isAssetManager: boolean;
  policy: Awaited<ReturnType<typeof policy>>;
}) {
  if (input.action === "checkout" && input.policy.photosRequiredOnCheckout && input.photos.length === 0) {
    throw new AssetServiceError("asset.checkout_photos_required", 409);
  }
  if (input.action === "return" && input.policy.photosRequiredOnReturn && input.photos.length === 0) {
    throw new AssetServiceError("asset.return_photos_required", 409);
  }
  if (input.action === "checkout" && input.policy.expectedReturnRequired && !input.expectedReturnAt) {
    throw new AssetServiceError("asset.expected_return_required", 409);
  }
  if (input.policy.supervisorApprovalRequired && !input.isAssetManager) {
    throw new AssetServiceError("asset.asset_manager_approval_required", 403);
  }
}

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError) return res.status(400).json({ code: "asset.invalid_request", details: error.issues });
  if (error instanceof AssetServiceError) return res.status(error.status).json({ code: error.code });
  console.error("Asset request failed", error);
  return res.status(500).json({ code: "asset.internal_error" });
}

router.get("/implementation-a/assets", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.owner) throw new AssetServiceError("asset.owner_required", 403);
    return res.json(await databaseAssetRepository.all(context.owner));
  } catch (error) { return sendError(res, error); }
});

router.get("/implementation-a/assets/find", async (req, res) => {
  try {
    const context = await actor(req);
    const alias = AssetAliasSchema.parse(req.query);
    const asset = await service.findAsset(alias);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(asset.responsibleOwner, context.owner, context.roles.includes("admin"));
    return res.json(asset);
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/assets", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.isAssetManager) throw new AssetServiceError("asset.asset_manager_required", 403);
    const input = CreateAssetSchema.parse(req.body);
    assertOwner(input.responsibleOwner, context.owner, context.roles.includes("admin"));
    const currentPolicy = await policy(input.responsibleOwner, input.category);
    if (currentPolicy.identifierRequired && input.aliases.length === 0) throw new AssetServiceError("asset.identifier_required");
    return res.status(201).json(await service.createAsset(input));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/assets/provisional", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.owner) throw new AssetServiceError("asset.owner_required", 403);
    const input = z.object({ identifier: AssetAliasSchema }).parse(req.body);
    return res.status(201).json(await service.findOrCreateProvisional({ identifier: input.identifier, responsibleOwner: context.owner }));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/assets/:assetId/aliases", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.isAssetManager) throw new AssetServiceError("asset.asset_manager_required", 403);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(asset.responsibleOwner, context.owner, context.roles.includes("admin"));
    const input = z.object({ alias: AssetAliasSchema, expectedVersion: z.number().int().positive() }).parse(req.body);
    return res.json(await service.addAlias(assetId, input.alias, input.expectedVersion));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/assets/:assetId/checkout", async (req, res) => {
  try {
    const context = await actor(req);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(asset.responsibleOwner, context.owner, context.roles.includes("admin"));
    const input = AssetCustodyCommandSchema.parse(req.body);
    const currentPolicy = await policy(asset.responsibleOwner, asset.category);
    enforcePolicy({ action: "checkout", photos: input.photos, expectedReturnAt: input.expectedReturnAt, isAssetManager: context.isAssetManager, policy: currentPolicy });
    return res.json(await service.checkoutAsset({ assetId, holderUserId: context.userId, condition: input.condition, confirmed: input.confirmed, expectedVersion: input.expectedVersion, note: input.note, photos: input.photos, expectedReturnAt: input.expectedReturnAt ? new Date(input.expectedReturnAt) : undefined }));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/assets/:assetId/return", async (req, res) => {
  try {
    const context = await actor(req);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(asset.responsibleOwner, context.owner, context.roles.includes("admin"));
    const input = AssetCustodyCommandSchema.parse(req.body);
    enforcePolicy({ action: "return", photos: input.photos, isAssetManager: context.isAssetManager, policy: await policy(asset.responsibleOwner, asset.category) });
    const holderUserId = context.isAssetManager ? asset.holderUserId : context.userId;
    if (!holderUserId) throw new AssetServiceError("asset.not_checked_out");
    return res.json(await service.returnAsset({ assetId, holderUserId, condition: input.condition, confirmed: input.confirmed, expectedVersion: input.expectedVersion, note: input.note, photos: input.photos }));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/assets/:assetId/transfer", async (req, res) => {
  try {
    const context = await actor(req);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(asset.responsibleOwner, context.owner, context.roles.includes("admin"));
    if (!context.isAssetManager && asset.holderUserId !== context.userId) throw new AssetServiceError("asset.holder_mismatch", 403);
    const input = AssetCustodyCommandSchema.extend({ toHolderUserId: z.number().int().positive() }).parse(req.body);
    if (!asset.holderUserId) throw new AssetServiceError("asset.not_checked_out");
    return res.json(await service.transferAsset({ assetId, fromHolderUserId: asset.holderUserId, toHolderUserId: input.toHolderUserId, condition: input.condition, confirmed: input.confirmed, expectedVersion: input.expectedVersion, note: input.note, photos: input.photos }));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/assets/:assetId/condition", async (req, res) => {
  try {
    const context = await actor(req);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(asset.responsibleOwner, context.owner, context.roles.includes("admin"));
    const input = z.object({ condition: AssetConditionSchema, expectedVersion: z.number().int().positive(), note: z.string().trim().max(2_000).optional(), photos: z.array(z.string().url()).max(20).default([]) }).parse(req.body);
    return res.json(await service.reportAssetCondition({ assetId, ...input }));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/assets/:assetId/hold", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.isAssetManager) throw new AssetServiceError("asset.asset_manager_required", 403);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(asset.responsibleOwner, context.owner, context.roles.includes("admin"));
    const input = z.object({ reason: z.string().trim().min(1).max(2_000), expectedVersion: z.number().int().positive() }).parse(req.body);
    return res.json(await service.placeAssetHold({ assetId, ...input }));
  } catch (error) { return sendError(res, error); }
});

router.post("/implementation-a/assets/:assetId/merge", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.isAssetManager) throw new AssetServiceError("asset.asset_manager_required", 403);
    const survivingAssetId = IdSchema.parse(req.params.assetId);
    const input = z.object({ mergedAssetId: z.string().uuid(), reason: z.string().trim().min(1).max(2_000) }).parse(req.body);
    const [surviving, merged] = await Promise.all([databaseAssetRepository.get(survivingAssetId), databaseAssetRepository.get(input.mergedAssetId)]);
    if (!surviving || !merged) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(surviving.responsibleOwner, context.owner, context.roles.includes("admin"));
    assertOwner(merged.responsibleOwner, context.owner, context.roles.includes("admin"));
    if (surviving.responsibleOwner.type !== merged.responsibleOwner.type || surviving.responsibleOwner.id !== merged.responsibleOwner.id) throw new AssetServiceError("asset.cross_owner_merge_forbidden", 403);
    return res.json(await service.mergeAssets({ survivingAssetId, mergedAssetId: input.mergedAssetId, actorRoles: context.roles.concat("asset_manager"), reason: input.reason }));
  } catch (error) { return sendError(res, error); }
});

router.put("/implementation-a/assets/policies/:category", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.owner || !context.isAssetManager) throw new AssetServiceError("asset.asset_manager_required", 403);
    const category = z.string().trim().min(1).max(80).parse(req.params.category);
    const input = z.object({ identifierRequired: z.boolean().default(false), photosRequiredOnCheckout: z.boolean().default(false), photosRequiredOnReturn: z.boolean().default(false), supervisorApprovalRequired: z.boolean().default(false), expectedReturnRequired: z.boolean().default(false) }).parse(req.body);
    const [saved] = await db.insert(assetCategoryPoliciesTable).values({ ownerOrgType: context.owner.type, ownerOrgId: context.owner.id, category, ...input }).onConflictDoUpdate({ target: [assetCategoryPoliciesTable.ownerOrgType, assetCategoryPoliciesTable.ownerOrgId, assetCategoryPoliciesTable.category], set: { ...input, updatedAt: new Date() } }).returning();
    return res.json(saved);
  } catch (error) { return sendError(res, error); }
});

export default router;
