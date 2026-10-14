export type PublicationState = {
  deviceValid: boolean; participantActive: boolean; leaseValid: boolean;
  leaseReplaced: boolean; present: boolean; muted: boolean; callActive: boolean;
  endedAt: number | null; closedAt: number | null; lastFrameAt: number;
};

export function callTranscriptPublicationAllowed(s: PublicationState, now: number) {
  if (!s.deviceValid || !s.participantActive || s.leaseReplaced || s.muted) return false;
  if (s.callActive) return s.leaseValid && s.present;
  return s.closedAt !== null && s.endedAt !== null &&
    s.lastFrameAt <= s.closedAt && s.lastFrameAt <= s.endedAt &&
    now >= s.closedAt && now >= s.endedAt &&
    now - s.closedAt <= 30_000 && now - s.endedAt <= 30_000;
}
