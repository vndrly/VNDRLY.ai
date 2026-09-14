import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import {
  ClaimManagedOrganizationSchema,
  CreateManagedOrganizationSchema,
  GrantSponsoredRoleSchema,
  InviteManagedWorkerSchema,
  ListVisibleSponsorshipsQuerySchema,
} from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import {
  claimManagedOrganization,
  createManagedOrganization,
  grantSponsoredRole,
  inviteManagedWorker,
  listVisibleSponsorships,
  ManagedSubcontractorError,
  type ManagedSubcontractorActor,
} from "../services/managed-subcontractors";

const router = Router();
const IdSchema = z.string().uuid();

function actorFrom(req: Request): ManagedSubcontractorActor {
  const session = getSessionFromRequest(req);
  if (
    !session?.userId ||
    session.role !== "vendor" ||
    !session.vendorId ||
    session.membershipRole !== "admin"
  ) {
    throw new ManagedSubcontractorError(
      "Vendor administrator access required",
      403,
      "managed_subcontractor.vendor_admin_required",
    );
  }
  return { userId: session.userId, vendorId: session.vendorId };
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof ManagedSubcontractorError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: "Invalid managed subcontractor request",
      code: "managed_subcontractor.invalid_request",
      details: error.issues,
    });
    return;
  }
  console.error("Managed subcontractor request failed", error);
  res.status(500).json({
    error: "Managed subcontractor request failed",
    code: "managed_subcontractor.internal_error",
  });
}

router.post("/implementation-a/managed-organizations", async (req, res) => {
  try {
    const actor = actorFrom(req);
    const input = CreateManagedOrganizationSchema.parse(req.body);
    const created = await createManagedOrganization(actor, input);
    res.status(201).json(created);
  } catch (error) {
    sendError(res, error);
  }
});

router.post(
  "/implementation-a/managed-organizations/:managedOrganizationId/workers",
  async (req, res) => {
    try {
      const actor = actorFrom(req);
      const managedOrganizationId = IdSchema.parse(req.params.managedOrganizationId);
      const input = InviteManagedWorkerSchema.parse(req.body);
      const created = await inviteManagedWorker(
        actor,
        managedOrganizationId,
        input.workerUserId,
      );
      res.status(201).json(created);
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post("/implementation-a/sponsorships/:sponsorshipId/roles", async (req, res) => {
  try {
    const actor = actorFrom(req);
    const sponsorshipId = IdSchema.parse(req.params.sponsorshipId);
    const input = GrantSponsoredRoleSchema.parse(req.body);
    const created = await grantSponsoredRole(actor, sponsorshipId, input);
    res.status(201).json(created);
  } catch (error) {
    sendError(res, error);
  }
});

router.get("/implementation-a/sponsorships", async (req, res) => {
  try {
    const actor = actorFrom(req);
    const query = ListVisibleSponsorshipsQuerySchema.parse(req.query);
    res.json(await listVisibleSponsorships(actor, query.workerUserId));
  } catch (error) {
    sendError(res, error);
  }
});

router.post(
  "/implementation-a/managed-organizations/:managedOrganizationId/claim",
  async (req, res) => {
    try {
      const actor = actorFrom(req);
      const managedOrganizationId = IdSchema.parse(req.params.managedOrganizationId);
      const input = ClaimManagedOrganizationSchema.parse(req.body);
      res.json(
        await claimManagedOrganization(
          actor,
          managedOrganizationId,
          input.representativeUserId,
        ),
      );
    } catch (error) {
      sendError(res, error);
    }
  },
);

export default router;
