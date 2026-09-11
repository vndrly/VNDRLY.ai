export type MeetingAnswerAudience = "shared" | "private";

export type MeetingAnswerSourceRow = {
  id: string;
  kind: "chat" | "transcript";
  userId: number | null;
  recipientUserId: number | null;
  speaker: string;
  text: string;
  occurredAt: number;
  messageType?: string;
};

export type MeetingAnswerContextItem = {
  speaker: string;
  text: string;
  kind: "chat" | "transcript";
};

const DEFAULT_MAX_ROWS = 100;
const DEFAULT_MAX_BYTES = 48 * 1024;
const RESERVATION_LEASE_MS = 30_000;

export function parseMeetingWakeQuestion(value: string): string | null {
  if (typeof value !== "string") return null;
  const wake = /^(?:ask\s*v|v)(?=$|[\s,.:;!?—–-])/i;
  const match = value.trim().match(/^(?:ask\s*v|v)(?=$|[\s,.:;!?—–-])(?:[\s,.:;!?—–-]+)([\s\S]+)$/i);
  const question = match?.[1]?.trim() ?? "";
  return question.length > 0 && !wake.test(question) ? question : null;
}

function truncateUtf8(value: string, limit: number) {
  if (Buffer.byteLength(value, "utf8") <= limit) return value;
  let result = "";
  let bytes = 0;
  for (const character of value) {
    const size = Buffer.byteLength(character, "utf8");
    if (bytes + size > limit) break;
    result += character;
    bytes += size;
  }
  return result;
}

export function selectMeetingAnswerContext(input: {
  audience: MeetingAnswerAudience;
  requesterUserId: number;
  otherUserId?: number;
  rows: MeetingAnswerSourceRow[];
  maxRows?: number;
  maxBytes?: number;
}): MeetingAnswerContextItem[] {
  const maxRows = input.maxRows ?? DEFAULT_MAX_ROWS;
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxRows) || maxRows < 1 || maxRows > DEFAULT_MAX_ROWS) throw new Error("Invalid meeting answer context row limit");
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES) throw new Error("Invalid meeting answer context byte limit");
  if (input.audience === "private" && (!Number.isSafeInteger(input.otherUserId) || input.otherUserId === input.requesterUserId)) {
    throw new Error("Private meeting answer context requires exactly two distinct participants");
  }
  const pair = input.audience === "private" ? new Set([input.requesterUserId, input.otherUserId!]) : null;
  const eligible = input.rows
    .filter((row) => row.messageType !== "askv")
    .filter((row) => row.kind !== "chat" || !row.messageType || row.messageType === "typed")
    .filter((row) => {
      if (input.audience === "shared") return row.recipientUserId === null;
      return row.kind === "chat" &&
        row.recipientUserId !== null &&
        pair!.has(row.userId ?? -1) &&
        pair!.has(row.recipientUserId) &&
        row.userId !== row.recipientUserId;
    })
    .sort((left, right) => left.occurredAt - right.occurredAt)
    .slice(-maxRows);

  const selected: MeetingAnswerContextItem[] = [];
  let remaining = maxBytes;
  for (let index = eligible.length - 1; index >= 0 && remaining > 0; index--) {
    const row = eligible[index];
    const text = truncateUtf8(row.text.trim(), remaining);
    if (!text) continue;
    selected.unshift({ speaker: truncateUtf8(row.speaker.trim() || "Attendee", 160), text, kind: row.kind });
    remaining -= Buffer.byteLength(text, "utf8");
  }
  return selected;
}

export function buildMeetingAnswerInput(input: {
  question: string;
  audience: MeetingAnswerAudience;
  selected: MeetingAnswerContextItem[];
  maxBytes?: number;
}) {
  const maxBytes = input.maxBytes ?? DEFAULT_MAX_BYTES;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > DEFAULT_MAX_BYTES) throw new Error("Invalid meeting answer payload byte limit");
  const rows = input.selected.slice(-DEFAULT_MAX_ROWS);
  const serialize = () => {
    const roster = [...new Set(rows.map((row) => row.speaker))].map((displayName) => ({ displayName }));
    return {
      question: input.question,
      audience: input.audience,
      roster,
      chat: rows.filter((row) => row.kind === "chat").map(({ speaker, text }) => ({ speaker, text })),
      transcript: rows.filter((row) => row.kind === "transcript").map(({ speaker, text }) => ({ speaker, text })),
    };
  };
  let payload = serialize();
  while (Buffer.byteLength(JSON.stringify(payload), "utf8") > maxBytes && rows.length > 0) {
    rows.shift();
    payload = serialize();
  }
  if (Buffer.byteLength(JSON.stringify(payload), "utf8") > maxBytes) throw new Error("Meeting answer payload is too large");
  return payload;
}

type AnswerReservation = {
  fingerprint: string;
  owner: string;
  claimedAt: number;
};

type ReservationRuntime = Record<string, unknown> & {
  askvAnswerReservations?: Record<string, AnswerReservation>;
};

export function reserveMeetingAnswer(
  runtime: Record<string, unknown>,
  key: string,
  fingerprint: string,
  owner: string,
  now = Date.now(),
): { claimed: true; runtime: Record<string, unknown> } | { claimed: false; reason: "busy"; runtime: Record<string, unknown> } {
  const current = runtime as ReservationRuntime;
  const reservations = { ...(current.askvAnswerReservations ?? {}) };
  const existing = reservations[key];
  if (existing && existing.owner !== owner && now - existing.claimedAt < RESERVATION_LEASE_MS) {
    return { claimed: false, reason: "busy", runtime };
  }
  reservations[key] = { fingerprint, owner, claimedAt: now };
  return { claimed: true, runtime: { ...runtime, askvAnswerReservations: reservations } };
}

export function releaseMeetingAnswerReservation(runtime: Record<string, unknown>, key: string, owner: string) {
  const current = runtime as ReservationRuntime;
  const reservations = { ...(current.askvAnswerReservations ?? {}) };
  if (reservations[key]?.owner !== owner) return runtime;
  delete reservations[key];
  const { askvAnswerReservations: _removed, ...rest } = current;
  return Object.keys(reservations).length ? { ...rest, askvAnswerReservations: reservations } : rest;
}

export function meetingAnswerReservationOwned(runtime: Record<string, unknown>, key: string, owner: string, fingerprint: string) {
  const reservation = (runtime as ReservationRuntime).askvAnswerReservations?.[key];
  return reservation?.owner === owner && reservation.fingerprint === fingerprint;
}
