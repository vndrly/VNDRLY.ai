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
  listManagedOrganizations,
  createManagedWorker,
  updateManagedWorker,
  resendManagedWorkerInvitation,
  ManagedSubcontractorError,
  type ManagedSubcontractorActor,
} from "../services/managed-subcontractors";
import { AccountInvitationError } from "../services/account-invitations";

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
  if (
    error instanceof ManagedSubcontractorError ||
    error instanceof AccountInvitationError
  ) {
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
      const managedOrganizationId = IdSchema.parse(
        req.params.managedOrganizationId,
      );
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

router.post(
  "/implementation-a/sponsorships/:sponsorshipId/roles",
  async (req, res) => {
    try {
      const actor = actorFrom(req);
      const sponsorshipId = IdSchema.parse(req.params.sponsorshipId);
      const input = GrantSponsoredRoleSchema.parse(req.body);
      const created = await grantSponsoredRole(actor, sponsorshipId, input);
      res.status(201).json(created);
    } catch (error) {
      sendError(res, error);
    }
  },
);

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
      const managedOrganizationId = IdSchema.parse(
        req.params.managedOrganizationId,
      );
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

function vendorActorFrom(req: Request) {
  const actor = actorFrom(req);
  if (
    z.coerce.number().int().positive().parse(req.params.vendorId) !==
    actor.vendorId
  ) {
    throw new ManagedSubcontractorError(
      "Vendor administrator access required",
      403,
      "managed_subcontractor.vendor_admin_required",
    );
  }
  return actor;
}

const RoleSitesSchema = z
  .object({
    role: z.enum(["gatekeeper", "gate_supervisor"]),
    siteIds: z.array(z.number().int().positive()).min(1).max(200),
  })
  .strict();
const WorkerSchema = RoleSitesSchema.extend({
  name: z.string().trim().min(1).max(160),
  email: z.email().max(320),
});
const base = "/vendors/:vendorId/managed-subcontractors";
router.get(base, async (req, res) => {
  try {
    res.json(await listManagedOrganizations(vendorActorFrom(req)));
  } catch (error) {
    sendError(res, error);
  }
});
router.post(base, async (req, res) => {
  try {
    const actor = vendorActorFrom(req);
    const created = await createManagedOrganization(
      actor,
      CreateManagedOrganizationSchema.parse(req.body),
    );
    res
      .status(201)
      .json({
        id: created.id,
        name: created.name,
        status: created.status,
        workers: [],
      });
  } catch (error) {
    sendError(res, error);
  }
});
router.post(`${base}/:organizationId/workers`, async (req, res) => {
  try {
    const actor = vendorActorFrom(req);
    const orgId = IdSchema.parse(req.params.organizationId);
    const input = WorkerSchema.parse(req.body);
    res.setHeader("Cache-Control", "no-store");
    res.status(201).json(await createManagedWorker(actor, orgId, input));
  } catch (error) {
    sendError(res, error);
  }
});
router.patch(
  `${base}/:organizationId/workers/:sponsorshipId`,
  async (req, res) => {
    try {
      const actor = vendorActorFrom(req);
      const orgId = IdSchema.parse(req.params.organizationId);
      const sponsorshipId = IdSchema.parse(req.params.sponsorshipId);
      const input = z
        .union([
          RoleSitesSchema,
          z.object({ status: z.literal("terminated") }).strict(),
        ])
        .parse(req.body);
      res.json(await updateManagedWorker(actor, orgId, sponsorshipId, input));
    } catch (error) {
      sendError(res, error);
    }
  },
);
router.post(
  `${base}/:organizationId/workers/:sponsorshipId/resend-invitation`,
  async (req, res) => {
    try {
      const actor = vendorActorFrom(req);
      const orgId = IdSchema.parse(req.params.organizationId);
      const sponsorshipId = IdSchema.parse(req.params.sponsorshipId);
      res.setHeader("Cache-Control", "no-store");
      res.json(
        await resendManagedWorkerInvitation(actor, orgId, sponsorshipId),
      );
    } catch (error) {
      sendError(res, error);
    }
  },
);

export default router;
