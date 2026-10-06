import { capabilityTools } from "./types";
export const SAFETY_CAPABILITY_TOOLS = capabilityTools("incident_response", "incident reporting, acknowledgement, escalation, evidence, and closure", "events.subscribe", ["admin", "partner", "vendor", "field_employee"]);

for (const tool of SAFETY_CAPABILITY_TOOLS) {
  if (tool.name === "confirm_incident_response_action") tool.description += " Use action report with payload siteLocationId, title, eventType, description and explicit stop-work/high-potential flags for an initial safety report. Action create attaches an incident response to an existing safetyEventId. Never infer stop-work, location or evidence. ChatGPT prepares authenticated authorization before submission.";
}
