import { createHash } from "node:crypto";
import { z } from "zod/v4";
import {
  WorkHubShiftOpeningReadbackSchema,
  workHubShiftOpeningFingerprintValues,
} from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
/** Recovers an exact saved planning command only; never opens or claims a shift. */
export async function recoverWorkHubShiftOpeningAction(
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
    action.toolName !== "manage_work_hub_shift" ||
    action.arguments.action !== "update" ||
    !session.userId ||
    !/^[a-f0-9]{64}$/.test(action.tokenHash) ||
    !chatGptActionTools(session, scopes).some((t) => t.name === action.toolName)
  )
    return null;
  try {
    const input = z
      .object({
        action: z.literal("update"),
        shiftId: z.uuid(),
        expectedVersion: z.number().int().positive(),
        owner: z
          .object({
            type: z.enum(["vendor", "partner"]),
            id: z.number().int().positive(),
          })
          .strict()
          .optional(),
        context: z
          .object({
            kind: z.enum(["gate", "organization"]),
            id: z.union([z.string(), z.number()]),
          })
          .strict()
          .optional(),
        payload: z.object({ open: z.boolean() }).strict(),
      })
      .strict()
      .parse(action.arguments);
    const owner =
      input.owner ??
      (session.vendorId
        ? { type: "vendor" as const, id: session.vendorId }
        : session.partnerId
          ? { type: "partner" as const, id: session.partnerId }
          : null);
    if (
      !owner ||
      (owner.type === "vendor" ? session.vendorId : session.partnerId) !==
        owner.id
    )
      return null;
    const hex = action.tokenHash.slice(0, 32),
      operationId = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    const hash = createHash("sha256")
      .update(
        JSON.stringify(
          workHubShiftOpeningFingerprintValues(
            input.shiftId,
            session.userId,
            owner.type,
            owner.id,
            {
              operationId,
              expectedVersion: input.expectedVersion,
              open: input.payload.open,
            },
          ),
        ),
      )
      .digest("hex");
    const { receipt } = WorkHubShiftOpeningReadbackSchema.parse(
      await request(
        `/work-hub/shifts/${input.shiftId}/open/operations/${operationId}`,
        "GET",
        {},
        session,
      ),
    );
    if (
      !receipt ||
      receipt.operationId !== operationId ||
      receipt.actorUserId !== session.userId ||
      receipt.ownerOrgType !== owner.type ||
      receipt.ownerOrgId !== owner.id ||
      receipt.shiftId !== input.shiftId ||
      receipt.previousVersion !== input.expectedVersion ||
      receipt.resultingVersion !== input.expectedVersion + 1 ||
      receipt.open !== input.payload.open ||
      receipt.commandFingerprint !== hash
    )
      return null;
    return receipt;
  } catch {
    return null;
  }
}
