export type MeetingPresence = { seenAt: number; joinedAt: number; speaking: boolean };
export type MeetingSignal = { sequence: number; fromUserId: number; toUserId: number; kind: "offer" | "answer" | "ice"; payload: unknown; createdAt: number };
export type MeetingRuntime = {
  activity?: Record<string, { kind: "typing" | "file"; recipientUserId: number | null; expiresAt: number }>;
  startedAt?: string;
  endedAt?: string;
  sequence?: number;
  presence?: Record<string, MeetingPresence>;
  signals?: MeetingSignal[];
};

export function visibleMeetingActivities(runtime: MeetingRuntime, viewerUserId: number, activeIds: number[], now = Date.now()) {
  return Object.entries(runtime.activity ?? {})
    .filter(([userId, value]) => Number(userId) !== viewerUserId && activeIds.includes(Number(userId)) && value.expiresAt > now && (value.recipientUserId === null || value.recipientUserId === viewerUserId))
    .map(([userId, value]) => ({ userId: Number(userId), kind: value.kind, recipientUserId: value.recipientUserId, expiresAt: value.expiresAt }));
}

export function presentUserIds(runtime: MeetingRuntime, now = Date.now()) {
  return Object.entries(runtime.presence ?? {})
    .filter(([, value]) => now - value.seenAt < 30_000)
    .map(([id]) => Number(id));
}

/** A monotonic cursor avoids dropping simultaneous candidates with equal timestamps. */
export function appendMeetingSignal(runtime: MeetingRuntime, signal: Omit<MeetingSignal, "sequence" | "createdAt">, now = Date.now()): MeetingRuntime {
  const sequence = (runtime.sequence ?? 0) + 1;
  const recent = (runtime.signals ?? []).filter((item) => now - item.createdAt < 120_000);
  if (recent.length >= 2_000) throw new Error("meeting.signalling_busy");
  return { ...runtime, sequence, signals: [...recent, { ...signal, sequence, createdAt: now }] };
}

export function signalsForParticipant(runtime: MeetingRuntime, userId: number, after: number) {
  return (runtime.signals ?? []).filter((signal) => signal.sequence > after && signal.toUserId === userId);
}

export function captureAllowed(invited: boolean, runtime: MeetingRuntime, activeIds: number[], acceptedIds: number[], now = Date.now()) {
  const present = presentUserIds(runtime, now).filter((id) => activeIds.includes(id));
  return invited && present.length > 0 && present.every((id) => acceptedIds.includes(id));
}
