/** Contract reserved for the forthcoming fleet package. No telemetry is invented. */
export const VENDRY_FLEET_INTEGRATION = {
  name: "VENDRY Fleet",
  status: "not_connected",
  capabilities: ["vehicle_load_status", "vehicle_tag_location", "missing_vehicle_location", "distance_to_vehicle", "apple_maps_route", "google_maps_route"],
  message: "VENDRY Fleet is not connected yet. This panel shows authorized VNDRLY trips only; vehicle GPS tags, load phases, missing-truck distance and navigation are unavailable until the fleet package is connected.",
} as const;
