import { Router, type Request, type Response } from "express";
import { and, eq, inArray } from "drizzle-orm";
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
import { createDatabaseOperationsDisplayCommands, displayCommandActor } from "../assistant/operations-display-command-repository";

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
  const code = error instanceof Error ? error.message : "operations_display.internal_error";
  const commandStatus = ["operations_display.version_conflict", "operations_display.operation_conflict", "operations_display.revoked"].includes(code) ? 409
    : ["operations_display.not_found", "operations_display.monitor_not_found"].includes(code) ? 404
      : ["operations_display.trusted_companion_required", "operations_display.site_not_allowed", "operations_display.view_not_allowed"].includes(code) ? 403 : null;
  const status = commandStatus ?? (
    typeof error === "object" && error && "status" in error
      ? Number((error as { status: unknown }).status)
      : 500);
  return res
    .status(status)
    .json({
      code:
        error instanceof Error
          ? error.message
          : "operations_display.internal_error",
    });
}

// Exact account-bound commands. Registration/pairing remains device-only and
// existing legacy paths retain their compatibility while clients migrate.
router.post("/implementation-a/operations-displays/commands", async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session) return res.status(401).json({ code: "operations_display.current_account_required" });
    const result = await createDatabaseOperationsDisplayCommands(session).execute(req.body, displayCommandActor(session));
    return res.json(result);
  } catch (error) { return fail(res, error); }
});
router.post("/implementation-a/operations-displays/commands/readback", async (req, res) => {
  try {
    const session = getSessionFromRequest(req);
    if (!session) return res.status(401).json({ code: "operations_display.current_account_required" });
    const result = await createDatabaseOperationsDisplayCommands(session).readback(req.body, displayCommandActor(session));
    return result ? res.json(result) : res.status(404).json({ code: "operations_display.operation_not_found" });
  } catch (error) { return fail(res, error); }
});

router.get("/implementation-a/operations-displays", async (req, res) => {
  try {
    const context = adminContext(req);
    const displays = await db.select().from(operationsDisplaysTable).where(and(
      eq(operationsDisplaysTable.ownerOrgType, context.owner.type),
      eq(operationsDisplaysTable.ownerOrgId, context.owner.id),
    ));
    const outputs = displays.length ? await db.select().from(operationsDisplayOutputsTable)
      .where(inArray(operationsDisplayOutputsTable.displayId, displays.map(display => display.id))) : [];
    return res.json({ displays: displays.map(display => ({
      id: display.id, name: display.name, privacyMode: display.privacyMode,
      siteAllowlist: display.siteAllowlist, viewAllowlist: display.viewAllowlist,
      revokedAt: display.revokedAt, updatedAt: display.updatedAt,
      outputs: outputs.filter(output => output.displayId === display.id).map(output => ({
        id: output.id, name: output.name, currentView: output.currentView,
        currentSiteLocationId: output.currentSiteLocationId,
        currentMeetingOccurrenceId: output.currentMeetingOccurrenceId,
        cameraEnabled: false, microphoneEnabled: false, updatedAt: output.updatedAt,
      })),
    })), controlRequiresAuthenticatedCompanion: true });
  } catch (error) { return fail(res, error); }
});

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
