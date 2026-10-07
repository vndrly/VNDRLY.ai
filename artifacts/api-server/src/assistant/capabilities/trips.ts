import { capabilityTools } from "./types";
export const TRIP_CAPABILITY_TOOLS = capabilityTools("field_trips", "active trips, vehicle identity, site presence, location, and ETA", "location.read", ["admin", "partner", "vendor", "field_employee"]);
for (const tool of TRIP_CAPABILITY_TOOLS) {
  if (tool.name === "confirm_field_trips_action") tool.description += " Actions include start, pause, resume and complete. Pause/resume require the exact trip resourceId and current payload.expectedVersion; only the trip driver may resume. Completed trips cannot restart. Resuming the server record does not start a phone or browser location collector.";
}

TRIP_CAPABILITY_TOOLS.push({ name: "query_field_trip_eta", description: "Estimate driving distance and minutes to an authorized trip destination from a recent reliable recorded position. Requires exact resourceId. Paused or stale positions produce no estimate. Not guaranteed arrival or device tracking.", input_schema: { type: "object", properties: { resourceId: { type: "string", format: "uuid" } }, required: ["resourceId"], additionalProperties: false }, mutating: false, confirmation: "none", roles: ["admin", "partner", "vendor", "field_employee"], authorityCapability: "location.read" });

