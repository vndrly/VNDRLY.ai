import { z } from "zod/v4";
import { FleetRunBillingInputSchema } from "@workspace/api-zod";
import type { SessionPayload } from "../lib/session";
import { callNaturalVoiceDomainApi } from "./natural-voice-write-tools";
import { chatGptActionTools } from "./chatgpt-tool-access";
import { fleetInventoryOperationId } from "./fleet-inventory-tools";
const argumentsSchema = z
  .object({
    ticketId: z.number().int().positive(),
    expectedVersion: z.number().int().positive(),
  })
  .strict();
/** Canonical read only: an uncertain finalization is never replayed with a fresh operation. */
export async function readFleetBillingAction(
  fields: Record<string, unknown>,
  operationId: string,
  session: SessionPayload,
  request = callNaturalVoiceDomainApi,
) {
  if (!session.userId || !session.vendorId)
    throw Error("Current Fleet company authority required.");
  const args = argumentsSchema.parse(fields);
  z.uuid().parse(operationId);
  const raw = await request(
    `/fleet/tickets/${args.ticketId}/plan`,
    "GET",
    {},
    session,
  );
  const saved = z
    .object({
      ticketId: z.number().int(),
      status: z.string(),
      afeNumber: z.string(),
      workDate: z.string(),
      plan: z.object({ version: z.number().int() }),
      finalizationOperationId: z.uuid(),
    })
    .passthrough()
    .parse(raw);
  if (
    saved.ticketId !== args.ticketId ||
    saved.status !== "submitted" ||
    saved.finalizationOperationId !== operationId ||
    saved.plan.version <= args.expectedVersion
  )
    throw Error(
      "Fleet ticket finalization readback did not match the confirmed operation.",
    );
  return {
    ticketId: args.ticketId,
    status: saved.status,
    operationId,
    readback: saved,
    verified: true,
  };
}
export async function recoverFleetBillingAction(
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
    action.toolName !== "finalize_fleet_ticket" ||
    !/^[a-f0-9]{64}$/.test(action.tokenHash) ||
    !chatGptActionTools(session, scopes).some((t) => t.name === action.toolName)
  )
    return null;
  try {
    return await readFleetBillingAction(
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

export async function readFleetRunCreation(
  fields: Record<string, unknown>,
  operationId: string,
  runId: string,
  session: SessionPayload,
  request = callNaturalVoiceDomainApi,
) {
  if (!session.userId || !session.vendorId)
    throw Error("Current Fleet company authority required.");
  z.uuid().parse(operationId);
  z.uuid().parse(runId);
  const billing = FleetRunBillingInputSchema.parse(fields.billing);
  const saved = z
    .object({
      id: z.uuid(),
      companyId: z.number().int(),
      linkedTicketId: z.number().int().positive(),
      billing: z.object({ afeNumber: z.string(), workDate: z.string() }),
      events: z.array(z.object({ operationId: z.uuid() })),
    })
    .passthrough()
    .parse(await request(`/fleet/runs/${runId}`, "GET", {}, session));
  if (
    saved.id !== runId ||
    saved.companyId !== session.vendorId ||
    saved.billing.afeNumber !== billing.afeNumber ||
    saved.billing.workDate !== billing.workDate ||
    (billing.mode === "existing_ticket" &&
      saved.linkedTicketId !== billing.ticketId) ||
    !saved.events.some((e) => e.operationId === operationId)
  )
    throw Error(
      "Fleet run creation readback did not match the confirmed billing operation.",
    );
  return { ...saved, verified: true };
}
/** Search authorized current pages only, then read the exact run. Never resubmits creation. */
export async function recoverFleetRunCreation(
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
    action.toolName !== "manage_fleet_run" ||
    action.arguments.action !== "create" ||
    !/^[a-f0-9]{64}$/.test(action.tokenHash) ||
    !scopes.includes("fleet:read") ||
    !chatGptActionTools(session, scopes).some((t) => t.name === action.toolName)
  )
    return null;
  const operationId = fleetInventoryOperationId({
    idempotencyKey: `chatgpt:${action.tokenHash}`,
  });
  try {
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const page = z
        .object({
          runs: z.array(
            z.object({
              id: z.uuid(),
              events: z.array(z.object({ operationId: z.uuid() })),
            }),
          ),
          page: z.object({ nextCursor: z.string().nullable() }).optional(),
        })
        .parse(
          await request(
            "/fleet/overview?limit=50" +
              (cursor ? "&cursor=" + encodeURIComponent(cursor) : ""),
            "GET",
            {},
            session,
          ),
        );
      const found = page.runs.find((run) =>
        run.events.some((e) => e.operationId === operationId),
      );
      if (found)
        return await readFleetRunCreation(
          action.arguments,
          operationId,
          found.id,
          session,
          request,
        );
      cursor = page.page?.nextCursor ?? null;
      if (cursor && seen.has(cursor)) return null;
      if (cursor) seen.add(cursor);
    } while (cursor);
    return null;
  } catch {
    return null;
  }
}
