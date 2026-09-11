import { createHash } from "node:crypto";

export const MEETING_REPLAY_SCHEMA_VERSION = 2;
export const MEETING_REPLAY_RENDERER_VERSION = 1;
export const MAX_REPLAY_CHUNK_BYTES = 5 * 1024 * 1024;
export const MAX_REPLAY_CHUNK_DURATION_MS = 30_000;
export const MAX_REPLAY_DURATION_MS = 12 * 60 * 60 * 1000;
export const MAX_REPLAY_EVENTS = 10_000;
export const MAX_REPLAY_CHUNKS = 2_000;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const AUDIO_TYPES = new Set(["audio/wav"]);
const EVENT_TYPES = new Set(["transcript", "message", "file", "askv_answer", "speaker", "activity", "gap"]);
const GAP_REASONS = new Set(["missing_audio", "consent_missing", "capture_paused", "upload_failed", "recorder_interruption", "reconnect", "file_unavailable"]);

export class MeetingReplayError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message);
  }
}

export type ReplayChunkRequest = {
  operationId: string;
  chunkId: string;
  sequence: number;
  startsAtMs: number;
  endsAtMs: number;
  contentType: string;
  claimedSha256: string;
  body: Buffer;
};

export type ValidatedReplayChunk = Omit<ReplayChunkRequest, "claimedSha256" | "body"> & {
  byteSize: number;
  sha256: string;
  body: Buffer;
  durationMs: number;
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  sampleCount: number;
};

function parsePcmWav(body: Buffer) {
  if (body.length < 44 || body.toString("ascii", 0, 4) !== "RIFF" || body.toString("ascii", 8, 12) !== "WAVE" || body.readUInt32LE(4) + 8 !== body.length) throw new MeetingReplayError("Replay audio is not a complete WAV container");
  let offset = 12;
  let format: { sampleRate: number; channelCount: number; bitsPerSample: number; blockAlign: number } | null = null;
  let dataSize: number | null = null;
  while (offset < body.length) {
    if (offset + 8 > body.length) throw new MeetingReplayError("Replay WAV chunk header is truncated");
    const kind = body.toString("ascii", offset, offset + 4);
    const size = body.readUInt32LE(offset + 4);
    const start = offset + 8;
    const end = start + size;
    if (end > body.length) throw new MeetingReplayError("Replay WAV chunk is truncated");
    if (kind === "fmt ") {
      if (format || size < 16 || body.readUInt16LE(start) !== 1) throw new MeetingReplayError("Replay WAV must contain one uncompressed PCM format chunk");
      const channelCount = body.readUInt16LE(start + 2);
      const sampleRate = body.readUInt32LE(start + 4);
      const byteRate = body.readUInt32LE(start + 8);
      const blockAlign = body.readUInt16LE(start + 12);
      const bitsPerSample = body.readUInt16LE(start + 14);
      if (channelCount !== 1 || bitsPerSample !== 16 || sampleRate < 8_000 || sampleRate > 48_000 || blockAlign !== 2 || byteRate !== sampleRate * blockAlign) throw new MeetingReplayError("Replay WAV must be mono PCM16 at a supported sample rate");
      format = { sampleRate, channelCount, bitsPerSample, blockAlign };
    } else if (kind === "data") {
      if (dataSize !== null || size === 0) throw new MeetingReplayError("Replay WAV must contain one non-empty data chunk");
      dataSize = size;
    }
    offset = end + (size % 2);
  }
  if (offset !== body.length || !format || dataSize === null || dataSize % format.blockAlign !== 0) throw new MeetingReplayError("Replay WAV sample data is incomplete");
  const sampleCount = dataSize / format.blockAlign;
  const exactDurationMs = sampleCount * 1_000 / format.sampleRate;
  if (!Number.isSafeInteger(sampleCount) || !Number.isSafeInteger(exactDurationMs) || exactDurationMs <= 0 || exactDurationMs > MAX_REPLAY_CHUNK_DURATION_MS) throw new MeetingReplayError("Replay WAV duration is invalid");
  return { ...format, sampleCount, durationMs: exactDurationMs };
}

export function validateReplayChunk(input: ReplayChunkRequest): ValidatedReplayChunk {
  if (!UUID.test(input.operationId) || !UUID.test(input.chunkId)) throw new MeetingReplayError("Invalid replay operation");
  if (!Number.isSafeInteger(input.sequence) || input.sequence < 0 || input.sequence >= MAX_REPLAY_CHUNKS) throw new MeetingReplayError("Invalid replay sequence");
  if (!Number.isSafeInteger(input.startsAtMs) || input.startsAtMs < 0 || !Number.isSafeInteger(input.endsAtMs) || input.endsAtMs <= input.startsAtMs) throw new MeetingReplayError("Invalid replay audio range");
  const contentType = input.contentType.toLowerCase().replace(/\s+/g, "");
  if (!AUDIO_TYPES.has(contentType)) throw new MeetingReplayError("Unsupported replay audio content type");
  if (!Buffer.isBuffer(input.body) || input.body.length === 0 || input.body.length > MAX_REPLAY_CHUNK_BYTES) throw new MeetingReplayError("Replay audio chunk size is invalid");
  if (!SHA256.test(input.claimedSha256)) throw new MeetingReplayError("Invalid replay audio checksum");
  const sha256 = createHash("sha256").update(input.body).digest("hex");
  if (sha256 !== input.claimedSha256.toLowerCase()) throw new MeetingReplayError("Replay audio checksum does not match");
  const decoded = parsePcmWav(input.body);
  if (input.endsAtMs !== input.startsAtMs + decoded.durationMs || input.endsAtMs > MAX_REPLAY_DURATION_MS) throw new MeetingReplayError("Replay audio range does not match verified samples");
  return { ...input, ...decoded, contentType, sha256, byteSize: input.body.length };
}

export type ReplayChunkRow = {
  id: string;
  sequence: number;
  startsAtMs: number;
  endsAtMs: number;
  durationMs: number;
  sampleRate: number;
  channelCount: number;
  bitsPerSample: number;
  sampleCount: number;
  contentType: string;
  byteSize: number;
  sha256: string;
  state: "pending" | "ready" | "failed";
};

export type ReplayGap = {
  startsAtMs: number;
  endsAtMs: number;
  reason: "missing_audio" | "consent_missing" | "capture_paused" | "upload_failed" | "recorder_interruption" | "reconnect" | "file_unavailable";
};

export type ReplayEventType = "transcript" | "message" | "file" | "askv_answer" | "speaker" | "activity" | "gap";
export type ReplayEventRow = {
  id?: string;
  eventKey: string;
  eventType: ReplayEventType;
  offsetMs: number;
  endOffsetMs?: number | null;
  payload: Record<string, unknown>;
};

export type ReplayManifestInput = {
  occurrenceId: string;
  meetingStartedAt: Date;
  meetingStatus: string;
  manifestStatus: string;
  rendererVersion: number;
  schemaVersion: number;
  durationMs: number;
  chunks: ReplayChunkRow[];
  events: ReplayEventRow[];
  explicitGaps: ReplayGap[];
};

type PublicReplayEvent = {
  key: string;
  type: ReplayEventType;
  offsetMs: number;
  endOffsetMs: number | null;
  payload: Record<string, unknown>;
};

const payloadKeys: Record<ReplayEventType, readonly string[]> = {
  transcript: ["displayName", "text", "startsAtMs", "endsAtMs"],
  message: ["displayName", "body", "messageType"],
  file: ["displayName", "fileName", "contentType", "byteSize", "downloadPath", "removed"],
  askv_answer: ["displayName", "body", "messageType"],
  speaker: ["displayName", "state"],
  activity: ["displayName", "state"],
  gap: ["reason"],
};

export function serializeReplayEvent(event: ReplayEventRow, durationMs: number): PublicReplayEvent | null {
  if (!EVENT_TYPES.has(event.eventType)) throw new MeetingReplayError("Unsupported replay event");
  if (event.eventType === "speaker" || event.eventType === "activity") return null;
  if (!Number.isSafeInteger(event.offsetMs) || event.offsetMs < 0 || event.offsetMs > durationMs) throw new MeetingReplayError("Replay event exceeds meeting duration");
  const endOffsetMs = event.endOffsetMs ?? null;
  if (endOffsetMs !== null && (!Number.isSafeInteger(endOffsetMs) || endOffsetMs < event.offsetMs || endOffsetMs > durationMs)) throw new MeetingReplayError("Invalid replay event range");
  if (event.payload.private === true || event.payload.recipientUserId !== null && event.payload.recipientUserId !== undefined) return null;
  const payload: Record<string, unknown> = {};
  for (const key of payloadKeys[event.eventType]) {
    const value = event.payload[key];
    if (value !== undefined) payload[key] = value;
  }
  // eventKey is an internal idempotency key and may embed a source row id. The
  // replay row id is safe for renderer identity without exposing that source.
  return { key: event.id ?? event.eventKey, type: event.eventType, offsetMs: event.offsetMs, endOffsetMs, payload };
}

function validateGaps(gaps: ReplayGap[], durationMs: number) {
  const sorted = [...gaps].sort((a, b) => a.startsAtMs - b.startsAtMs || a.endsAtMs - b.endsAtMs);
  let priorEnd = -1;
  for (const gap of sorted) {
    if (!Number.isSafeInteger(gap.startsAtMs) || !Number.isSafeInteger(gap.endsAtMs) || gap.startsAtMs < 0 || gap.endsAtMs <= gap.startsAtMs || gap.endsAtMs > durationMs || !GAP_REASONS.has(gap.reason)) throw new MeetingReplayError("Invalid replay gap marker");
    if (gap.startsAtMs < priorEnd) throw new MeetingReplayError("Replay gap markers overlap");
    priorEnd = gap.endsAtMs;
  }
  return sorted;
}

function normalizeChunks(chunks: ReplayChunkRow[], occurrenceId: string, durationMs: number) {
  if (chunks.length > MAX_REPLAY_CHUNKS) throw new MeetingReplayError("Too many replay audio chunks");
  const sorted = [...chunks].sort((a, b) => a.sequence - b.sequence);
  let priorEnd = 0;
  for (let index = 0; index < sorted.length; index += 1) {
    const chunk = sorted[index];
    if (chunk.state !== "ready") throw new MeetingReplayError("Replay audio is not ready");
    if (chunk.sequence !== index) throw new MeetingReplayError("Replay audio sequence is not monotonic");
    if (!UUID.test(chunk.id) || !AUDIO_TYPES.has(chunk.contentType) || !SHA256.test(chunk.sha256) || !Number.isSafeInteger(chunk.byteSize) || chunk.byteSize <= 0 || chunk.byteSize > MAX_REPLAY_CHUNK_BYTES) throw new MeetingReplayError("Invalid replay audio chunk");
    if (chunk.sampleRate < 8_000 || chunk.sampleRate > 48_000 || chunk.channelCount !== 1 || chunk.bitsPerSample !== 16 || !Number.isSafeInteger(chunk.sampleCount) || chunk.sampleCount <= 0 || !Number.isSafeInteger(chunk.durationMs) || chunk.durationMs !== chunk.sampleCount * 1_000 / chunk.sampleRate || chunk.endsAtMs !== chunk.startsAtMs + chunk.durationMs) throw new MeetingReplayError("Replay audio coverage is not verified");
    if (!Number.isSafeInteger(chunk.startsAtMs) || !Number.isSafeInteger(chunk.endsAtMs) || chunk.startsAtMs < priorEnd || chunk.endsAtMs <= chunk.startsAtMs || chunk.endsAtMs > durationMs || chunk.endsAtMs - chunk.startsAtMs > MAX_REPLAY_CHUNK_DURATION_MS) throw new MeetingReplayError("Replay audio chunks overlap or exceed duration");
    priorEnd = chunk.endsAtMs;
  }
  return sorted.map((chunk) => ({
    sequence: chunk.sequence,
    startsAtMs: chunk.startsAtMs,
    endsAtMs: chunk.endsAtMs,
    contentType: chunk.contentType,
    byteSize: chunk.byteSize,
    sha256: chunk.sha256,
    downloadPath: `/api/work-hub/meetings/${occurrenceId}/replay/audio/${chunk.id}`,
  }));
}

function derivedGaps(audio: Array<{ startsAtMs: number; endsAtMs: number }>, durationMs: number): ReplayGap[] {
  const gaps: ReplayGap[] = [];
  let cursor = 0;
  for (const chunk of audio) {
    if (chunk.startsAtMs > cursor) gaps.push({ startsAtMs: cursor, endsAtMs: chunk.startsAtMs, reason: "missing_audio" });
    cursor = chunk.endsAtMs;
  }
  if (cursor < durationMs) gaps.push({ startsAtMs: cursor, endsAtMs: durationMs, reason: "missing_audio" });
  return gaps;
}

function mergeGapReasons(audioGaps: ReplayGap[], explicit: ReplayGap[]) {
  const fileGaps = explicit.filter((gap) => gap.reason === "file_unavailable");
  const audioReasons = explicit.filter((gap) => gap.reason !== "file_unavailable");
  for (const marker of audioReasons) {
    if (!audioGaps.some((gap) => marker.startsAtMs >= gap.startsAtMs && marker.endsAtMs <= gap.endsAtMs)) throw new MeetingReplayError("Replay gap contradicts saved audio");
  }
  const result: ReplayGap[] = [];
  for (const gap of audioGaps) {
    const markers = audioReasons.filter((marker) => marker.startsAtMs >= gap.startsAtMs && marker.endsAtMs <= gap.endsAtMs).sort((a, b) => a.startsAtMs - b.startsAtMs);
    let cursor = gap.startsAtMs;
    for (const marker of markers) {
      if (marker.startsAtMs > cursor) result.push({ startsAtMs: cursor, endsAtMs: marker.startsAtMs, reason: "missing_audio" });
      result.push(marker); cursor = marker.endsAtMs;
    }
    if (cursor < gap.endsAtMs) result.push({ startsAtMs: cursor, endsAtMs: gap.endsAtMs, reason: "missing_audio" });
  }
  return [...result, ...fileGaps].sort((a, b) => a.startsAtMs - b.startsAtMs || a.endsAtMs - b.endsAtMs || a.reason.localeCompare(b.reason));
}

export function buildReplayManifest(input: ReplayManifestInput) {
  if (!UUID.test(input.occurrenceId) || Number.isNaN(input.meetingStartedAt.getTime())) throw new MeetingReplayError("Invalid replay occurrence");
  if (!new Set(["ended", "cancelled"]).has(input.meetingStatus)) throw new MeetingReplayError("Meeting must be ended before replay retrieval", 409);
  if (input.manifestStatus !== "finalized") throw new MeetingReplayError("Replay is not finalized", 409);
  if (input.schemaVersion !== MEETING_REPLAY_SCHEMA_VERSION || input.rendererVersion !== MEETING_REPLAY_RENDERER_VERSION) throw new MeetingReplayError("Unsupported replay version", 409);
  if (!Number.isSafeInteger(input.durationMs) || input.durationMs <= 0 || input.durationMs > MAX_REPLAY_DURATION_MS) throw new MeetingReplayError("Invalid replay duration");
  if (input.events.length > MAX_REPLAY_EVENTS) throw new MeetingReplayError("Too many replay events");
  const audio = normalizeChunks(input.chunks, input.occurrenceId, input.durationMs);
  const explicit = validateGaps(input.explicitGaps, input.durationMs);
  const gaps = mergeGapReasons(derivedGaps(audio, input.durationMs), explicit);
  const events = input.events.map((event) => serializeReplayEvent(event, input.durationMs)).filter((event): event is PublicReplayEvent => event !== null).sort((a, b) => a.offsetMs - b.offsetMs || a.type.localeCompare(b.type) || a.key.localeCompare(b.key));
  const complete = input.meetingStatus === "ended" && audio.length > 0 && gaps.length === 0;
  return {
    schemaVersion: input.schemaVersion,
    rendererVersion: input.rendererVersion,
    status: complete ? "complete" as const : "incomplete" as const,
    complete,
    occurrence: { startedAt: input.meetingStartedAt.toISOString(), durationMs: input.durationMs },
    audio,
    gaps,
    events,
    storage: { audioBytes: audio.reduce((total, chunk) => total + chunk.byteSize, 0), audioChunkCount: audio.length },
  };
}
