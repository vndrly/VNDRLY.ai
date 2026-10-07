import { createHash } from "node:crypto";
import {
  FleetAvailabilityInputSchema,
  FleetAvailabilityReadbackSchema,
  fleetAvailabilityFingerprintValues,
} from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";

/** Exact current-authorized receipt lookup only; recovery never records availability. */
export async function recoverFleetAvailabilityAction(
  action: {
    toolName: string;
    tokenHash: string;
    arguments: Record<string, unknown>;
  },
  session: SessionPayload,
  scopes: string[],
  request: typeof callNaturalVoiceDomainApi = callNaturalVoiceDomainApi,
) {
  if (
    action.toolName !== "record_fleet_driver_availability" ||
    !/^[a-f0-9]{64}$/.test(action.tokenHash) ||
    !session.userId ||
    !session.vendorId ||
    !chatGptActionTools(session, scopes).some(
      (tool) => tool.name === action.toolName,
    )
  )
    return null;
  try {
    const hex = action.tokenHash.slice(0, 32);
    const operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    // Stored reviewed business fields remain strict: caller authority or UUID fields fail closed.
    const fields = FleetAvailabilityInputSchema.omit({
      operationId: true,
    }).parse(action.arguments);
    const command = FleetAvailabilityInputSchema.parse({
      operationId,
      ...fields,
    });
    const result = FleetAvailabilityReadbackSchema.parse(
      await request(
        `/fleet/drivers/${command.driverUserId}/availability/operations/${operationId}`,
        "GET",
        {},
        session,
      ),
    );
    const receipt = result.receipt;
    if (!receipt) return null;
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify(
          fleetAvailabilityFingerprintValues(
            session.userId,
            session.vendorId,
            command,
          ),
        ),
      )
      .digest("hex");
    if (
      receipt.operationId !== operationId ||
      receipt.actorUserId !== session.userId ||
      receipt.companyId !== session.vendorId ||
      receipt.driverUserId !== command.driverUserId ||
      receipt.commandFingerprint !== fingerprint ||
      receipt.previousFingerprint !== command.expectedFingerprint ||
      (command.recordId !== null && receipt.record.id !== command.recordId) ||
      receipt.record.startsAt !==
        new Date(command.window.plannedStartAt).toISOString() ||
      receipt.record.endsAt !==
        new Date(command.window.plannedEndAt).toISOString() ||
      receipt.record.available !== command.available ||
      receipt.record.recurring
    )
      return null;
    return result;
  } catch {
    return null;
  }
}
