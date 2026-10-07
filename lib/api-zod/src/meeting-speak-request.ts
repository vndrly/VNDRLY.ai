import { z } from "zod/v4";

export const MeetingSpeakRequestInputSchema = z
  .object({ operationId: z.uuid() })
  .strict();
export const MeetingSpeakRequestReceiptSchema =
  MeetingSpeakRequestInputSchema.extend({
    occurrenceId: z.uuid(),
    actorUserId: z.number().int().positive(),
    actorMembershipId: z.number().int().positive().nullable(),
    actorSessionVersion: z.number().int().positive(),
    ownerOrgType: z.enum(["vendor", "partner"]),
    ownerOrgId: z.number().int().positive(),
    requestId: z.uuid(),
    requestedAt: z.iso.datetime(),
    status: z.literal("saved"),
    microphoneOpened: z.literal(false),
    consentAccepted: z.literal(false),
  }).strict();
export type MeetingSpeakRequestReceipt = z.infer<
  typeof MeetingSpeakRequestReceiptSchema
>;

/** Read the exact operation before retrying; a denied or malformed lookup never authorizes a POST. */
export async function saveMeetingSpeakRequest(
  occurrenceId: string,
  actorUserId: number,
  operationId: string,
  request: (
    path: string,
    init: { method: string; body?: string },
  ) => Promise<unknown>,
  allowCreate = true,
): Promise<MeetingSpeakRequestReceipt> {
  z.uuid().parse(occurrenceId);
  z.number().int().positive().parse(actorUserId);
  const command = MeetingSpeakRequestInputSchema.parse({ operationId });
  const lookup = z
    .object({ receipt: MeetingSpeakRequestReceiptSchema.nullable() })
    .strict()
    .parse(
      await request(
        `/meetings/${occurrenceId}/request-to-speak/operations/${operationId}`,
        { method: "GET" },
      ),
    );
  if (lookup.receipt === null && !allowCreate) throw Error("The original speak request result remains unresolved");
  const receipt =
    lookup.receipt ??
    MeetingSpeakRequestReceiptSchema.parse(
      await request(`/meetings/${occurrenceId}/request-to-speak`, {
        method: "POST",
        body: JSON.stringify(command),
      }),
    );
  if (
    receipt.operationId !== operationId ||
    receipt.occurrenceId !== occurrenceId ||
    receipt.actorUserId !== actorUserId
  )
    throw Error("Saved speak request does not match the original operation");
  return receipt;
}
