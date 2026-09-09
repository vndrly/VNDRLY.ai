export type MeetingParticipantState = {
  userId: number;
  role: string;
  removedAt?: Date | null;
};

export function isActiveMeetingParticipant(
  participant: MeetingParticipantState | undefined,
): participant is MeetingParticipantState {
  return Boolean(participant && !participant.removedAt);
}

export function canReadMeetingMessage(
  viewerUserId: number,
  senderUserId: number,
  recipientUserId: number | null,
) {
  return (
    recipientUserId === null ||
    viewerUserId === senderUserId ||
    viewerUserId === recipientUserId
  );
}

export function canRemoveMeetingParticipant(
  actor: MeetingParticipantState,
  target: MeetingParticipantState,
) {
  return (
    isActiveMeetingParticipant(actor) &&
    actor.role === "host" &&
    isActiveMeetingParticipant(target) &&
    target.role !== "host" &&
    actor.userId !== target.userId
  );
}

export function shouldWarnMeetingTime(
  elapsedMs: number,
  targetMs: number | null,
) {
  if (targetMs === null || targetMs <= 0) return false;
  return targetMs - elapsedMs <= 10 * 60 * 1000;
}
