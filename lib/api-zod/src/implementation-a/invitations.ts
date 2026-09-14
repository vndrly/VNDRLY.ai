import { z } from "zod/v4";

export const ACCOUNT_INVITATION_STATES = [
  "pending",
  "delivered",
  "claimed",
  "expired",
  "revoked",
  "delivery_failed",
] as const;

export const AccountInvitationStateSchema = z.enum(ACCOUNT_INVITATION_STATES);

export const IssueAccountInvitationSchema = z.object({
  email: z.email().transform((value) => value.trim().toLocaleLowerCase("en-US")),
  displayName: z.string().trim().min(1).max(160),
  managedOrganizationId: z.string().uuid(),
  authorizationVersion: z.string().trim().min(1).max(100),
});

export const ClaimAccountInvitationSchema = z.object({
  password: z.string().min(12).max(200),
  authorizationVersion: z.string().trim().min(1).max(100),
});

export const AccountInvitationPublicStatusSchema = z.object({
  state: z.enum(["pending", "claimed", "expired", "revoked", "invalid"]),
  username: z.string().optional(),
  sponsorName: z.string().optional(),
  expiresAt: z.iso.datetime().optional(),
});

export type IssueAccountInvitationInput = z.infer<typeof IssueAccountInvitationSchema>;
export type ClaimAccountInvitationInput = z.infer<typeof ClaimAccountInvitationSchema>;
