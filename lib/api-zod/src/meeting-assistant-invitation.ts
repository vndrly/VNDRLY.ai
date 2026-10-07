import { z } from "zod/v4";
export const MeetingAssistantInvitationInputSchema = z
  .object({
    operationId: z.uuid(),
    expectedVersion: z.number().int().nonnegative(),
    invited: z.boolean(),
  })
  .strict();
export type MeetingAssistantInvitationInput = z.infer<
  typeof MeetingAssistantInvitationInputSchema
>;
export const MeetingAssistantInvitationReceiptSchema =
  MeetingAssistantInvitationInputSchema.extend({
    occurrenceId: z.uuid(),
    actorUserId: z.number().int().positive(),
    actorMembershipId: z.number().int().positive().nullable(),
    actorSessionVersion: z.number().int().positive(),
    ownerOrgType: z.enum(["vendor", "partner"]),
    ownerOrgId: z.number().int().positive(),
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    version: z.number().int().positive(),
    status: z.literal("applied"),
    changed: z.boolean(),
    recordedAt: z.iso.datetime(),
    consentAccepted: z.literal(false),
    deviceCaptureStarted: z.literal(false),
  }).strict();
export type MeetingAssistantInvitationReceipt = z.infer<
  typeof MeetingAssistantInvitationReceiptSchema
>;
export async function saveMeetingAssistantInvitation(
  occurrenceId: string,
  command: MeetingAssistantInvitationInput,
  request: (
    path: string,
    init: { method: string; body?: string },
  ) => Promise<unknown>,
): Promise<MeetingAssistantInvitationReceipt> {
  z.uuid().parse(occurrenceId);
  MeetingAssistantInvitationInputSchema.parse(command);
  const lookup = z
    .object({ receipt: MeetingAssistantInvitationReceiptSchema.nullable() })
    .strict()
    .parse(
      await request(
        "/meetings/" +
          occurrenceId +
          "/askv/operations/" +
          command.operationId +
          "?expectedVersion=" +
          command.expectedVersion +
          "&invited=" +
          command.invited,
        { method: "GET" },
      ),
    );
  const receipt =
    lookup.receipt ??
    MeetingAssistantInvitationReceiptSchema.parse(
      await request("/meetings/" + occurrenceId + "/askv", {
        method: "POST",
        body: JSON.stringify(command),
      }),
    );
  if (
    receipt.occurrenceId !== occurrenceId ||
    receipt.operationId !== command.operationId ||
    receipt.expectedVersion !== command.expectedVersion ||
    receipt.invited !== command.invited ||
    receipt.version !== command.expectedVersion + 1
  )
    throw Error("Saved invitation does not match the reviewed request");
  return receipt;
}
