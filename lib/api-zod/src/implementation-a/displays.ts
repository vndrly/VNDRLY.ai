import { z } from "zod/v4";

export const operationsDisplayViewSchema = z.enum(["crew_map", "gate_log", "safety", "coverage", "meeting_room"]);
export const registerOperationsDisplaySchema = z.object({
  name: z.string().trim().min(1).max(80), companionDeviceId: z.string().uuid(),
  monitorNames: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  siteAllowlist: z.array(z.number().int().positive()).max(100).default([]),
  viewAllowlist: z.array(operationsDisplayViewSchema).min(1), privacyMode: z.boolean().default(true),
}).strict();
export const routeOperationsDisplayViewSchema = z.object({
  companionDeviceId: z.string().uuid(), monitorName: z.string().trim().min(1).max(40),
  view: operationsDisplayViewSchema, siteLocationId: z.number().int().positive().nullable().optional(),
  meetingOccurrenceId: z.string().uuid().nullable().optional(),
}).strict();
export const joinOperationsRoomSchema = routeOperationsDisplayViewSchema.pick({ companionDeviceId: true, monitorName: true, meetingOccurrenceId: true }).extend({ meetingOccurrenceId: z.string().uuid() }).strict();
export const revokeOperationsDisplaySchema = z.object({ companionDeviceId: z.string().uuid() }).strict();
export type RegisterOperationsDisplayInput = z.infer<typeof registerOperationsDisplaySchema>;
