import { z } from "zod/v4";

export const AUTHORITY_CAPABILITIES = [
  "directory.read",
  "meeting.join",
  "schedule.manage",
  "pay_rates.read",
  "operations.display.view",
  "location.read",
  "export.read",
  "events.subscribe",
] as const;

export const AuthorityCapabilitySchema = z.enum(AUTHORITY_CAPABILITIES);
export const AuthorityDecisionSchema = z.object({
  allowed: z.boolean(),
  reasonCode: z.string(),
  confirmation: z.enum(["none", "required"]),
  visibleFields: z.array(z.string()),
});

export type AuthorityCapability = z.infer<typeof AuthorityCapabilitySchema>;
export type AuthorityDecision = z.infer<typeof AuthorityDecisionSchema>;
