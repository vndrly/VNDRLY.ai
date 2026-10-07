import { WorkHubAvailabilityInputSchema } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
export function workHubAvailabilityAvailable(
  session: SessionPayload,
  scopes: readonly string[],
  write = false,
) {
  return (
    scopes.includes(write ? "work_hub:write" : "work_hub:read") &&
    session.role === "field_employee" &&
    session.membershipRole === "field_employee" &&
    Boolean(
      session.userId &&
      session.vendorId &&
      session.vendorPeopleId &&
      session.activeMembershipId &&
      session.sv,
    )
  );
}
export const WORK_HUB_AVAILABILITY_TOOLS = [
  {
    name: "query_work_hub_availability",
    description:
      "Read your current vendor-company personal availability records and exact fingerprint. Only your active worker account; no other-user lookup. Saved planning declarations do not prove physical readiness.",
    inputSchema: {
      type: "object" as const,
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    name: "manage_work_hub_availability",
    description:
      "Prepare saving one personal availability interval for your current vendor-company worker account. Read exact fingerprint first; recordId null creates one nonoverlapping interval, existing exact recordId replaces it. Choose exact UTC start/end, IANA timezone and available boolean. Human approval required. Current account, commitments and snapshot are rechecked. No duty, assignment or physical readiness is established.",
    inputSchema: {
      type: "object" as const,
      properties: {
        recordId: {
          anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
        },
        expectedFingerprint: { type: "string", pattern: "^[a-f0-9]{64}$" },
        window: {
          type: "object",
          properties: {
            plannedStartAt: { type: "string", format: "date-time" },
            plannedEndAt: { type: "string", format: "date-time" },
            timezone: { type: "string" },
          },
          required: ["plannedStartAt", "plannedEndAt", "timezone"],
          additionalProperties: false,
        },
        available: { type: "boolean" },
      },
      required: ["recordId", "expectedFingerprint", "window", "available"],
      additionalProperties: false,
    },
  },
];
export const WorkHubAvailabilityArgumentsSchema =
  WorkHubAvailabilityInputSchema.omit({ operationId: true }).strict();
