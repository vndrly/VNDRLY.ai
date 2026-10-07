import type { AskVToolDefinition } from "./tool-registry";
const id = { type: "string", format: "uuid" };
const page = {
  limit: { type: "integer", minimum: 1, maximum: 50 },
  cursor: {
    type: "string",
    pattern: "^[0-9]{1,10}:[0-9]{1,10}$",
    description: "Exact nextCursor returned by the preceding authorized page.",
  },
};
const reportFilters = {
  fleetId: id,
  siteId: { type: "integer", minimum: 1 },
  startsAt: { type: "string", format: "date-time" },
  endsAt: { type: "string", format: "date-time" },
};
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
  read("query_fleet_run_eta", "Estimate an exact authorized active run to its actual next site using a current reliable consented driver-phone observation and Mapbox. May return no estimate; not truck-safe routing or verified physical proof. Never accepts model coordinates.", { runId: id }, ["runId"]),
  {
    ...read(
      "query_fleet_support",
      "Read only companies/fleets/sites explicitly granted by their current company administrator for time-bound platform support. Without companyId lists actual unexpired support choices. No global surveillance, live coordinates or business mutations; fuel requires explicit financeRead.",
      { companyId: { type: "integer", minimum: 1 }, cursor: page.cursor },
    ),
    roles: ["admin"],
  },
  {
    ...read(
      "query_fleet_site_activity",
      "Read only the active Partner's own-site recorded Fleet stops/loads. Without siteId returns authorized site choices. No other route, driver identity, coordinates, fuel, costs or vendor roster. Dates select run creation cohort, not daily activity totals.",
      {
        siteId: { type: "integer", minimum: 1 },
        startsAt: { type: "string", format: "date-time" },
        endsAt: { type: "string", format: "date-time" },
      },
    ),
    roles: ["partner"],
  },
  read(
    "query_fleet_gate_observations",
    "Read minimal same-equipment/site/time-window Gate observation candidates for the exact authorized run. Multiple matches remain ambiguous; no person matching, automatic admission or run arrival is claimed.",
    { runId: id },
    ["runId"],
  ),
  action(
    "reconcile_fleet_gate_visit",
    "Prepare an explicit correlation of an existing Gate visit to an exact run stop. Does not create or change admission, GPS arrival, ticket status or the visit. Requires exact candidate and reason; one visit can be linked once.",
    {
      runId: id,
      stopId: id,
      visitId: { type: "integer", minimum: 1 },
      expectedVersion: { type: "integer", minimum: 1 },
      reason: { type: "string", minLength: 1, maxLength: 1000 },
    },
    ["runId", "stopId", "visitId", "expectedVersion", "reason"],
  ),
  read(
    "query_fleet_report",
    "Read authorized recorded run/load/meter totals, preserving commodity and units. Fuel requires explicit financeRead. Never infer physical telemetry, ETA, dwell, spend or regulatory performance.",
    reportFilters,
  ),
  read(
    "query_fleet_saved_views",
    "Read this account's current authorized saved Fleet filters; no coworker personal views.",
  ),
  action(
    "manage_fleet_saved_view",
    "Prepare saving or archiving your own authorized Fleet filters. Archive retains history; no company setting or business record changes.",
    {
      action: { type: "string", enum: ["save", "archive"] },
      viewId: id,
      expectedVersion: { type: "integer", minimum: 1 },
      name: { type: "string", minLength: 1, maxLength: 100 },
      filters: {
        type: "object",
        properties: reportFilters,
        additionalProperties: false,
      },
    },
    ["action"],
  ),
  read(
    "query_fleet_maintenance",
    "Read explicitly authorized maintenance and reported defects; repair notes are user reports, not physical or regulatory certification.",
    {
      maintenanceId: id,
      limit: { type: "integer", minimum: 1, maximum: 50 },
      cursor: { type: "string", pattern: "^[0-9]{1,10}$" },
    },
  ),
  action(
    "report_fleet_defect",
    "Prepare a user-reported defect for the exact assigned run equipment. Creates an inventory hold after authorization; never invent damage or repair evidence.",
    {
      fleetId: id,
      assetId: id,
      runId: id,
      title: { type: "string", minLength: 1, maxLength: 200 },
      notes: { type: "string", minLength: 1, maxLength: 2000 },
    },
    ["fleetId", "assetId", "title", "notes"],
  ),
  action(
    "manage_fleet_maintenance",
    "Prepare Fleet Manager scheduled service, triage or user-reported repair notes. Release additionally requires explicit current safetyRelease and prior repair record; releases only this work order hold. Never certify physical repairs or compliance.",
    {
      action: {
        type: "string",
        enum: ["create", "triage", "record_repair", "release", "cancel"],
      },
      maintenanceId: id,
      expectedVersion: { type: "integer", minimum: 1 },
      fleetId: id,
      assetId: id,
      runId: id,
      title: { type: "string", minLength: 1, maxLength: 200 },
      notes: { type: "string", minLength: 1, maxLength: 2000 },
      dueAt: { type: "string", format: "date-time" },
    },
    ["action", "notes"],
  ),
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
        supportGrants: {
          type: "array",
          maxItems: 50,
          items: {
            type: "object",
            properties: {
              userId: { type: "integer", minimum: 1 },
              fleetIds: { type: "array", items: id, minItems: 1, maxItems: 50 },
              siteIds: {
                type: "array",
                items: { type: "integer", minimum: 1 },
                minItems: 1,
                maxItems: 200,
              },
              expiresAt: {
                type: "string",
                format: "date-time",
                description:
                  "At most seven days from approval; expired grants authorize no read.",
              },
              reason: { type: "string", minLength: 1, maxLength: 2000 },
              financeRead: { type: "boolean" },
            },
            required: ["userId", "fleetIds", "siteIds", "expiresAt", "reason"],
            additionalProperties: false,
          },
        },
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
    "Read one authorized Fleet run page and exceptions; use returned nextCursor for more. Loaded counts are not complete totals. No telemetry or device capture is inferred.",
    page,
  ),
  read(
    "query_fleet_runs",
    "Read one run page permitted by current company/fleet/site grants and own-driver assignment; use returned nextCursor for more. Loaded counts are not complete totals.",
    page,
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
