import {
  MeetingSpeakRequestReceiptSchema,
  type MeetingSpeakRequestReceipt,
} from "@workspace/api-zod";

export class MeetingSpeakRequestError extends Error {
  readonly code = "work_hub.meeting";
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export type SpeakRequestActor = {
  actorUserId: number;
  actorMembershipId: number | null;
  actorSessionVersion: number;
  ownerOrgType: "vendor" | "partner";
  ownerOrgId: number;
};
/** Caller holds the exact occurrence and current actor locks for the whole transaction. */
export async function applyMeetingSpeakRequest(
  occurrenceId: string,
  actor: SpeakRequestActor,
  operationId: string,
  deps: {
    authorize: () => Promise<void>;
    prior: () => Promise<unknown | null>;
    create: () => Promise<{ requestId: string; requestedAt: Date }>;
    save: (receipt: MeetingSpeakRequestReceipt) => Promise<void>;
  },
  readOnly = false,
): Promise<MeetingSpeakRequestReceipt | null> {
  await deps.authorize();
  const prior = await deps.prior();
  if (prior !== null) {
    const parsed = MeetingSpeakRequestReceiptSchema.safeParse(prior);
    if (
      !parsed.success ||
      parsed.data.occurrenceId !== occurrenceId ||
      parsed.data.operationId !== operationId ||
      Object.entries(actor).some(
        ([key, value]) => parsed.data[key as keyof SpeakRequestActor] !== value,
      )
    )
      throw new MeetingSpeakRequestError(
        409,
        "Speak request operation conflicts with the original account or occurrence",
      );
    return parsed.data;
  }
  if (readOnly) return null;
  const saved = await deps.create();
  const receipt = MeetingSpeakRequestReceiptSchema.parse({
    ...actor,
    occurrenceId,
    operationId,
    requestId: saved.requestId,
    requestedAt: saved.requestedAt.toISOString(),
    status: "saved",
    microphoneOpened: false,
    consentAccepted: false,
  });
  await deps.save(receipt);
  return receipt;
}
