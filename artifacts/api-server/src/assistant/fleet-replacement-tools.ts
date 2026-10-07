import { z } from "zod/v4";
import {
  FleetReplacementInputSchema,
  FleetReplacementActionSchema,
} from "@workspace/api-zod";
import type { AskVToolDefinition } from "./tool-registry";
const id = { type: "string", format: "uuid" };
const tool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  mutating = true,
): AskVToolDefinition => ({
  name,
  description,
  inputSchema: {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  },
  roles: ["vendor", "field_employee"],
  mutating,
  confirmation: mutating ? "required" : "none",
  risk: mutating ? "high" : "read",
  execution: "server",
  pack: "role",
  auditTarget: "work_hub",
});
export const FLEET_REPLACEMENT_ACTIONS: Record<string, "accept" | "cancel"> = {
  accept_fleet_equipment_replacement: "accept",
  cancel_fleet_equipment_replacement: "cancel",
};
export const FLEET_REPLACEMENT_TOOLS: AskVToolDefinition[] = [
  tool(
    "query_fleet_equipment_replacements",
    "Read exact authorized run equipment replacement proposals and current allowedActions. Inventory custody is unchanged; recorded acceptance is not physical exchange proof.",
    { runId: id },
    ["runId"],
    false,
  ),
  tool(
    "prepare_fleet_equipment_replacement",
    "Prepare Manager/Dispatcher equipment replacement for an exact paused active run. The replacement truck and selected trailer must already be in the assigned driver's canonical Inventory custody; Fleet never changes holders. Driver must separately accept and report a fresh equipment inspection and distance meter before resume. Ask for exact equipment IDs, current version and actual reason.",
    {
      runId: id,
      ...z.toJSONSchema(FleetReplacementInputSchema.omit({ operationId: true }))
        .properties,
    },
    ["runId", "expectedVersion", "vehicleAssetId", "trailerAssetId", "reason"],
  ),
  ...Object.entries(FLEET_REPLACEMENT_ACTIONS).map(([name, action]) =>
    tool(
      name,
      action === "accept"
        ? "Prepare only your own assigned-driver acceptance of a paused run equipment replacement. Current custody and readiness are rechecked; acceptance stays paused and requires fresh inspection and meter, never claims physical exchange or starts tracking."
        : "Prepare Manager/Dispatcher cancellation of a still-proposed equipment replacement. Cannot undo an accepted replacement or change Inventory custody.",
      {
        runId: id,
        replacementId: id,
        ...z.toJSONSchema(
          FleetReplacementActionSchema.omit({
            operationId: true,
            action: true,
          }),
        ).properties,
      },
      [
        "runId",
        "replacementId",
        "expectedVersion",
        "runExpectedVersion",
        "notes",
      ],
    ),
  ),
];
