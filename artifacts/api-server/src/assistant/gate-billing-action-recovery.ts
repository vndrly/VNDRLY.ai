import {
  GateDailyBillingReceiptSchema,
  GateDailyBillingSetupSchema,
} from "@workspace/api-zod";
import { z } from "zod/v4";
import type { SessionPayload } from "../lib/session";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { fleetInventoryOperationId } from "./fleet-inventory-tools";
export const isGateBillingAction = (name: string) =>
  ["configure_gate_daily_billing", "invoice_gate_post"].includes(name);
/** Read the original operation and current authorized post; never repeats a bill. */
export async function readGateBillingAction(
  name: string,
  fields: Record<string, unknown>,
  operationId: string,
  session: SessionPayload,
  request = callNaturalVoiceDomainApi,
) {
  if (!isGateBillingAction(name) || !session.userId || !session.vendorId)
    throw Error("Current office company required");
  const stationId = z.uuid().parse(fields.stationId);
  z.uuid().parse(operationId);
  const receipt = GateDailyBillingReceiptSchema.parse(
    await request(
      `/gate-billing/${stationId}/receipts/${operationId}`,
      "GET",
      {},
      session,
    ),
  );
  if (
    receipt.state !== "completed" ||
    receipt.operationId !== operationId ||
    receipt.stationId !== stationId ||
    receipt.kind !==
      (name === "invoice_gate_post" ? "invoice_now" : "configure")
  )
    throw Error("Original billing receipt unavailable");
  const current = GateDailyBillingSetupSchema.parse(
    await request(`/gate-billing/${stationId}/setup`, "GET", {}, session),
  );
  if (
    current.post.id !== stationId ||
    current.config?.vendorId !== session.vendorId
  )
    throw Error("Current post readback unavailable");
  const result = receipt.result;
  if ("version" in result) {
    if (
      result.vendorId !== session.vendorId ||
      result.stationId !== stationId ||
      current.config.version < result.version
    )
      throw Error("Saved setup readback mismatch");
  } else if (result.status === "submitted") {
    const through = current.config.lastBilledThroughDay;
    if (
      !through ||
      through < result.billedThroughDay ||
      (through === result.billedThroughDay &&
        current.config.openTicketId !== result.nextTicketId)
    )
      throw Error("Saved billing period readback mismatch");
  }
  return { ...result, operationId, verified: true, receipt, readback: current };
}
export async function recoverGateBillingAction(
  action: {
    toolName: string;
    tokenHash: string;
    arguments: Record<string, unknown>;
  },
  session: SessionPayload,
  scopes: string[],
  request = callNaturalVoiceDomainApi,
) {
  if (
    !isGateBillingAction(action.toolName) ||
    !/^[a-f0-9]{64}$/.test(action.tokenHash) ||
    !chatGptActionTools(session, scopes).some(
      (tool) => tool.name === action.toolName,
    )
  )
    return null;
  try {
    return await readGateBillingAction(
      action.toolName,
      action.arguments,
      fleetInventoryOperationId({
        idempotencyKey: `chatgpt:${action.tokenHash}`,
      }),
      session,
      request,
    );
  } catch {
    return null;
  }
}
