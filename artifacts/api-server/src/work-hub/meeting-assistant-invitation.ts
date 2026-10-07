import { createHash } from "node:crypto";
import {
  MeetingAssistantInvitationInputSchema,
  MeetingAssistantInvitationReceiptSchema,
  type MeetingAssistantInvitationInput,
  type MeetingAssistantInvitationReceipt,
} from "@workspace/api-zod";
export class MeetingInvitationError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
export type InvitationActor = {
  userId: number;
  actorMembershipId: number | null;
  actorSessionVersion: number;
  ownerOrgType: "vendor" | "partner";
  ownerOrgId: number;
};
export function meetingInvitationVersion(
  runtime: Record<string, unknown>,
): number {
  const v = runtime.askvInvitationRevision ?? 0;
  if (!Number.isSafeInteger(v) || Number(v) < 0)
    throw new MeetingInvitationError(409, "Invalid saved invitation revision");
  return Number(v);
}
export function meetingInvitationFingerprint(
  occurrenceId: string,
  actor: InvitationActor,
  command: MeetingAssistantInvitationInput,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        occurrenceId,
        actor: {
          userId: actor.userId,
          ownerOrgType: actor.ownerOrgType,
          ownerOrgId: actor.ownerOrgId,
          actorMembershipId: actor.actorMembershipId,
          actorSessionVersion: actor.actorSessionVersion,
        },
        ...MeetingAssistantInvitationInputSchema.parse(command),
      }),
    )
    .digest("hex");
}
export async function applyMeetingInvitation(
  occurrenceId: string,
  actor: InvitationActor,
  raw: unknown,
  deps: {
    authorize: () => Promise<void>;
    prior: (operationId: string) => Promise<unknown | null>;
    state: () => { runtime: Record<string, unknown>; invited: boolean };
    save: (
      receipt: MeetingAssistantInvitationReceipt,
      runtime: Record<string, unknown>,
    ) => Promise<void>;
    now: () => Date;
  },
  readOnly = false,
) {
  const command = MeetingAssistantInvitationInputSchema.parse(raw);
  await deps.authorize();
  const fingerprint = meetingInvitationFingerprint(
    occurrenceId,
    actor,
    command,
  );
  const prior = await deps.prior(command.operationId);
  if (prior !== null) {
    const r = MeetingAssistantInvitationReceiptSchema.parse(prior);
    if (
      r.operationId !== command.operationId ||
      r.expectedVersion !== command.expectedVersion ||
      r.invited !== command.invited ||
      r.version !== command.expectedVersion + 1 ||
      r.actorMembershipId !== actor.actorMembershipId ||
      r.actorSessionVersion !== actor.actorSessionVersion ||
      r.fingerprint !== fingerprint ||
      r.occurrenceId !== occurrenceId ||
      r.actorUserId !== actor.userId ||
      r.ownerOrgType !== actor.ownerOrgType ||
      r.ownerOrgId !== actor.ownerOrgId
    )
      throw new MeetingInvitationError(
        409,
        "Operation belongs to another reviewed invitation",
      );
    return r;
  }
  if (readOnly) return null;
  const state = deps.state(),
    version = meetingInvitationVersion(state.runtime);
  if (command.expectedVersion !== version)
    throw new MeetingInvitationError(
      409,
      "Refresh the meeting invitation before reviewing a new request",
    );
  const receipt = MeetingAssistantInvitationReceiptSchema.parse({
    ...command,
    ownerOrgType: actor.ownerOrgType,
    ownerOrgId: actor.ownerOrgId,
    actorUserId: actor.userId,
    actorMembershipId: actor.actorMembershipId,
    actorSessionVersion: actor.actorSessionVersion,
    occurrenceId,
    fingerprint,
    version: version + 1,
    status: "applied",
    changed: state.invited !== command.invited,
    recordedAt: deps.now().toISOString(),
    consentAccepted: false,
    deviceCaptureStarted: false,
  });
  await deps.save(receipt, {
    ...state.runtime,
    askvInvitationRevision: receipt.version,
  });
  return receipt;
}
