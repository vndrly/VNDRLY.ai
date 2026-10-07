import { z } from "zod/v4";
export const MeetingMessageArgumentsSchema = z
  .object({
    occurrenceId: z.uuid(),
    body: z.string().trim().min(1).max(4000),
    recipientUserId: z.number().int().positive().optional(),
  })
  .strict();
export const MeetingMessageReceiptSchema = z
  .object({
    id: z.uuid(),
    occurrenceId: z.uuid(),
    userId: z.number().int().positive(),
    body: z.string().min(1).max(1_000_000),
    recipientUserId: z.number().int().positive().nullable(),
    createdAt: z.iso.datetime({ offset: true }),
    messageType: z.literal("typed"),
    status: z.literal("saved"),
    consentAccepted: z.literal(false),
    deviceCaptureStarted: z.literal(false),
  })
  .strict();
export function meetingMessageReceipt(row: {
  id: string;
  occurrenceId: string;
  userId: number;
  body: string;
  recipientUserId: number | null;
  createdAt: Date | string;
  messageType: string;
}) {
  return MeetingMessageReceiptSchema.parse({
    ...row,
    createdAt:
      row.createdAt instanceof Date
        ? row.createdAt.toISOString()
        : row.createdAt,
    status: "saved",
    consentAccepted: false,
    deviceCaptureStarted: false,
  });
}
