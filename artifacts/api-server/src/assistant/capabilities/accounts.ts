import { capabilityTools } from "./types";
export const ACCOUNT_CAPABILITY_TOOLS = [
  ...capabilityTools("worker_subscriptions", "company-sponsored worker subscription lifecycle", "directory.read", ["admin", "partner", "vendor"]),
  ...capabilityTools("operations_displays", "authorized operations display views", "operations.display.view", ["admin", "partner", "vendor"]).map(tool => tool.name !== "confirm_operations_displays_action" ? tool : ({ ...tool,
    description: "Prepare exact saved Operations Display monitor routing, meeting-room view or revocation for authenticated approval. Read saved display ID/updatedAt first. Supply action route with monitorName/view/siteLocationId, join_room with monitorName/meetingOccurrenceId, or revoke. Current company administrator, registered companion and site/room authority are rechecked. No registration, pairing secrets, media activation or physical-display verification.",
    input_schema: { type: "object" as const, properties: {
      action: { type: "string", enum: ["route", "join_room", "revoke"] }, displayId: { type: "string", format: "uuid" }, expectedUpdatedAt: { type: "string", format: "date-time" }, reason: { type: "string", minLength: 1, maxLength: 2000 }, monitorName: { type: "string", minLength: 1, maxLength: 40 }, view: { type: "string", enum: ["crew_map", "gate_log", "safety", "coverage"] }, siteLocationId: { type: "integer", minimum: 1 }, meetingOccurrenceId: { type: "string", format: "uuid" }, operationId: { type: "string", format: "uuid", description: "Server-owned exact operation after approval; never invent a replay key." }, confirmed: { type: "boolean" },
    }, required: ["action", "displayId", "expectedUpdatedAt", "reason"], additionalProperties: false },
  })),
];
