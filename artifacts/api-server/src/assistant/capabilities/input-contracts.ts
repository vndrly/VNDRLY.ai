import { z } from "zod/v4";
import { StartFieldTripSchema, UpdateFieldTripLocationSchema, CompleteFieldTripSchema, IssueAccountInvitationSchema, PreviewWorkerSubscriptionSchema, AssignWorkforceShiftSchema, AcknowledgeWorkforceAssignmentSchema, CreateSafetyIncidentInputSchema, IncidentEvidenceInputSchema, EvidenceHoldInputSchema, CloseSafetyIncidentInputSchema } from "@workspace/api-zod";

const json = (schema: z.ZodType) => z.toJSONSchema(schema, { io: "input", unrepresentable: "any" });
const version = z.object({ expectedVersion: z.number().int().positive() });
const empty = z.object({});
const domains: Record<string, { actions: string[]; payloads: z.ZodType[] }> = {
  account_invitations: { actions: ["create", "resend", "revoke"], payloads: [IssueAccountInvitationSchema, empty] },
  worker_subscriptions: { actions: ["create", "pause", "terminate", "reactivate"], payloads: [PreviewWorkerSubscriptionSchema, z.object({ renewalAt: z.iso.datetime(), confirmed: z.literal(true) }), empty] },
  workforce_coverage: { actions: ["assign", "acknowledge", "evaluate", "escalate"], payloads: [AssignWorkforceShiftSchema.omit({ operationId: true }), AcknowledgeWorkforceAssignmentSchema.omit({ operationId: true }), version.extend({ shiftId: z.uuid().optional(), assignedCount: z.number().int().nonnegative().optional(), requiredCount: z.number().int().positive().optional() })] },
  field_trips: { actions: ["start", "location", "pause", "resume", "complete"], payloads: [StartFieldTripSchema.omit({ operationId: true, owner: true }), UpdateFieldTripLocationSchema, CompleteFieldTripSchema.omit({ operationId: true }), version] },
  incident_response: { actions: ["report", "create", "escalate", "acknowledge", "evidence", "hold", "close"], payloads: [CreateSafetyIncidentInputSchema, IncidentEvidenceInputSchema, EvidenceHoldInputSchema, CloseSafetyIncidentInputSchema, z.object({ siteLocationId: z.number().int().positive(), title: z.string(), eventType: z.string(), description: z.string(), stopWork: z.boolean().optional(), highPotential: z.boolean().optional() }), empty] },
};
export function capabilityInputContract(domain: string, kind: "query" | "prepare" | "confirm") {
  const definition = domains[domain];
  if (!definition) return null;
  return {
    type: "object" as const,
    properties: {
      resourceId: { type: "string", description: "Exact canonical ID returned by an authorized read, never a guessed name." },
      ...(kind === "query" ? {} : {
        action: { type: "string", enum: definition.actions },
        operationId: { type: "string", format: "uuid" },
        expectedVersion: { type: "integer", minimum: 0 },
        owner: { type: "object", properties: { type: { type: "string", enum: ["vendor", "partner"] }, id: { type: "integer", minimum: 1 } }, required: ["type", "id"], additionalProperties: false },
        payload: { anyOf: definition.payloads.map(json), description: "Action-specific canonical fields. Read current IDs and versions first; prepare is observation only, confirmation is server-bound." },
      }),
    },
    ...(kind === "query" ? {} : { required: kind === "confirm" ? ["action", "payload"] : ["action"] }),
    additionalProperties: false,
  };
}
