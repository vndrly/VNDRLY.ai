export type ParticipationMode = "view_only" | "active";
export type RecordingHoldKind = "legal" | "incident" | "evidence";

export function participationState(input: { authorizationAcceptedAt: Date | string | null }) {
  if (!input.authorizationAcceptedAt) {
    return {
      mode: "view_only" as const,
      audioAllowed: false,
      messagingAllowed: false,
      code: "meeting.authorization_required" as const,
    };
  }
  return {
    mode: "active" as const,
    audioAllowed: true,
    messagingAllowed: true,
    code: null,
  };
}

export function acceptParticipationAuthorization(input: {
  userId: number;
  policyVersion: number;
  source: "onboarding" | "in_meeting";
  acceptedAt?: Date;
}) {
  if (!Number.isSafeInteger(input.userId) || input.userId <= 0) throw new Error("A valid user is required");
  if (!Number.isSafeInteger(input.policyVersion) || input.policyVersion <= 0) throw new Error("A valid policy version is required");
  return {
    ...input,
    acceptedAt: input.acceptedAt ?? new Date(),
    mode: "active" as const,
    rejoinRequired: false,
  };
}

export function askVParticipantState(input: { invited: boolean; paused?: boolean; removed?: boolean }) {
  const visible = input.invited && !input.removed;
  return {
    visible,
    label: "VNDRLY Assistant" as const,
    silentUnlessAddressed: true,
    countsTowardAttendance: false,
    countsTowardQuorum: false,
    state: !visible ? "removed" as const : input.paused ? "paused" as const : "available" as const,
  };
}

export function startAutomaticTranscript(input: {
  companyPolicyEnabled: boolean;
  companyPolicyVerifiedAt: Date | string | null;
  occurrenceStatus: string;
}) {
  if (!input.companyPolicyEnabled) return { start: false, indicator: "persistent" as const, reason: "policy_disabled" as const };
  if (!input.companyPolicyVerifiedAt) return { start: false, indicator: "persistent" as const, reason: "policy_unverified" as const };
  if (input.occurrenceStatus !== "live") return { start: false, indicator: "persistent" as const, reason: "meeting_not_live" as const };
  return { start: true, indicator: "persistent" as const, reason: "verified_company_policy" as const };
}

export type RecordingHold = ReturnType<typeof placeRecordingHold>;

export function placeRecordingHold(input: {
  kind: RecordingHoldKind;
  reason: string;
  placedByUserId: number;
  placedAt?: Date;
}) {
  const reason = input.reason.trim();
  if (!reason) throw new Error("A recording hold reason is required");
  if (!Number.isSafeInteger(input.placedByUserId) || input.placedByUserId <= 0) throw new Error("A valid hold actor is required");
  return { ...input, reason, placedAt: input.placedAt ?? new Date(), releasedAt: null as Date | null };
}

export function applyRecordingRetention(input: {
  endedAt: Date;
  now?: Date;
  activeHolds: Array<Pick<RecordingHold, "releasedAt">>;
  retentionDays?: number;
}) {
  const retentionDays = input.retentionDays ?? 30;
  if (!Number.isSafeInteger(retentionDays) || retentionDays <= 0) throw new Error("Retention days must be positive");
  const rawMediaExpiresAt = new Date(input.endedAt.getTime() + retentionDays * 24 * 60 * 60 * 1000);
  const retainDerived = { rawMediaExpiresAt, retainTranscript: true as const, retainSummary: true as const };
  if (input.activeHolds.some((hold) => hold.releasedAt === null)) return { action: "retain_on_hold" as const, ...retainDerived };
  if ((input.now ?? new Date()).getTime() >= rawMediaExpiresAt.getTime()) return { action: "delete_raw_media" as const, ...retainDerived };
  return { action: "retain_until_expiry" as const, ...retainDerived };
}
