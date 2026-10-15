export type CallTranscriptPolicy = {
  enabled: boolean;
  version: number;
  verifiedByUserId: number;
  effectiveAt: string;
};
export function callTranscriptDecision(
  input: {
    vendorId: number;
    ownerVendorId: number;
    actorUserId: number;
    callerUserId: number;
    recipientUserId: number;
    memberIds: number[];
    admin: boolean;
    active: boolean;
    policy: CallTranscriptPolicy | null;
  },
  mode: "read" | "capture" | "voicemail",
  now = Date.now(),
): boolean {
  if (
    input.vendorId !== input.ownerVendorId ||
    !input.memberIds.includes(input.actorUserId)
  )
    return false;
  const participant = [input.callerUserId, input.recipientUserId].includes(
    input.actorUserId,
  );
  if (mode === "read") return participant || input.admin;
  const p = input.policy;
  return (
    participant &&
    (mode === "voicemail" || input.active) &&
    input.memberIds.includes(input.callerUserId) &&
    input.memberIds.includes(input.recipientUserId) &&
    !!p?.enabled &&
    Number.isInteger(p.version) &&
    p.version > 0 &&
    Number.isInteger(p.verifiedByUserId) &&
    p.verifiedByUserId > 0 &&
    Number.isFinite(Date.parse(p.effectiveAt)) &&
    Date.parse(p.effectiveAt) <= now
  );
}
