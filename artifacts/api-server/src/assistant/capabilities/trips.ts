import { capabilityTools } from "./types";
export const TRIP_CAPABILITY_TOOLS = capabilityTools("field_trips", "active trips, vehicle identity, site presence, location, and ETA", "location.read", ["admin", "partner", "vendor", "field_employee"]);
for (const tool of TRIP_CAPABILITY_TOOLS) {
  if (tool.name === "confirm_field_trips_action") tool.description += " Actions include start, pause, resume and complete. Pause/resume require the exact trip resourceId and current payload.expectedVersion; only the trip driver may resume. Completed trips cannot restart. Resuming the server record does not start a phone or browser location collector.";
}
