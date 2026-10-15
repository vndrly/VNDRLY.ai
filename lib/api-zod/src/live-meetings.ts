import { z } from "zod/v4";
export const LiveMeetingModeSchema = z.enum(["company_open", "host_approval"]);
export const LiveMeetingStartSchema = z.object({
  title: z.string().trim().min(1).max(200),
  agenda: z.string().max(50000).optional(),
  admissionMode: LiveMeetingModeSchema.default("host_approval"),
  participantUserIds: z.array(z.number().int().positive()).max(500).default([]),
});
export const LiveMeetingSummarySchema = z.object({
  occurrenceId: z.uuid(),
  title: z.string(),
  invited: z.boolean().optional(),
  startsAt: z.string().nullable().optional(),
  agenda: z.string().nullable(),
  hostName: z.string(),
  startedAt: z.string().nullable(),
  plannedEndsAt: z.string().nullable(),
  connectedCount: z.number().int().nonnegative(),
  admissionMode: LiveMeetingModeSchema.nullable(),
  ownAdmissionState: z.enum(["pending", "admitted", "declined"]).nullable(),
  requestedAt: z.string().nullable(),
  canManage: z.boolean(),
  canEnter: z.boolean(),
  canRequest: z.boolean(),
  status: z.string(),
  version: z.number().int().nonnegative(),
});
export const LiveMeetingLobbySchema = z.object({
  meeting: LiveMeetingSummarySchema,
  requests: z.array(
    z.object({
      userId: z.number().int().positive(),
      name: z.string(),
      requestedAt: z.string(),
    }),
  ),
  members: z.array(
    z.object({ userId: z.number().int().positive(), name: z.string() }),
  ),
});
export type LiveMeetingSummary = z.infer<typeof LiveMeetingSummarySchema>;
export const LiveMeetingAdmissionReceiptSchema = z.object({
  occurrenceId: z.uuid(),
  targetUserId: z.number().int().positive(),
  admissionState: z.enum(["pending", "admitted", "declined"]),
  requestedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedById: z.number().int().positive().nullable(),
  version: z.number().int().nonnegative(),
});
export const LiveMeetingCommandResourceSchema = z.object({
  meeting: LiveMeetingSummarySchema,
  notificationState: z.literal("queued"),
  admission: LiveMeetingAdmissionReceiptSchema.optional(),
});
