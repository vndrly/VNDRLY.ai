export type MeetingPresence = { seenAt: number; joinedAt: number; speaking: boolean };
export type MeetingDevicePresence = MeetingPresence & { userId: number; deviceId: string; connectionId: string };
export type MeetingSignal = { sequence: number; fromUserId: number; fromDeviceId?: string; toUserId: number; toDeviceId?: string; kind: "offer" | "answer" | "ice"; payload: unknown; createdAt: number };
export type MeetingRuntime = {
  activity?: Record<string, { kind: "typing" | "file"; recipientUserId: number | null; expiresAt: number }>;
  startedAt?: string;
  endedAt?: string;
  sequence?: number;
  presence?: Record<string, MeetingPresence>;
  connections?: Record<string, MeetingDevicePresence>;
  signals?: MeetingSignal[];
  /** People explicitly admitted by a host on a shared terminal. This is
   * attendance presence only; it must never be treated as an audio device. */
  admittedUserIds?: number[];
};

export function meetingAdmittedUserIds(runtime: MeetingRuntime) {
  return [...new Set((runtime.admittedUserIds ?? []).filter((value) => Number.isSafeInteger(value) && value > 0))];
}

const MAX_MEETING_SIGNAL_COUNT = 2_000;
const MAX_MEETING_SIGNAL_BYTES = 2 * 1024 * 1024;

export class MeetingSignalCapacityError extends Error {
  constructor() { super("meeting.signalling_busy"); }
}

function meetingSignalBytes(signal: Omit<MeetingSignal, "sequence" | "createdAt"> | MeetingSignal) {
  return Buffer.byteLength(JSON.stringify(signal), "utf8");
}

export function visibleMeetingActivities(runtime: MeetingRuntime, viewerUserId: number, activeIds: number[], now = Date.now()) {
  return Object.entries(runtime.activity ?? {})
    .filter(([userId, value]) => Number(userId) !== viewerUserId && activeIds.includes(Number(userId)) && value.expiresAt > now && (value.recipientUserId === null || value.recipientUserId === viewerUserId))
    .map(([userId, value]) => ({ userId: Number(userId), kind: value.kind, recipientUserId: value.recipientUserId, expiresAt: value.expiresAt }));
}

export function presentUserIds(runtime: MeetingRuntime, now = Date.now()) {
  return [...new Set(Object.values(meetingDeviceConnections(runtime))
    .filter((value) => now - value.seenAt < 30_000)
    .map((value) => value.userId))];
}

export function meetingDeviceConnections(runtime: MeetingRuntime): Record<string, MeetingDevicePresence> {
  if (runtime.connections) return runtime.connections;
  return Object.fromEntries(Object.entries(runtime.presence ?? {}).map(([userId, value]) => {
    const connectionId = `legacy:${userId}`;
    return [connectionId, { ...value, userId: Number(userId), deviceId: connectionId, connectionId }];
  }));
}

function legacyPresenceProjection(connections: Record<string, MeetingDevicePresence>): Record<string, MeetingPresence> {
  const projected: Record<string, MeetingPresence> = {};
  for (const value of Object.values(connections)) {
    const current = projected[value.userId];
    projected[value.userId] = current
      ? { joinedAt: Math.min(current.joinedAt, value.joinedAt), seenAt: Math.max(current.seenAt, value.seenAt), speaking: current.speaking || value.speaking }
      : { joinedAt: value.joinedAt, seenAt: value.seenAt, speaking: value.speaking };
  }
  return projected;
}

export function upsertDevicePresence(runtime: MeetingRuntime, presence: MeetingDevicePresence): MeetingRuntime {
  const connections = { ...meetingDeviceConnections(runtime), [presence.connectionId]: presence };
  return { ...runtime, connections, presence: legacyPresenceProjection(connections) };
}

export function removeDevicePresence(runtime: MeetingRuntime, connectionId: string): MeetingRuntime {
  const connections = { ...meetingDeviceConnections(runtime) };
  delete connections[connectionId];
  return { ...runtime, connections, presence: legacyPresenceProjection(connections) };
}

export function removeUserPresence(runtime: MeetingRuntime, userId: number): MeetingRuntime {
  const connections = Object.fromEntries(Object.entries(meetingDeviceConnections(runtime)).filter(([, value]) => value.userId !== userId));
  return { ...runtime, connections, presence: legacyPresenceProjection(connections) };
}

export function devicePresenceForUser(runtime: MeetingRuntime, userId: number, now = Date.now()) {
  return Object.values(meetingDeviceConnections(runtime)).filter(value => value.userId === userId && now - value.seenAt < 30_000);
}

export function aggregateUserPresence(runtime: MeetingRuntime, userId: number, now = Date.now()): MeetingPresence | null {
  const connections = devicePresenceForUser(runtime, userId, now);
  if (!connections.length) return null;
  return { joinedAt: Math.min(...connections.map(value => value.joinedAt)), seenAt: Math.max(...connections.map(value => value.seenAt)), speaking: connections.some(value => value.speaking) };
}

/** A monotonic cursor avoids dropping simultaneous candidates with equal timestamps. */
export function appendMeetingSignal(runtime: MeetingRuntime, signal: Omit<MeetingSignal, "sequence" | "createdAt">, now = Date.now()): MeetingRuntime {
  const sequence = (runtime.sequence ?? 0) + 1;
  const recent = (runtime.signals ?? []).filter((item) => now - item.createdAt < 120_000);
  const next = { ...signal, sequence, createdAt: now };
  const aggregateBytes = recent.reduce((total, item) => total + meetingSignalBytes(item), meetingSignalBytes(next));
  if (recent.length >= MAX_MEETING_SIGNAL_COUNT || aggregateBytes > MAX_MEETING_SIGNAL_BYTES) throw new MeetingSignalCapacityError();
  return { ...runtime, sequence, signals: [...recent, next] };
}

export function signalsForParticipant(runtime: MeetingRuntime, userId: number, after: number) {
  return (runtime.signals ?? []).filter((signal) => signal.sequence > after && signal.toUserId === userId && !signal.toDeviceId);
}

export function signalsForConnection(runtime: MeetingRuntime, connectionId: string, after: number, userId?: number) {
  return (runtime.signals ?? []).filter((signal) => signal.sequence > after && (signal.toDeviceId === connectionId || (!signal.toDeviceId && userId !== undefined && signal.toUserId === userId)));
}

export function captureAllowed(invited: boolean, runtime: MeetingRuntime, activeIds: number[], acceptedIds: number[], now = Date.now()) {
  const present = presentUserIds(runtime, now).filter((id) => activeIds.includes(id));
  return invited && present.length > 0 && present.every((id) => acceptedIds.includes(id));
}
