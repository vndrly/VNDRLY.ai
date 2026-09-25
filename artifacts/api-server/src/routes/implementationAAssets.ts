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
  userOrgMembershipsTable,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import { databaseAssetRepository } from "../services/asset-database-repository";
import { isAssetHolderInScope } from "../services/asset-holder-scope";
import {
  AssetServiceError,
  createAssetService,
  type AssetCapabilities,
  type AssetOwner,
  type AssetSummary,
} from "../services/assets";

const router = Router();
const service = createAssetService(databaseAssetRepository);
const IdSchema = z.string().uuid();

async function actor(req: Request): Promise<{
  userId: number;
  owner: AssetOwner | null;
  roles: string[];
  isPlatformAdmin: boolean;
  isAssetManager: boolean;
  isGateSupervisor: boolean;
  canCheckOutAsset: boolean;
  canVerifyIssuedAsset: boolean;
}> {
  const session = getSessionFromRequest(req);
  if (!session?.userId)
    throw new AssetServiceError("asset.unauthenticated", 401);
  const owner = session.vendorId
    ? ({ type: "vendor", id: session.vendorId } as const)
    : session.partnerId
      ? ({ type: "partner", id: session.partnerId } as const)
      : null;
  const roles = [
    session.role,
    session.membershipRole,
    session.vendorRole,
  ].filter((role): role is string => Boolean(role));
  const isPlatformAdmin = session.role === "admin";
  const isAdmin = isPlatformAdmin || session.membershipRole === "admin";
  if (!isAdmin && owner?.type === "vendor") {
    const grants = await db
      .select({ role: managedSubcontractorRoleGrantsTable.role })
      .from(managedSubcontractorRoleGrantsTable)
      .innerJoin(
        managedSubcontractorWorkerSponsorshipsTable,
        eq(
          managedSubcontractorWorkerSponsorshipsTable.id,
          managedSubcontractorRoleGrantsTable.sponsorshipId,
        ),
      )
      .where(
        and(
          eq(
            managedSubcontractorWorkerSponsorshipsTable.workerUserId,
            session.userId,
          ),
          eq(
            managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId,
            owner.id,
          ),
          eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"),
          eq(managedSubcontractorRoleGrantsTable.status, "active"),
        ),
      );
    roles.push(...grants.map((grant) => grant.role));
  }
  const isAssetManager = isAdmin || roles.includes("asset_manager");
  const isGateSupervisor = roles.includes("gate_supervisor");
  const isGatekeeper = roles.includes("gatekeeper");
  return {
    userId: session.userId,
    owner,
    roles,
    isPlatformAdmin,
    isAssetManager,
    isGateSupervisor,
    canCheckOutAsset: isAssetManager || isGateSupervisor || isGatekeeper,
    canVerifyIssuedAsset: isAssetManager || isGateSupervisor || isGatekeeper,
  };
}

function assertOwner(
  actual: AssetOwner,
  expected: AssetOwner | null,
  systemAdmin: boolean,
): void {
  if (
    !systemAdmin &&
    (!expected || actual.type !== expected.type || actual.id !== expected.id)
  ) {
    throw new AssetServiceError("asset.not_found", 404);
  }
}

async function assertTransferRecipient(
  owner: AssetOwner,
  userId: number,
): Promise<void> {
  const memberships = await db
    .select({
      orgType: userOrgMembershipsTable.orgType,
      vendorId: userOrgMembershipsTable.vendorId,
      partnerId: userOrgMembershipsTable.partnerId,
    })
    .from(userOrgMembershipsTable)
    .where(eq(userOrgMembershipsTable.userId, userId));
  const sponsorships =
    owner.type === "vendor"
      ? await db
          .select({
            sponsorVendorId:
              managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId,
            status: managedSubcontractorWorkerSponsorshipsTable.status,
          })
          .from(managedSubcontractorWorkerSponsorshipsTable)
          .where(
            and(
              eq(
                managedSubcontractorWorkerSponsorshipsTable.workerUserId,
                userId,
              ),
              eq(
                managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId,
                owner.id,
              ),
              eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"),
            ),
          )
      : [];
  if (!isAssetHolderInScope(owner, memberships, sponsorships)) {
    throw new AssetServiceError("asset.transfer_recipient_not_found", 404);
  }
}
async function assertCurrentAssetAccess(context: Awaited<ReturnType<typeof actor>>, owner: AssetOwner): Promise<void> {
  assertOwner(owner, context.owner, context.isPlatformAdmin);
  if (context.isPlatformAdmin) return;
  const memberships = await db.select({ orgType: userOrgMembershipsTable.orgType, vendorId: userOrgMembershipsTable.vendorId, partnerId: userOrgMembershipsTable.partnerId })
    .from(userOrgMembershipsTable).where(eq(userOrgMembershipsTable.userId, context.userId));
  if (memberships.some(row => row.orgType === owner.type && (owner.type === "vendor" ? row.vendorId : row.partnerId) === owner.id)) return;
  if (owner.type === "vendor") {
    const sponsorships = await db.select({ id: managedSubcontractorWorkerSponsorshipsTable.id })
      .from(managedSubcontractorWorkerSponsorshipsTable)
      .where(and(eq(managedSubcontractorWorkerSponsorshipsTable.workerUserId, context.userId),
        eq(managedSubcontractorWorkerSponsorshipsTable.sponsorVendorId, owner.id),
        eq(managedSubcontractorWorkerSponsorshipsTable.status, "active"))).limit(1);
    if (sponsorships.length) return;
  }
  throw new AssetServiceError("asset.not_found", 404);
}
async function policy(owner: AssetOwner, category: string) {
  const [row] = await db
    .select()
    .from(assetCategoryPoliciesTable)
    .where(
      and(
        eq(assetCategoryPoliciesTable.ownerOrgType, owner.type),
        eq(assetCategoryPoliciesTable.ownerOrgId, owner.id),
        eq(assetCategoryPoliciesTable.category, category),
      ),
    )
    .limit(1);
  return (
    row ?? {
      identifierRequired: false,
      photosRequiredOnCheckout: false,
      photosRequiredOnReturn: false,
      supervisorApprovalRequired: false,
      expectedReturnRequired: false,
    }
  );
}

function enforcePolicy(input: {
  action: "checkout" | "return";
  photos: string[];
  expectedReturnAt?: string;
  isAssetManager: boolean;
  policy: Awaited<ReturnType<typeof policy>>;
}) {
  if (
    input.action === "checkout" &&
    input.policy.photosRequiredOnCheckout &&
    input.photos.length === 0
  ) {
    throw new AssetServiceError("asset.checkout_photos_required", 409);
  }
  if (
    input.action === "return" &&
    input.policy.photosRequiredOnReturn &&
    input.photos.length === 0
  ) {
    throw new AssetServiceError("asset.return_photos_required", 409);
  }
  if (
    input.action === "checkout" &&
    input.policy.expectedReturnRequired &&
    !input.expectedReturnAt
  ) {
    throw new AssetServiceError("asset.expected_return_required", 409);
  }
  if (input.policy.supervisorApprovalRequired && !input.isAssetManager) {
    throw new AssetServiceError("asset.asset_manager_approval_required", 403);
  }
}

function sendError(res: Response, error: unknown) {
  if (error instanceof z.ZodError)
    return res
      .status(400)
      .json({ code: "asset.invalid_request", details: error.issues });
  if (error instanceof AssetServiceError)
    return res.status(error.status).json({ code: error.code });
  console.error("Asset request failed", error);
  return res.status(500).json({ code: "asset.internal_error" });
}

router.get("/implementation-a/assets", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.owner)
      throw new AssetServiceError("asset.owner_required", 403);
    await assertCurrentAssetAccess(context, context.owner);
    const records = await databaseAssetRepository.all(context.owner);
    const assets: AssetSummary[] = await Promise.all(records.map(async (asset) => {
      const currentPolicy = await policy(asset.responsibleOwner, asset.category);
      const canOversee = context.isAssetManager || context.isGateSupervisor;
      const policyAllows = !currentPolicy.supervisorApprovalRequired || canOversee;
      const latestCheckout = [...asset.history].reverse().find((event) => event.type === "checkout" || event.type === "transfer");
      const issuedByViewer = latestCheckout?.type === "checkout" && latestCheckout.actorUserId === context.userId && latestCheckout.toHolderUserId === asset.holderUserId;
      return {
        id: asset.id, name: asset.name, category: asset.category, status: asset.status,
        condition: asset.condition ?? null, version: asset.version,
        holderUserId: asset.holderUserId, currentLocation: asset.currentLocation ?? null,
        hold: asset.hold ?? null, expectedReturnAt: asset.expectedReturnAt ?? null,
        policy: {
          photosRequiredOnCheckout: currentPolicy.photosRequiredOnCheckout,
          photosRequiredOnReturn: currentPolicy.photosRequiredOnReturn,
          expectedReturnRequired: currentPolicy.expectedReturnRequired,
          supervisorApprovalRequired: currentPolicy.supervisorApprovalRequired,
        },
        capabilities: {
          canCheckOut: context.canCheckOutAsset && policyAllows && asset.status === "available" && asset.holderUserId === null,
          canReturn: context.canCheckOutAsset && policyAllows && asset.holderUserId !== null && (canOversee || asset.holderUserId === context.userId),
          canVerifyIssued: context.canVerifyIssuedAsset && asset.status === "checked_out" && asset.holderUserId !== null && (canOversee || issuedByViewer),
        },
      };
    }));
    const capabilities: AssetCapabilities = {
        canCreateAsset: context.isAssetManager,
        canManageAsset: context.isAssetManager,
        canCheckOutAsset: context.canCheckOutAsset,
        canVerifyIssuedAsset: context.canVerifyIssuedAsset,
    };
    return res.json({ assets, capabilities });
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/implementation-a/assets/find", async (req, res) => {
  try {
    const context = await actor(req);
    const alias = AssetAliasSchema.parse(req.query);
    const asset = await service.findAsset(alias);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(
      asset.responsibleOwner,
      context.owner,
      context.isPlatformAdmin,
    );
    return res.json(asset);
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/implementation-a/assets", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.isAssetManager)
      throw new AssetServiceError("asset.asset_manager_required", 403);
    const input = CreateAssetSchema.parse(req.body);
    assertOwner(
      input.responsibleOwner,
      context.owner,
      context.isPlatformAdmin,
    );
    const currentPolicy = await policy(input.responsibleOwner, input.category);
    if (currentPolicy.identifierRequired && input.aliases.length === 0)
      throw new AssetServiceError("asset.identifier_required");
    return res.status(201).json(await service.createAsset(input));
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/implementation-a/assets/provisional", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.owner || !context.isAssetManager)
      throw new AssetServiceError("asset.asset_manager_required", 403);
    const input = z.object({ identifier: AssetAliasSchema }).parse(req.body);
    return res
      .status(201)
      .json(
        await service.findOrCreateProvisional({
          identifier: input.identifier,
          responsibleOwner: context.owner,
        }),
      );
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/implementation-a/assets/:assetId/aliases", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.isAssetManager)
      throw new AssetServiceError("asset.asset_manager_required", 403);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(
      asset.responsibleOwner,
      context.owner,
      context.isPlatformAdmin,
    );
    const input = z
      .object({
        alias: AssetAliasSchema,
        expectedVersion: z.number().int().positive(),
      })
      .parse(req.body);
    return res.json(
      await service.addAlias(assetId, input.alias, input.expectedVersion),
    );
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/implementation-a/assets/:assetId/checkout", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.canCheckOutAsset) throw new AssetServiceError("asset.checkout_forbidden", 403);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(
      asset.responsibleOwner,
      context.owner,
      context.isPlatformAdmin,
    );
    const input = AssetCustodyCommandSchema.extend({ holderUserId: z.number().int().positive().optional() }).parse(req.body);
    const replay = asset.history.some((event) => event.id === input.operationId && event.actorUserId === context.userId);
    const holderUserId = input.holderUserId ?? context.userId;
    if (holderUserId !== context.userId && !context.isGateSupervisor && !context.isAssetManager)
      throw new AssetServiceError("asset.checkout_forbidden", 403);
    if (holderUserId !== context.userId && !replay) await assertTransferRecipient(asset.responsibleOwner, holderUserId);
    const currentPolicy = await policy(asset.responsibleOwner, asset.category);
    if (!replay) enforcePolicy({
      action: "checkout",
      photos: input.photos,
      expectedReturnAt: input.expectedReturnAt,
      isAssetManager: context.isAssetManager || context.isGateSupervisor,
      policy: currentPolicy,
    });
    return res.json(
      await service.checkoutAsset({
        assetId,
        holderUserId,
        actorUserId: context.userId,
        operationId: input.operationId,
        condition: input.condition,
        confirmed: input.confirmed,
        expectedVersion: input.expectedVersion,
        note: input.note,
        photos: input.photos,
        expectedReturnAt: input.expectedReturnAt
          ? new Date(input.expectedReturnAt)
          : undefined,
      }),
    );
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/implementation-a/assets/:assetId/return", async (req, res) => {
  try {
    const context = await actor(req);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(
      asset.responsibleOwner,
      context.owner,
      context.isPlatformAdmin,
    );
    const input = AssetCustodyCommandSchema.parse(req.body);
    if (!context.canCheckOutAsset) throw new AssetServiceError("asset.return_forbidden", 403);
    const priorEvent = asset.history.find((event) => event.id === input.operationId && event.actorUserId === context.userId);
    const replay = priorEvent?.type === "return" ? priorEvent : undefined;
    if (asset.holderUserId !== context.userId && !context.isGateSupervisor && !context.isAssetManager && !priorEvent)
      throw new AssetServiceError("asset.holder_mismatch", 403);
    if (!priorEvent) enforcePolicy({
      action: "return",
      photos: input.photos,
      isAssetManager: context.isAssetManager || context.isGateSupervisor,
      policy: await policy(asset.responsibleOwner, asset.category),
    });
    const holderUserId = replay?.fromHolderUserId ?? (context.isAssetManager || context.isGateSupervisor
      ? asset.holderUserId
      : context.userId);
    if (!holderUserId) throw new AssetServiceError("asset.not_checked_out");
    return res.json(
      await service.returnAsset({
        assetId,
        holderUserId,
        actorUserId: context.userId,
        operationId: input.operationId,
        condition: input.condition,
        confirmed: input.confirmed,
        expectedVersion: input.expectedVersion,
        note: input.note,
        photos: input.photos,
        expectedReturnAt: input.expectedReturnAt ? new Date(input.expectedReturnAt) : undefined,
      }),
    );
  } catch (error) {
    return sendError(res, error);
  }
});

router.get("/implementation-a/assets/:assetId", async (req, res) => {
  try {
    const context = await actor(req);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    await assertCurrentAssetAccess(context, asset.responsibleOwner);
    return res.json(asset);
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/implementation-a/assets/:assetId/verify-issued", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.canVerifyIssuedAsset) throw new AssetServiceError("asset.verify_issued_forbidden", 403);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(asset.responsibleOwner, context.owner, context.isPlatformAdmin);
    const latestCheckout = [...asset.history].reverse().find((event) => event.type === "checkout" || event.type === "transfer");
    const verifiedReplay = asset.history.some((event) => event.id === req.body?.operationId && event.type === "verify-issued" && event.actorUserId === context.userId);
    if (!context.isAssetManager && !context.isGateSupervisor && !verifiedReplay && !(latestCheckout?.type === "checkout" && latestCheckout.actorUserId === context.userId && latestCheckout.toHolderUserId === asset.holderUserId))
      throw new AssetServiceError("asset.verify_issued_forbidden", 403);
    const input = AssetCustodyCommandSchema.parse(req.body);
    return res.json(await service.verifyIssuedAsset({ assetId, actorUserId: context.userId, operationId: input.operationId, condition: input.condition, confirmed: input.confirmed, expectedVersion: input.expectedVersion, note: input.note, photos: input.photos, expectedReturnAt: input.expectedReturnAt ? new Date(input.expectedReturnAt) : undefined }));
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/implementation-a/assets/:assetId/transfer", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.canCheckOutAsset) throw new AssetServiceError("asset.transfer_forbidden", 403);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(
      asset.responsibleOwner,
      context.owner,
      context.isPlatformAdmin,
    );
    const input = AssetCustodyCommandSchema.extend({
      toHolderUserId: z.number().int().positive(),
    }).parse(req.body);
    const replay = asset.history.find((event) => event.id === input.operationId && event.type === "transfer" && event.actorUserId === context.userId);
    if (!context.isAssetManager && !context.isGateSupervisor && asset.holderUserId !== context.userId && !replay)
      throw new AssetServiceError("asset.holder_mismatch", 403);
    if (!asset.holderUserId)
      if (!replay) throw new AssetServiceError("asset.not_checked_out");
    if (!replay) await assertTransferRecipient(asset.responsibleOwner, input.toHolderUserId);
    return res.json(
      await service.transferAsset({
        assetId,
        fromHolderUserId: replay?.fromHolderUserId ?? asset.holderUserId!,
        toHolderUserId: input.toHolderUserId,
        actorUserId: context.userId,
        operationId: input.operationId,
        condition: input.condition,
        confirmed: input.confirmed,
        expectedVersion: input.expectedVersion,
        note: input.note,
        photos: input.photos,
        expectedReturnAt: input.expectedReturnAt ? new Date(input.expectedReturnAt) : undefined,
      }),
    );
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/implementation-a/assets/:assetId/condition", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.canCheckOutAsset) throw new AssetServiceError("asset.condition_forbidden", 403);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(
      asset.responsibleOwner,
      context.owner,
      context.isPlatformAdmin,
    );
    if (!context.isAssetManager && !context.isGateSupervisor && asset.holderUserId !== context.userId)
      throw new AssetServiceError("asset.condition_forbidden", 403);
    const input = z
      .object({
        condition: AssetConditionSchema,
        expectedVersion: z.number().int().positive(),
        note: z.string().trim().max(2_000).optional(),
        photos: z.array(z.string().url()).max(20).default([]),
      })
      .parse(req.body);
    return res.json(await service.reportAssetCondition({ assetId, ...input }));
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/implementation-a/assets/:assetId/hold", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.isAssetManager)
      throw new AssetServiceError("asset.asset_manager_required", 403);
    const assetId = IdSchema.parse(req.params.assetId);
    const asset = await databaseAssetRepository.get(assetId);
    if (!asset) throw new AssetServiceError("asset.not_found", 404);
    assertOwner(
      asset.responsibleOwner,
      context.owner,
      context.isPlatformAdmin,
    );
    const input = z
      .object({
        reason: z.string().trim().min(1).max(2_000),
        expectedVersion: z.number().int().positive(),
      })
      .parse(req.body);
    return res.json(await service.placeAssetHold({ assetId, ...input }));
  } catch (error) {
    return sendError(res, error);
  }
});

router.post("/implementation-a/assets/:assetId/merge", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.isAssetManager)
      throw new AssetServiceError("asset.asset_manager_required", 403);
    const survivingAssetId = IdSchema.parse(req.params.assetId);
    const input = z
      .object({
        mergedAssetId: z.string().uuid(),
        reason: z.string().trim().min(1).max(2_000),
      })
      .parse(req.body);
    const [surviving, merged] = await Promise.all([
      databaseAssetRepository.get(survivingAssetId),
      databaseAssetRepository.get(input.mergedAssetId),
    ]);
    if (!surviving || !merged)
      throw new AssetServiceError("asset.not_found", 404);
    assertOwner(
      surviving.responsibleOwner,
      context.owner,
      context.isPlatformAdmin,
    );
    assertOwner(
      merged.responsibleOwner,
      context.owner,
      context.isPlatformAdmin,
    );
    if (
      surviving.responsibleOwner.type !== merged.responsibleOwner.type ||
      surviving.responsibleOwner.id !== merged.responsibleOwner.id
    )
      throw new AssetServiceError("asset.cross_owner_merge_forbidden", 403);
    return res.json(
      await service.mergeAssets({
        survivingAssetId,
        mergedAssetId: input.mergedAssetId,
        actorRoles: context.roles.concat("asset_manager"),
        reason: input.reason,
      }),
    );
  } catch (error) {
    return sendError(res, error);
  }
});

router.put("/implementation-a/assets/policies/:category", async (req, res) => {
  try {
    const context = await actor(req);
    if (!context.owner || !context.isAssetManager)
      throw new AssetServiceError("asset.asset_manager_required", 403);
    const category = z
      .string()
      .trim()
      .min(1)
      .max(80)
      .parse(req.params.category);
    const input = z
      .object({
        identifierRequired: z.boolean().default(false),
        photosRequiredOnCheckout: z.boolean().default(false),
        photosRequiredOnReturn: z.boolean().default(false),
        supervisorApprovalRequired: z.boolean().default(false),
        expectedReturnRequired: z.boolean().default(false),
      })
      .parse(req.body);
    const [saved] = await db
      .insert(assetCategoryPoliciesTable)
      .values({
        ownerOrgType: context.owner.type,
        ownerOrgId: context.owner.id,
        category,
        ...input,
      })
      .onConflictDoUpdate({
        target: [
          assetCategoryPoliciesTable.ownerOrgType,
          assetCategoryPoliciesTable.ownerOrgId,
          assetCategoryPoliciesTable.category,
        ],
        set: { ...input, updatedAt: new Date() },
      })
      .returning();
    return res.json(saved);
  } catch (error) {
    return sendError(res, error);
  }
});

export default router;
