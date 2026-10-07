import { z } from "zod/v4";

export const WorkHubCalendarSnapshotSchema = z
  .object({
    occurrenceId: z.uuid(),
    meetingId: z.uuid(),
    ownerType: z.enum(["vendor", "partner"]),
    ownerId: z.number().int().positive(),
    title: z.string().min(1).max(200),
    agenda: z.string().nullable(),
    timezone: z.string().min(1).max(80),
    createdById: z.number().int().positive(),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime().nullable(),
    status: z.string(),
    participantUserIds: z.array(z.number().int().positive()).min(1).max(100),
  })
  .strict();
export const WorkHubCalendarResponseInputSchema = z
  .object({
    operationId: z.uuid(),
    occurrenceId: z.uuid(),
    expectedFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    response: z.enum(["accepted", "declined"]),
  })
  .strict();
export const WorkHubCalendarResponseReceiptSchema = z
  .object({
    operationId: z.uuid(),
    occurrenceId: z.uuid(),
    actorUserId: z.number().int().positive(),
    commandFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    scheduleFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    response: z.enum(["accepted", "declined"]),
    recordedAt: z.iso.datetime(),
    status: z.literal("response_recorded"),
    physicalAttendanceVerified: z.literal(false),
    recordingConsentGranted: z.literal(false),
    externalAttendeeAcceptanceVerified: z.literal(false),
  })
  .strict();
export const WorkHubCalendarResponseObservationSchema = z
  .object({
    snapshot: WorkHubCalendarSnapshotSchema,
    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
    actorUserId: z.number().int().positive(),
    canManage: z.boolean(),
    responses: z
      .array(
        z
          .object({
            userId: z.number().int().positive(),
            response: z.enum(["unknown", "pending", "accepted", "declined"]),
            recordedResponse: z.enum(["pending", "accepted", "declined"]),
            scheduleResponseVerified: z.boolean(),
            recordedAt: z.iso.datetime().nullable(),
          })
          .strict(),
      )
      .max(100),
    source: z.literal("saved_work_hub_participant_response"),
    physicalAttendanceVerified: z.literal(false),
    externalAttendeeAcceptanceVerified: z.literal(false),
  })
  .strict();
export const WorkHubCalendarResponseResultSchema = z
  .object({
    receipt: WorkHubCalendarResponseReceiptSchema.nullable(),
    replayed: z.boolean(),
  })
  .strict();
export type WorkHubCalendarResponseInput = z.infer<
  typeof WorkHubCalendarResponseInputSchema
>;
export type WorkHubCalendarResponseObservation = z.infer<
  typeof WorkHubCalendarResponseObservationSchema
>;
