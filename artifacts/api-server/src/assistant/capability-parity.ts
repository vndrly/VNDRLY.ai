export const USER_FACING_ACTIONS = [
  { id: "invitations", route: "/work-hub/administration/invitations", readTool: "query_account_invitations" },
  { id: "workforce", route: "/work-hub/calendar", readTool: "query_workforce_coverage" },
  { id: "assets", route: "/work-hub/inventory", readTool: "query_asset_custody" },
  { id: "trips", route: "/work-hub/map", readTool: "query_field_trips" },
  { id: "safety", route: "/work-hub/safety", readTool: "query_incident_response" },
  { id: "subscriptions", route: "/work-hub/administration/subscriptions", readTool: "query_worker_subscriptions" },
  { id: "displays", route: "/work-hub/administration/displays", readTool: "query_operations_displays" },
] as const;

export const ASK_V_CAPABILITY_PARITY = Object.fromEntries(
  USER_FACING_ACTIONS.map((action) => [action.id, action]),
) as Record<(typeof USER_FACING_ACTIONS)[number]["id"], (typeof USER_FACING_ACTIONS)[number]>;
