import { capabilityTools } from "./types";
export const TRIP_CAPABILITY_TOOLS = capabilityTools("field_trips", "active trips, vehicle identity, site presence, location, and ETA", "location.read", ["admin", "partner", "vendor", "field_employee"]);
