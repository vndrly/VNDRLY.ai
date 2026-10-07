import type { AskVToolDefinition } from "./tool-registry";
const id = { type: "string", format: "uuid" };
const roles = ["vendor", "field_employee"] as AskVToolDefinition["roles"];
const read = (
  name: string,
  description: string,
  properties: Record<string, unknown> = {},
  required: string[] = [],
): AskVToolDefinition => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
  roles,
  mutating: false,
  confirmation: "none",
  risk: "read",
  execution: "server",
  pack: "role",
  auditTarget: "work_hub",
});
const action = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
): AskVToolDefinition => ({
  ...read(name, description, properties, required),
  mutating: true,
  confirmation: "required",
  risk: "high",
});
const common = {
  capturedAt: { type: "string", format: "date-time" },
  source: { type: "string", const: "user_report" },
  reading: { type: "number", minimum: 0 },
  ticketId: { type: "integer", minimum: 1 },
  reason: { type: "string", minLength: 1, maxLength: 500 },
  runId: id,
  expectedVersion: { type: "integer", minimum: 1 },
};
export const FLEET_TOOLS: AskVToolDefinition[] = [
  {
    ...read(
      "query_fleet_settings",
      "Read active-company Fleet definitions, explicit role/site grants, current configuration version and authorized setup choices. Current company administrator only; operational grants remain separate.",
    ),
    roles: ["vendor"],
    companyAdminOnly: true,
  },
  {
    ...action(
      "manage_fleet_settings",
      "Prepare active-company Fleet enablement, definitions and explicit member role/site grants against exact expectedVersion. Current company administrator only. Preserve requirements and grants that are not being changed; no implied Fleet authority from company title.",
      {
        expectedVersion: { type: "integer", minimum: 1 },
        enabled: { type: "boolean" },
        fleets: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              id,
              name: { type: "string", minLength: 1, maxLength: 100 },
              siteIds: {
                type: "array",
                items: { type: "integer", minimum: 1 },
                maxItems: 200,
              },
              equipmentAssetIds: { type: "array", items: id, maxItems: 500 },
              requiredCertifications: {
                type: "array",
                items: { type: "string", minLength: 1, maxLength: 100 },
                maxItems: 50,
              },
            },
            required: ["id", "name", "siteIds"],
            additionalProperties: false,
          },
        },
        grants: {
          type: "array",
          maxItems: 500,
          items: {
            type: "object",
            properties: {
              userId: { type: "integer", minimum: 1 },
              fleetIds: { type: "array", items: id, maxItems: 50 },
              siteIds: {
                type: "array",
                items: { type: "integer", minimum: 1 },
                maxItems: 200,
              },
              roles: {
                type: "array",
                items: {
                  type: "string",
                  enum: ["fleet_manager", "dispatcher", "driver"],
                },
                maxItems: 3,
              },
              safetyRelease: { type: "boolean" },
              financeRead: { type: "boolean" },
            },
            required: [
              "userId",
              "fleetIds",
              "siteIds",
              "roles",
              "safetyRelease",
              "financeRead",
            ],
            additionalProperties: false,
          },
        },
      },
      ["expectedVersion", "enabled", "fleets", "grants"],
    ),
    roles: ["vendor"],
    companyAdminOnly: true,
  },
  read(
    "query_fleet_capabilities",
    "Read current explicit Fleet grants and permitted overview in the active vendor company; company title or foreman/Gate role does not grant Fleet authority.",
  ),
  read(
    "query_fleet_briefing",
    "Read authorized Fleet runs and exceptions. No telemetry or device capture is inferred.",
  ),
  read(
    "query_fleet_runs",
    "Read runs permitted by current company/fleet/site grants and own-driver assignment.",
  ),
  read(
    "query_fleet_run_detail",
    "Read exact authorized run, ordered stops, recorded loads, user-reported inspection, events, current version and allowed actions.",
    { runId: id },
    ["runId"],
  ),
  read(
    "query_fleet_resources",
    "Read eligible company Fleet driver and inventory vehicle/trailer selection context. Fleet Manager or Dispatcher only; dispatch rechecks holds, custody, site grants and concurrent assignments.",
  ),
  action(
    "manage_fleet_run",
    "Prepare exact Fleet run creation, dispatch, reassignment or cancellation. Requires explicit Fleet Manager or Dispatcher grants. Separate dispatch, driver acknowledgement and physical departure; never claim prepared means saved. For create supply fleetId,title,driverUserId,vehicleAssetId and ordered stops with UUID id/siteId/kind pickup|delivery|return/zero-based sequence. link_ticket links only an existing authorized ticketId without changing the ticket. Equipment references existing inventory explicitly assigned to this fleet; no location collector starts.",
    {
      ...common,
      action: {
        type: "string",
        enum: ["create", "dispatch", "reassign", "cancel", "link_ticket"],
      },
      fleetId: id,
      title: { type: "string", minLength: 1, maxLength: 200 },
      driverUserId: { type: "integer", minimum: 1 },
      vehicleAssetId: id,
      trailerAssetId: { anyOf: [id, { type: "null" }] },
      stops: {
        type: "array",
        minItems: 1,
        maxItems: 50,
        items: {
          type: "object",
          properties: {
            id,
            siteId: { type: "integer", minimum: 1 },
            kind: { type: "string", enum: ["pickup", "delivery", "return"] },
            sequence: { type: "integer", minimum: 0 },
          },
          required: ["id", "siteId", "kind", "sequence"],
          additionalProperties: false,
        },
      },
      reason: { type: "string", minLength: 1, maxLength: 500 },
    },
    ["action"],
  ),
  action(
    "acknowledge_fleet_assignment",
    "Prepare acknowledging only your exact dispatched run. Requires your current Driver grant and assignment; cannot respond for a coworker.",
    common,
    ["runId", "expectedVersion"],
  ),
  action(
    "transition_fleet_run",
    "Prepare your own run user-reported inspection, start, ordered stop arrival/departure, load/delivery record or closeout. Supply actual observations and exact IDs; no invented GPS, media, regulatory clearance or manifests. Inspection requires outcome+notes. Before start record an actual initial meter (reading, unit miles|kilometers, notes); closeout requires a second ending meter. Fuel records require actual positive quantity, unit gallons|liters and notes. Pause requires reason; resume rechecks readiness. Load requires new loadId,commodity,positive quantity,unit,manifestReference; delivery requires exact loadId+deliveryReference. Read allowedActions and version first. Closeout submits for review; it does not approve a ticket or financial record.",
    {
      ...common,
      action: {
        type: "string",
        enum: [
          "inspect",
          "start",
          "arrive_stop",
          "depart_stop",
          "record_load",
          "record_delivery",
          "submit_closeout",
          "pause",
          "resume",
          "record_fuel",
          "record_meter",
        ],
      },
      stopId: id,
      inspectionOutcome: {
        type: "string",
        enum: ["passed", "defect_reported"],
      },
      notes: { type: "string", minLength: 1, maxLength: 2000 },
      loadId: id,
      commodity: { type: "string", minLength: 1, maxLength: 100 },
      quantity: { type: "number", exclusiveMinimum: 0 },
      unit: { type: "string", minLength: 1, maxLength: 40 },
      manifestReference: { type: "string", minLength: 1, maxLength: 200 },
      deliveryReference: { type: "string", minLength: 1, maxLength: 200 },
    },
    ["runId", "expectedVersion", "action"],
  ),
  action(
    "review_fleet_closeout",
    "Prepare acceptance or return of exact submitted Fleet closeout, with reason and current version. Explicit Fleet Manager only; Dispatchers and Drivers cannot review. This reviews user-reported Fleet records, not validated media, regulated inspection or ticket/payment approval.",
    {
      ...common,
      decision: { type: "string", enum: ["accept", "return"] },
      reason: { type: "string", minLength: 1, maxLength: 500 },
    },
    ["runId", "expectedVersion", "decision", "reason"],
  ),
  action(
    "set_fleet_preferences",
    "Prepare your explicit default VNDRLY workspace and selected accessible fleet. This never grants authority or switches company. Read current preference version first.",
    {
      expectedVersion: { type: "integer", minimum: 1 },
      defaultWorkspace: {
        type: "string",
        enum: ["standard", "fleet_desk", "fleet_my_day"],
      },
      selectedFleetId: { anyOf: [id, { type: "null" }] },
    },
    ["expectedVersion", "defaultWorkspace", "selectedFleetId"],
  ),
];
