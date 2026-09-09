import { createHash } from "node:crypto";
import { z } from "zod/v4";
export const transferRowSchema = z.object({ externalId: z.string().trim().min(1).max(200), title: z.string().trim().min(1).max(180), body: z.string().max(20000).default(""), dueAt: z.string().datetime().nullable().optional() }).strict();
export function transferSourceKey(ownerType: string, ownerId: number, source: string, category: string, externalId: string) {
  return createHash("sha256").update(JSON.stringify([ownerType, ownerId, source.trim().toLowerCase(), category, externalId.trim()])).digest("hex");
}
