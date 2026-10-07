import { z } from "zod/v4";
export const OperationsDisplayViewSchema = z.object({
  displayId: z.uuid(), monitorId: z.uuid(), displayName: z.string(), monitorName: z.string(),
  view: z.enum(["crew_map", "gate_log", "safety", "coverage", "meeting_room"]).nullable(),
  siteLocationId: z.number().int().positive().nullable(), meetingOccurrenceId: z.uuid().nullable(),
  privacyMode: z.boolean(), configuredAt: z.iso.datetime(), receivedAt: z.iso.datetime(),
  records: z.array(z.object({ id: z.string(), title: z.string(), status: z.string(), detail: z.string(), sourceRecordedAt: z.iso.datetime().nullable(), latitude: z.number().min(-90).max(90).optional(), longitude: z.number().min(-180).max(180).optional() }).strict()).max(100),
  truncated: z.boolean(), physicalDisplayVerified: z.literal(false), cameraStarted: z.literal(false), microphoneStarted: z.literal(false),
}).strict();
export type OperationsDisplayView = z.infer<typeof OperationsDisplayViewSchema>;
