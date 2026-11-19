import { z } from "zod/v4";

export const createWorkCrewPayload = z.object({
  name: z.string().trim().min(1).max(120),
  purpose: z.string().trim().max(2000).default(""),
  userIds: z.array(z.number().int().positive()).min(1).max(500).transform(ids => [...new Set(ids)]),
  noExpiry: z.boolean().default(false),
}).strict();
export const crewJobPayload = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().trim().max(20000).default(""),
  dueAt: z.iso.datetime().nullable().optional(),
}).strict();
export function workCrewExpiration(crew: { createdAt: Date | string; workCrew: { noExpiry: boolean; lastAssignedAt: string | null } | null }, now = new Date()) {
  if (!crew.workCrew) throw new Error("This is not a work crew");
  const expiresAt = crew.workCrew.noExpiry ? null : new Date(new Date(crew.workCrew.lastAssignedAt ?? crew.createdAt).getTime() + 30 * 86400000).toISOString();
  return { expiresAt, expired: expiresAt !== null && Date.parse(expiresAt) <= now.getTime() };
}
