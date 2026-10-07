import { z } from "zod/v4";
import {
  FleetCargoTransferInputSchema,
  FleetCargoTransferActionSchema,
} from "@workspace/api-zod";
import type { AskVToolDefinition } from "./tool-registry";
const runId = { type: "string", format: "uuid" };
const common = (
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
const actionSchema = FleetCargoTransferActionSchema.omit({
  operationId: true,
  action: true,
});
const actionProperties = z.toJSONSchema(actionSchema).properties ?? {};
export const FLEET_CARGO_TOOLS: AskVToolDefinition[] = [
  common(
    "query_fleet_cargo_transfers",
    "Read exact authorized own/scoped run cargo handoff plans and current participant allowedActions. User-reported records do not prove physical handoff or change Inventory custody.",
    { runId },
    ["runId"],
    false,
  ),
  common(
    "prepare_fleet_cargo_transfer",
    "Prepare a full undelivered cargo record handoff between two currently paused active runs at the same actual authorized current stop site. Manager/Dispatcher only; recipient current pickup maps to an explicit later delivery stop. Exact quantities/revisions; no partial transfer, no Inventory holder change. Source and recipient drivers must each separately acknowledge before an authorized manager completes the record.",
    z.toJSONSchema(FleetCargoTransferInputSchema.omit({ operationId: true }))
      .properties ?? {},
    [
      "sourceRunId",
      "targetRunId",
      "sourceExpectedVersion",
      "targetExpectedVersion",
      "sourceLoadId",
      "targetLoadId",
      "siteId",
      "targetDeliveryStopId",
      "quantity",
      "reason",
    ],
  ),
  ...(
    [
      [
        "acknowledge_fleet_cargo_source",
        "Prepare only your own source-driver acknowledgement of an exact cargo handoff plan. Cannot acknowledge for a coworker; no completion or physical proof claim.",
      ],
      [
        "acknowledge_fleet_cargo_recipient",
        "Prepare only your own receiving-driver acknowledgement of an exact cargo handoff plan. Cannot acknowledge for a coworker; no completion or physical proof claim.",
      ],
      [
        "complete_fleet_cargo_transfer",
        "Prepare Manager/Dispatcher completion of an exact cargo record handoff after both actual assigned drivers acknowledged. Rechecks both current run revisions and recipient readiness. Preserves original capture/manifests, counts cargo once, never changes Inventory holder or verifies physical handoff.",
      ],
      [
        "cancel_fleet_cargo_transfer",
        "Prepare Manager/Dispatcher cancellation of an exact still-proposed cargo handoff plan. Records the reason; cannot undo completed cargo or silently change Inventory custody.",
      ],
    ] as const
  ).map(([name, description]) =>
    common(name, description, { transferId: runId, ...actionProperties }, [
      "transferId",
      "expectedVersion",
      "sourceExpectedVersion",
      "targetExpectedVersion",
      "notes",
    ]),
  ),
];
export const FLEET_CARGO_ACTIONS: Record<
  string,
  "acknowledge_source" | "acknowledge_target" | "complete" | "cancel"
> = {
  acknowledge_fleet_cargo_source: "acknowledge_source",
  acknowledge_fleet_cargo_recipient: "acknowledge_target",
  complete_fleet_cargo_transfer: "complete",
  cancel_fleet_cargo_transfer: "cancel",
};
