export type ModerationParticipant = {
  userId: number;
  role: string;
  present: boolean;
  removedAt?: Date | string | null;
  organizationAdmin?: boolean;
  hostMutedAt?: Date | string | null;
  hostMutedById?: number | null;
  hostMuteGeneration?: number;
};

export class MeetingModerationError extends Error {
  constructor(readonly code: "forbidden" | "not_found" | "not_host_muted", message: string) {
    super(message);
    this.name = "MeetingModerationError";
  }
}

function active(participant: ModerationParticipant) {
  return !participant.removedAt;
}

export function canModerateParticipant(actor: ModerationParticipant, target: ModerationParticipant) {
  if (!active(actor) || !active(target) || actor.userId === target.userId) return false;
  if (actor.role === "host") return target.role !== "host";
  return actor.role === "co_host" && target.role === "participant";
}

function nextGeneration(target: ModerationParticipant) {
  return Math.max(0, target.hostMuteGeneration ?? 0) + 1;
}

export function imposeHostMute(actor: ModerationParticipant, target: ModerationParticipant, now = new Date()) {
  if (!canModerateParticipant(actor, target)) throw new MeetingModerationError("forbidden", "Only the meeting host or an assigned co-host can mute this attendee");
  return { hostMutedAt: now, hostMutedById: actor.userId, hostMuteGeneration: nextGeneration(target), muted: true };
}

export function releaseHostMute(actor: ModerationParticipant, target: ModerationParticipant) {
  if (!target.hostMutedAt) throw new MeetingModerationError("not_host_muted", "This attendee is not muted by the host");
  if (!canModerateParticipant(actor, target)) throw new MeetingModerationError("forbidden", "Only the meeting host or an assigned co-host can release this mute");
  // Releasing the host lock never remotely opens the attendee microphone.
  return { hostMutedAt: null, hostMutedById: null, hostMuteGeneration: nextGeneration(target), muted: true };
}

export function routeSpeakRequest(participants: ModerationParticipant[], requesterUserId: number) {
  const requester = participants.find(value => value.userId === requesterUserId && active(value));
  if (!requester) throw new MeetingModerationError("not_found", "Attendee not found");
  if (!requester.hostMutedAt) throw new MeetingModerationError("not_host_muted", "Request to speak is only available while muted by the host");
  const authorityUserIds = participants
    .filter(value => active(value) && value.present && value.userId !== requesterUserId && ["host", "co_host"].includes(value.role))
    .sort((a, b) => (a.role === "host" ? -1 : 1) - (b.role === "host" ? -1 : 1) || a.userId - b.userId)
    .map(value => value.userId);
  const authority = new Set(authorityUserIds);
  const fallbackAdminUserIds = participants
    .filter(value => active(value) && value.present && value.organizationAdmin && value.userId !== requesterUserId && !authority.has(value.userId))
    .map(value => value.userId)
    .sort((a, b) => a - b);
  return { authorityUserIds, fallbackAdminUserIds };
}
