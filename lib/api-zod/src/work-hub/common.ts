import { z } from "zod/v4";

export const WORK_HUB_OWNER_TYPES = ["vendor", "partner"] as const;
export const WORK_HUB_CONTEXT_KINDS = [
  "organization",
  "ticket",
  "site",
  "crew",
  "gate",
  "chat",
] as const;
export const WORK_HUB_CAPABILITIES = [
  "channel.read",
  "channel.write",
  "channel.manage",
  "file.download",
  "task.assign",
  "announcement.publish",
  "shift.manage",
  "meeting.host",
  "meeting.record",
  "meeting.artifact.download",
  "policy.manage",
  "connector.manage",
] as const;

export const workHubOwnerSchema = z.object({
  type: z.enum(WORK_HUB_OWNER_TYPES),
  id: z.number().int().positive(),
});

export const workHubContextRefSchema = z.object({
  kind: z.enum(WORK_HUB_CONTEXT_KINDS),
  id: z.union([z.number().int().positive(), z.string().trim().min(1).max(160)]),
});

export const workHubCapabilitySchema = z.enum(WORK_HUB_CAPABILITIES);

export type WorkHubOwner = z.infer<typeof workHubOwnerSchema>;
export type WorkHubContextRef = z.infer<typeof workHubContextRefSchema>;
export type WorkHubCapability = z.infer<typeof workHubCapabilitySchema>;

export const WORK_HUB_ERROR_CODES = [
  "work_hub.disabled",
  "work_hub.not_found",
  "work_hub.forbidden",
  "work_hub.version_conflict",
  "work_hub.invalid_operation",
  "work_hub.operation_owner_changed",
  "work_hub.upload_not_finalized",
  "work_hub.recording_consent_required",
  "work_hub.provider_unavailable",
] as const;

export type WorkHubErrorCode = (typeof WORK_HUB_ERROR_CODES)[number];
