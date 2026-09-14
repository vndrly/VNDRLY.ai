import { Router, type Request, type Response } from "express";
import { and, eq } from "drizzle-orm";
import { z } from "zod/v4";
import {
  registerOperationsDisplaySchema,
  routeOperationsDisplayViewSchema,
  joinOperationsRoomSchema,
  revokeOperationsDisplaySchema,
} from "@workspace/api-zod";
import {
  db,
  operationsDisplaysTable,
  operationsDisplayOutputsTable,
  workHubDevicesTable,
} from "@workspace/db";
import { getSessionFromRequest } from "../lib/session";
import {
  createOperationsDisplayService,
  type OperationsDisplay,
  type OperationsDisplayOutput,
  type OperationsDisplayRepository,
} from "../services/operations-displays";

const router = Router();
const idSchema = z.string().uuid();

function adminContext(req: Request) {
  const session = getSessionFromRequest(req);
  const isAdmin =
    session?.role === "admin" || session?.membershipRole === "admin";
  const owner = session?.vendorId
    ? { type: "vendor" as const, id: session.vendorId }
    : session?.partnerId
      ? { type: "partner" as const, id: session.partnerId }
      : null;
  if (!session?.userId || !isAdmin || !owner)
    throw Object.assign(new Error("operations_display.admin_required"), {
      status: 403,
    });
  return { userId: session.userId, owner };
}

function fromRows(
  display: typeof operationsDisplaysTable.$inferSelect,
  outputs: Array<typeof operationsDisplayOutputsTable.$inferSelect>,
) {
  const value: OperationsDisplay = {
    id: display.id,
    owner: {
      type: display.ownerOrgType as "vendor" | "partner",
      id: display.ownerOrgId,
    },
    name: display.name,
    kind: "operations_display",
    registeredByUserId: display.registeredByUserId,
    registeredCompanionDeviceId: display.registeredCompanionDeviceId,
    siteAllowlist: display.siteAllowlist,
    viewAllowlist: display.viewAllowlist,
    privacyMode: display.privacyMode,
    tokenHash: display.tokenHash,
    tokenExpiresAt: display.tokenExpiresAt,
    revokedAt: display.revokedAt,
    revokedByUserId: display.revokedByUserId,
    createdAt: display.createdAt,
    updatedAt: display.updatedAt,
  };
  return {
    display: value,
    outputs: outputs.map(
      (output): OperationsDisplayOutput => ({
        id: output.id,
        displayId: output.displayId,
        name: output.name,
        currentView: output.currentView,
        currentSiteLocationId: output.currentSiteLocationId,
        currentMeetingOccurrenceId: output.currentMeetingOccurrenceId,
        cameraEnabled: false,
        microphoneEnabled: false,
        updatedAt: output.updatedAt,
      }),
    ),
  };
}

const repository: OperationsDisplayRepository = {
  async create(display, outputs) {
    await db.transaction(async (tx) => {
      await tx.insert(operationsDisplaysTable).values({
        id: display.id,
        ownerOrgType: display.owner.type,
        ownerOrgId: display.owner.id,
        name: display.name,
        registeredByUserId: display.registeredByUserId,
        registeredCompanionDeviceId: display.registeredCompanionDeviceId,
        siteAllowlist: display.siteAllowlist,
        viewAllowlist: display.viewAllowlist,
        privacyMode: display.privacyMode,
        tokenHash: display.tokenHash,
        tokenExpiresAt: display.tokenExpiresAt,
        revokedAt: display.revokedAt,
        revokedByUserId: display.revokedByUserId,
        createdAt: display.createdAt,
        updatedAt: display.updatedAt,
      });
      await tx.insert(operationsDisplayOutputsTable).values(outputs);
    });
  },
  async get(displayId) {
    const [display] = await db
      .select()
      .from(operationsDisplaysTable)
      .where(eq(operationsDisplaysTable.id, displayId))
      .limit(1);
    if (!display) return null;
    const outputs = await db
      .select()
      .from(operationsDisplayOutputsTable)
      .where(eq(operationsDisplayOutputsTable.displayId, displayId));
    return fromRows(display, outputs);
  },
  async save(display, outputs) {
    await db.transaction(async (tx) => {
      await tx
        .update(operationsDisplaysTable)
        .set({
          updatedAt: display.updatedAt,
          revokedAt: display.revokedAt,
          revokedByUserId: display.revokedByUserId,
        })
        .where(eq(operationsDisplaysTable.id, display.id));
      for (const output of outputs)
        await tx
          .update(operationsDisplayOutputsTable)
          .set({
            currentView: output.currentView,
            currentSiteLocationId: output.currentSiteLocationId,
            currentMeetingOccurrenceId: output.currentMeetingOccurrenceId,
            cameraEnabled: false,
            microphoneEnabled: false,
            updatedAt: output.updatedAt,
          })
          .where(eq(operationsDisplayOutputsTable.id, output.id));
    });
  },
};
const service = createOperationsDisplayService(repository);

async function trustedCompanion(
  userId: number,
  owner: { type: "vendor" | "partner"; id: number },
  deviceId: string,
) {
  const [device] = await db
    .select({ id: workHubDevicesTable.id })
    .from(workHubDevicesTable)
    .where(
      and(
        eq(workHubDevicesTable.id, deviceId),
        eq(workHubDevicesTable.userId, userId),
        eq(workHubDevicesTable.ownerOrgType, owner.type),
        eq(workHubDevicesTable.ownerOrgId, owner.id),
      ),
    )
    .limit(1);
  return device?.id;
}

function fail(res: Response, error: unknown) {
  if (error instanceof z.ZodError)
    return res.status(400).json({ code: "operations_display.invalid_request" });
  const status =
    typeof error === "object" && error && "status" in error
      ? Number((error as { status: unknown }).status)
      : 500;
  return res
    .status(status)
    .json({
      code:
        error instanceof Error
          ? error.message
          : "operations_display.internal_error",
    });
}

router.post("/implementation-a/operations-displays", async (req, res) => {
  try {
    const context = adminContext(req);
    const input = registerOperationsDisplaySchema.parse(req.body);
    const deviceId = await trustedCompanion(
      context.userId,
      context.owner,
      input.companionDeviceId,
    );
    if (!deviceId)
      return res
        .status(403)
        .json({ code: "operations_display.trusted_companion_required" });
    const result = await service.registerOperationsDisplay({
      owner: context.owner,
      name: input.name,
      registeredByUserId: context.userId,
      registeredCompanionDeviceId: deviceId,
      monitorNames: input.monitorNames,
      siteAllowlist: input.siteAllowlist,
      viewAllowlist: input.viewAllowlist,
      privacyMode: input.privacyMode,
    });
    return res
      .status(201)
      .json({
        ...result,
        display: { ...result.display, tokenHash: undefined },
      });
  } catch (error) {
    return fail(res, error);
  }
});

router.post(
  "/implementation-a/operations-displays/:displayId/route",
  async (req, res) => {
    try {
      const context = adminContext(req);
      const input = routeOperationsDisplayViewSchema.parse(req.body);
      return res.json(
        await service.routeViewToMonitor(
          { displayId: idSchema.parse(req.params.displayId), ...input },
          {
            userId: context.userId,
            owner: context.owner,
            signedInCompanionDeviceId: input.companionDeviceId,
          },
        ),
      );
    } catch (error) {
      return fail(res, error);
    }
  },
);
router.post(
  "/implementation-a/operations-displays/:displayId/join-room",
  async (req, res) => {
    try {
      const context = adminContext(req);
      const input = joinOperationsRoomSchema.parse(req.body);
      return res.json(
        await service.joinAsRoomDevice(
          { displayId: idSchema.parse(req.params.displayId), ...input },
          {
            userId: context.userId,
            owner: context.owner,
            signedInCompanionDeviceId: input.companionDeviceId,
          },
        ),
      );
    } catch (error) {
      return fail(res, error);
    }
  },
);
router.post(
  "/implementation-a/operations-displays/:displayId/revoke",
  async (req, res) => {
    try {
      const context = adminContext(req);
      const input = revokeOperationsDisplaySchema.parse(req.body);
      return res.json(
        await service.revokeDisplay(idSchema.parse(req.params.displayId), {
          userId: context.userId,
          owner: context.owner,
          signedInCompanionDeviceId: input.companionDeviceId,
        }),
      );
    } catch (error) {
      return fail(res, error);
    }
  },
);

export default router;
