import { createHash } from "node:crypto";
import { FleetInventoryDetailSchema, FleetInventoryReceiptSchema } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { fleetInventoryAction, fleetInventoryCommand } from "./fleet-inventory-tools";

/** Independent receipt and current asset reads; never repeats a mutation. */
export async function readFleetInventoryAction(name: string, fields: Record<string, unknown>, operationId: string, session: SessionPayload, request = callNaturalVoiceDomainApi) {
  if (!session.userId || !session.vendorId || !fleetInventoryAction(name)) throw Error("Fleet Inventory authority unavailable");
  const command = fleetInventoryCommand(name, fields, operationId);
  const receipt = FleetInventoryReceiptSchema.parse(await request(`/fleet/inventory/operations/${operationId}`, "GET", {}, session));
  const fingerprint = createHash("sha256").update(JSON.stringify([command.action, command.assetId, session.userId, session.vendorId, command.body])).digest("hex");
  if (receipt.operationId !== operationId || receipt.fingerprint !== fingerprint || (command.assetId !== null && receipt.assetId !== command.assetId)) throw Error("Fleet Inventory receipt did not match the reviewed action");
  const current = FleetInventoryDetailSchema.parse(await request(`/fleet/inventory/${receipt.assetId}`, "GET", {}, session));
  if (!current.canManage || current.asset.id !== receipt.assetId || current.asset.version < receipt.version) throw Error("Fleet Inventory readback unavailable");
  return { ...receipt, readback: current, verified: true };
}

export async function recoverFleetInventoryAction(action: { toolName: string; tokenHash: string; arguments: Record<string, unknown> }, session: SessionPayload, scopes: string[], request = callNaturalVoiceDomainApi) {
  if (!fleetInventoryAction(action.toolName) || !/^[a-f0-9]{64}$/.test(action.tokenHash) || !chatGptActionTools(session, scopes).some(tool => tool.name === action.toolName)) return null;
  try {
    const hex = action.tokenHash.slice(0, 32);
    const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    return await readFleetInventoryAction(action.toolName, action.arguments, operationId, session, request);
  } catch { return null; }
}
