import { z } from "zod/v4";

export const MANAGED_SUBCONTRACTOR_ROLES = [
  "managed_company_manager",
  "gatekeeper",
  "gate_supervisor",
  "foreman",
  "asset_manager",
  "safety_manager",
] as const;

export const ManagedSubcontractorRoleSchema = z.enum(MANAGED_SUBCONTRACTOR_ROLES);

export const CreateManagedOrganizationSchema = z.object({
  name: z.string().trim().min(1).max(200),
  ownerType: z.literal("vendor").default("vendor"),
});

export const InviteManagedWorkerSchema = z.object({
  workerUserId: z.number().int().positive(),
});

export const GrantSponsoredRoleSchema = z
  .object({
    role: ManagedSubcontractorRoleSchema,
    siteId: z.number().int().positive().optional(),
    crewId: z.string().uuid().optional(),
  })
  .refine((value) => value.siteId !== undefined || value.crewId !== undefined, {
    message: "A site or crew scope is required",
  });

export const ClaimManagedOrganizationSchema = z.object({
  representativeUserId: z.number().int().positive(),
});

export const ListVisibleSponsorshipsQuerySchema = z.object({
  workerUserId: z.coerce.number().int().positive().optional(),
});

export type ManagedSubcontractorRole = z.infer<typeof ManagedSubcontractorRoleSchema>;
export type CreateManagedOrganizationInput = z.infer<typeof CreateManagedOrganizationSchema>;
export type InviteManagedWorkerInput = z.infer<typeof InviteManagedWorkerSchema>;
export type GrantSponsoredRoleInput = z.infer<typeof GrantSponsoredRoleSchema>;
export type ClaimManagedOrganizationInput = z.infer<typeof ClaimManagedOrganizationSchema>;
