import { z } from "zod/v4";
import { OperationEnvelopeSchema } from "./common";

export const SafetyIncidentSeveritySchema = z.enum(["low", "medium", "high", "critical"]);
export const SafetyIncidentSourceSchema = z.enum(["manual", "possible_crash", "platform_crash"]);

export const CreateSafetyIncidentInputSchema = z.object({
  organizationId: z.number().int().positive(),
  safetyEventId: z.number().int().positive(),
  source: SafetyIncidentSourceSchema,
  severity: SafetyIncidentSeveritySchema,
  originalReport: z.string().trim().min(1).max(8_000),
  startedAt: z.coerce.date().optional(),
  degradedCapabilities: z.array(z.enum(["askv", "mapbox", "push"])).default([]),
});

export const CreateSafetyIncidentCommandSchema = OperationEnvelopeSchema.extend({ payload: CreateSafetyIncidentInputSchema });

export const IncidentEvidenceInputSchema = z.object({
  kind: z.enum(["note", "photo", "document", "location"]),
  value: z.string().trim().min(1).max(8_000),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export const EvidenceHoldInputSchema = z.object({ reason: z.string().trim().min(1).max(1_000) });
export const CloseSafetyIncidentInputSchema = z.object({ resolution: z.string().trim().min(1).max(4_000) });

export type CreateSafetyIncidentInput = z.infer<typeof CreateSafetyIncidentInputSchema>;
