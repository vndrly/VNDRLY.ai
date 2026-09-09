export type MeetingAttendee = { userId: number; displayName: string; photoUrl?: string | null; role: string; muted: boolean; present: boolean; speaking: boolean; joinedAt?: number; removedAt: string | null; handRaisedAt?: string | null };
export type MeetingMessage = { id: string; userId: number; displayName: string; recipientUserId: number | null; body: string; messageType: string; createdAt: string; attachment?: { fileName: string; contentType: string; byteSize: number; removedAt?: string } | null };
export type MeetingSnapshot = {
  userId: number; canManage: boolean; canViewAttendance: boolean; transcription: boolean; myConsent: string;
  meeting: { title: string; agenda: string | null; policyVersion: number };
  occurrence: { id: string; status: string; startsAt: string; endsAt: string | null; startedAt: string | null; endedAt: string | null; askvInvitedAt: string | null };
  participants: MeetingAttendee[]; chat: MeetingMessage[];
  activity: Array<{ userId: number; kind: "typing" | "file"; recipientUserId: number | null; expiresAt: number }>;
  transcript: Array<{ id: string; speakerUserId: number | null; displayName: string; text: string; startsAtMs: number; endsAtMs: number }>;
  attendance: Array<{ id: string; userId: number; joinedAt: string; leftAt: string | null }>;
  recap: Record<string, unknown> | null;
};

export function meetingTimer(start: string | null, scheduledStart: string, targetEnd: string | null, now: number) {
  const elapsedMs = start ? Math.max(0, now - Date.parse(start)) : 0;
  const targetMs = targetEnd ? Math.max(0, Date.parse(targetEnd) - Date.parse(scheduledStart)) : 0;
  return { elapsedMs, targetMs, warning: targetMs > 0 && targetMs - elapsedMs <= 600_000, overtimeMs: targetMs > 0 ? Math.max(0, elapsedMs - targetMs) : 0, progress: targetMs > 0 ? Math.min(100, elapsedMs / targetMs * 100) : 0 };
}
export function meetingClock(ms: number) {
  const seconds = Math.floor(ms / 1000);
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60].map((part) => String(part).padStart(2, "0")).join(":");
}
