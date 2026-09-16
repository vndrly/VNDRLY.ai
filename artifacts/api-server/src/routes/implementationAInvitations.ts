import { Router, type Request, type Response } from "express";
import { z } from "zod/v4";
import {
  ClaimAccountInvitationSchema,
  IssueAccountInvitationSchema,
} from "@workspace/api-zod";
import { getSessionFromRequest } from "../lib/session";
import {
  AccountInvitationError,
  claimAccountInvitation,
  getInvitationStatus,
  issueAccountInvitation,
  resendAccountInvitation,
  revokeAccountInvitation,
  type AccountInvitationActor,
} from "../services/account-invitations";

const router = Router();
const InvitationIdSchema = z.string().uuid();
const RawTokenSchema = z.string().regex(/^[a-f0-9]{64}$/i);

function actorFrom(req: Request): AccountInvitationActor {
  const session = getSessionFromRequest(req);
  if (
    !session?.userId ||
    session.role !== "vendor" ||
    !session.vendorId ||
    session.membershipRole !== "admin"
  ) {
    throw new AccountInvitationError(
      "Vendor administrator access required",
      403,
      "account_invitation.vendor_admin_required",
    );
  }
  return { userId: session.userId, vendorId: session.vendorId };
}

function sendError(res: Response, error: unknown): void {
  if (error instanceof AccountInvitationError) {
    res.status(error.status).json({ error: error.message, code: error.code });
    return;
  }
  if (error instanceof z.ZodError) {
    res.status(400).json({
      error: "Invalid account invitation request",
      code: "account_invitation.invalid_request",
    });
    return;
  }
  console.error("Account invitation request failed", error);
  res.status(500).json({
    error: "Account invitation request failed",
    code: "account_invitation.internal_error",
  });
}

router.post("/implementation-a/account-invitations", async (req, res) => {
  try {
    const result = await issueAccountInvitation(
      actorFrom(req),
      IssueAccountInvitationSchema.parse(req.body),
    );
    res.status(201).json({
      invitationId: result.invitationId,
      userId: result.userId,
      expiresAt: result.expiresAt.toISOString(),
    });
  } catch (error) {
    sendError(res, error);
  }
});

router.post(
  "/implementation-a/account-invitations/:invitationId/resend",
  async (req, res) => {
    try {
      const result = await resendAccountInvitation(
        actorFrom(req),
        InvitationIdSchema.parse(req.params.invitationId),
      );
      res.json({
        invitationId: result.invitationId,
        userId: result.userId,
        expiresAt: result.expiresAt.toISOString(),
      });
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.delete(
  "/implementation-a/account-invitations/:invitationId",
  async (req, res) => {
    try {
      await revokeAccountInvitation(
        actorFrom(req),
        InvitationIdSchema.parse(req.params.invitationId),
      );
      res.status(204).end();
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.get(
  "/implementation-a/account-invitations/activate/:token",
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const token = RawTokenSchema.safeParse(req.params.token);
      res.json(
        token.success
          ? await getInvitationStatus(token.data)
          : { state: "invalid" },
      );
    } catch (error) {
      sendError(res, error);
    }
  },
);

router.post(
  "/implementation-a/account-invitations/activate/:token",
  async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    try {
      const token = RawTokenSchema.safeParse(req.params.token);
      if (!token.success) {
        throw new AccountInvitationError(
          "Invitation is invalid or unavailable",
          410,
          "account_invitation.invalid",
        );
      }
      res.json(
        await claimAccountInvitation(
          token.data,
          ClaimAccountInvitationSchema.parse(req.body),
        ),
      );
    } catch (error) {
      sendError(res, error);
    }
  },
);

export default router;
