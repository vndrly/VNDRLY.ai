import { z } from "zod/v4";

export const meetingSearchInputSchema = z.object({
  occurrenceId: z.string().uuid(),
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(100).default(20),
});

const transcriptRecord = z
  .object({
    id: z.string().uuid(),
    artifactId: z.string().uuid(),
    text: z.string(),
    startsAtMs: z.number().int().nonnegative(),
    endsAtMs: z.number().int().nonnegative(),
  })
  .refine((value) => value.endsAtMs >= value.startsAtMs);
const chatRecord = z.object({
  id: z.string().uuid(),
  occurrenceId: z.string().uuid(),
  body: z.string(),
  createdAt: z.string().datetime(),
});

/** Search only the caller's already-authorized catch-up projection, never another meeting or provider. */
export function searchSavedMeetingProjection(input: unknown, value: unknown) {
  const request = meetingSearchInputSchema.safeParse(input);
  if (!request.success)
    return {
      ok: false,
      error:
        "Supply an exact meeting occurrence, nonempty query (up to 500 characters), and limit from 1 to 100.",
    };
  const projection = z
    .object({
      occurrence: z.object({ id: z.string().uuid() }),
      transcript: z.array(z.unknown()),
      chat: z.array(z.unknown()),
    })
    .safeParse(value);
  if (
    !projection.success ||
    projection.data.occurrence.id !== request.data.occurrenceId
  )
    return {
      ok: false,
      error:
        "The authorized meeting search source is unavailable or does not match the requested occurrence.",
    };
  const pattern = new RegExp(
    request.data.query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
    "iu",
  );
  const matches: Array<Record<string, unknown>> = [];
  let invalidRecordCount = 0;
  for (const row of projection.data.transcript) {
    const record = transcriptRecord.safeParse(row);
    if (!record.success) {
      invalidRecordCount++;
      continue;
    }
    const match = pattern.exec(record.data.text);
    if (match)
      matches.push({
        sourceType: "transcript",
        sourceId: record.data.id,
        artifactId: record.data.artifactId,
        text: record.data.text,
        startsAtMs: record.data.startsAtMs,
        endsAtMs: record.data.endsAtMs,
        match: {
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
        },
      });
  }
  for (const row of projection.data.chat) {
    const record = chatRecord.safeParse(row);
    if (
      !record.success ||
      record.data.occurrenceId !== request.data.occurrenceId
    ) {
      invalidRecordCount++;
      continue;
    }
    const match = pattern.exec(record.data.body);
    if (match)
      matches.push({
        sourceType: "chat",
        sourceId: record.data.id,
        text: record.data.body,
        recordedAt: record.data.createdAt,
        match: {
          start: match.index,
          end: match.index + match[0].length,
          text: match[0],
        },
      });
  }
  return {
    ok: true,
    occurrenceId: request.data.occurrenceId,
    query: request.data.query,
    source: "authorized_saved_meeting_records",
    matchBasis: "case_insensitive_literal",
    matches: matches.slice(0, request.data.limit),
    matchCount: matches.length,
    truncated: matches.length > request.data.limit,
    invalidRecordCount,
    captureStarted: false,
    physicalPresenceVerified: false,
  };
}
