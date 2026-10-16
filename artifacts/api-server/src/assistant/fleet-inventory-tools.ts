import { z } from "zod/v4";
import { createHash } from "node:crypto";
import { FleetAssetCreateSchema, FleetAssetEditSchema, FleetAssetEnrollmentSchema } from "@workspace/api-zod";
import type { AskVToolDefinition } from "./tool-registry";

export const FLEET_INVENTORY_ACTIONS = ["create_fleet_inventory_asset", "enroll_fleet_inventory_asset", "edit_fleet_inventory_asset"] as const;
export const fleetInventoryAction = (name: string) => (FLEET_INVENTORY_ACTIONS as readonly string[]).includes(name);
const id = z.uuid();
export const FleetInventoryListArguments = z.object({ after: id.optional(), fleetId: id.optional() }).strict();
export const FleetInventoryDetailArguments = z.object({ assetId: id }).strict();
/** Called only after the existing server confirmation gate. Model operation IDs cannot override its key. */
export function fleetInventoryOperationId(input: Record<string, unknown>) {
  const key = typeof input.idempotencyKey === "string" ? input.idempotencyKey.trim() : "";
  if (!key) return z.uuid().parse(input.operationId);
  const chatGpt = /^chatgpt:([a-f0-9]{64})$/.exec(key);
  const hex = chatGpt ? chatGpt[1] : createHash("sha256").update(JSON.stringify(["askv-fleet-inventory", key])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${chatGpt ? "4" : "5"}${hex.slice(13, 16)}-${chatGpt ? "8" : "a"}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function fleetInventoryCommand(name: string, input: Record<string, unknown>, operationId: string) {
  const { assetId, ...fields } = fleetInventoryArguments(name).parse(input) as Record<string, unknown>;
  const schema = name === FLEET_INVENTORY_ACTIONS[0] ? FleetAssetCreateSchema : name === FLEET_INVENTORY_ACTIONS[1] ? FleetAssetEnrollmentSchema : FleetAssetEditSchema;
  return { assetId: typeof assetId === "string" ? assetId : null, action: name === FLEET_INVENTORY_ACTIONS[0] ? "create" : name === FLEET_INVENTORY_ACTIONS[1] ? "enroll" : "edit", body: schema.parse({ ...fields, operationId }) };
}
export function fleetInventoryArguments(name: string) {
  if (name === FLEET_INVENTORY_ACTIONS[0]) return FleetAssetCreateSchema.omit({ operationId: true });
  if (name === FLEET_INVENTORY_ACTIONS[1]) return FleetAssetEnrollmentSchema.omit({ operationId: true }).extend({ assetId: id }).strict();
  if (name === FLEET_INVENTORY_ACTIONS[2]) return FleetAssetEditSchema.omit({ operationId: true }).extend({ assetId: id, manufacturer: z.string().trim().max(120), model: z.string().trim().max(120) }).strict();
  throw Error("Unsupported Fleet Inventory action");
}
function definition(name: string, description: string, schema: z.ZodType, mutating = false): AskVToolDefinition {
  return { name, description, inputSchema: z.toJSONSchema(schema) as AskVToolDefinition["inputSchema"], roles: ["vendor", "field_employee"], mutating, confirmation: mutating ? "required" : "none", risk: mutating ? "high" : "read", execution: "server", pack: "role", auditTarget: "work_hub" };
}
export const FLEET_INVENTORY_TOOLS = [
  definition("query_fleet_inventory", "Read the current company's authorized Fleet Inventory pool, optionally one Detail (temporary work group) by exact fleetId and the exact returned UUID after cursor. Includes canonical asset identifiers, holds and recorded custody; counts cover this returned page only. This never assigns equipment to a Detail or changes custody.", FleetInventoryListArguments),
  definition("query_fleet_inventory_detail", "Read one exact authorized Fleet Inventory asset, saved history, permitted run history and maintenance. Preserve historyLimited. Current holder is recorded custody, not physical proof; holds remain authoritative.", FleetInventoryDetailArguments),
  definition(FLEET_INVENTORY_ACTIONS[0], "Prepare creation of a canonical vehicle/truck/trailer in Fleet Inventory using the user's exact identifier and legal owner. Requires current Fleet Manager plus Inventory authority and explicit Fleet Inventory consent in ChatGPT. Approval required. Adds to company pool only; never assigns a Detail, changes custody, releases holds or creates a run/ticket. Read saved result before reporting completion.", fleetInventoryArguments(FLEET_INVENTORY_ACTIONS[0]), true),
  definition(FLEET_INVENTORY_ACTIONS[1], "Prepare enrollment of an existing exact canonical asset into Fleet Inventory with its current expectedVersion. Requires Fleet Manager plus Inventory authority and approval. Resolve the existing asset first; never create a duplicate for enrollment. Pool enrollment never assigns a Detail, changes custody or releases a hold.", fleetInventoryArguments(FLEET_INVENTORY_ACTIONS[1]), true),
  definition(FLEET_INVENTORY_ACTIONS[2], "Prepare editing an exact Fleet Inventory asset's name, manufacturer and model with its current expectedVersion. Requires Fleet Manager plus Inventory authority and approval. Supply all reviewed fields. Never alters identifiers, legal ownership, Detail membership, custody or holds. Preserve the original action on an uncertain result.", fleetInventoryArguments(FLEET_INVENTORY_ACTIONS[2]), true),
];

export function fleetInventoryRequest(name: string, input: Record<string, unknown>) {
  if (name === "query_fleet_inventory") { const fields = FleetInventoryListArguments.parse(input); const params = new URLSearchParams(Object.entries(fields)); return { method: "GET" as const, path: `/fleet/inventory${params.size ? `?${params}` : ""}`, body: {} }; }
  if (name === "query_fleet_inventory_detail") { const { assetId } = FleetInventoryDetailArguments.parse(input); return { method: "GET" as const, path: `/fleet/inventory/${assetId}`, body: {} }; }
  const { operationId, confirmed: _confirmed, idempotencyKey: _key, voiceSessionId: _voice, ...fields } = input;
  const { assetId, body } = fleetInventoryCommand(name, fields, fleetInventoryOperationId(input));
  return { method: name === FLEET_INVENTORY_ACTIONS[2] ? "PATCH" as const : "POST" as const, path: name === FLEET_INVENTORY_ACTIONS[0] ? "/fleet/inventory" : `/fleet/inventory/${assetId}${name === FLEET_INVENTORY_ACTIONS[1] ? "/enroll" : ""}`, body };
}
