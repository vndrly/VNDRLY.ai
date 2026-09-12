import { and, eq } from "drizzle-orm";
import { db, workHubDevicePreferencesTable } from "@workspace/db";
import type { DeviceActor } from "./device-coordinator";

export type DevicePreferences = { rankedDeviceIds: string[]; automaticBackupDeviceIds: string[]; learning: Record<string, number> };
const empty = (): DevicePreferences => ({ rankedDeviceIds: [], automaticBackupDeviceIds: [], learning: {} });

export function learnDevicePreference(current: DevicePreferences, destinationDeviceId: string, threshold = 3): DevicePreferences {
  const count = (current.learning[destinationDeviceId] ?? 0) + 1;
  const ranked = [...current.rankedDeviceIds.filter(id => id !== destinationDeviceId)];
  if (count >= threshold) ranked.unshift(destinationDeviceId);
  return { ...current, rankedDeviceIds: ranked, learning: { ...current.learning, [destinationDeviceId]: count } };
}

async function rowFor(actor: DeviceActor) {
  const [row] = await db.select().from(workHubDevicePreferencesTable).where(and(eq(workHubDevicePreferencesTable.userId, actor.userId), eq(workHubDevicePreferencesTable.ownerOrgType, actor.owner.type), eq(workHubDevicePreferencesTable.ownerOrgId, actor.owner.id))).limit(1);
  return row;
}
function map(row: typeof workHubDevicePreferencesTable.$inferSelect | undefined): DevicePreferences {
  return row ? { rankedDeviceIds: row.rankedDeviceIds, automaticBackupDeviceIds: row.automaticBackupDeviceIds, learning: row.learning } : empty();
}
export async function getDevicePreferences(actor: DeviceActor) { return map(await rowFor(actor)); }
export async function saveDevicePreferences(actor: DeviceActor, value: DevicePreferences) {
  const [row] = await db.insert(workHubDevicePreferencesTable).values({ userId: actor.userId, ownerOrgType: actor.owner.type, ownerOrgId: actor.owner.id, ...value, updatedAt: new Date() }).onConflictDoUpdate({ target: [workHubDevicePreferencesTable.userId, workHubDevicePreferencesTable.ownerOrgType, workHubDevicePreferencesTable.ownerOrgId], set: { ...value, updatedAt: new Date() } }).returning();
  return map(row);
}
export async function recordSuccessfulHandoff(actor: DeviceActor, destinationDeviceId: string) {
  return saveDevicePreferences(actor, learnDevicePreference(await getDevicePreferences(actor), destinationDeviceId));
}
