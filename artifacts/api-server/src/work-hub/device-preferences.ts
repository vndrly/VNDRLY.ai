import { and, eq } from "drizzle-orm";
import { db, workHubDevicePreferencesTable } from "@workspace/db";
import type { DeviceActor } from "./device-coordinator";

export type DevicePreferences = { rankedDeviceIds: string[]; automaticBackupDeviceIds: string[]; learning: Record<string, number> };
const empty = (): DevicePreferences => ({ rankedDeviceIds: [], automaticBackupDeviceIds: [], learning: {} });

export function learnDevicePreference(current: DevicePreferences, destinationDeviceId: string): DevicePreferences {
  const count = (current.learning[destinationDeviceId] ?? 0) + 1;
  return { ...current, learning: { ...current.learning, [destinationDeviceId]: count } };
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
  const { learning } = learnDevicePreference(await getDevicePreferences(actor), destinationDeviceId);
  await db.insert(workHubDevicePreferencesTable).values({
    userId: actor.userId, ownerOrgType: actor.owner.type, ownerOrgId: actor.owner.id, learning,
  }).onConflictDoUpdate({
    target: [workHubDevicePreferencesTable.userId, workHubDevicePreferencesTable.ownerOrgType, workHubDevicePreferencesTable.ownerOrgId],
    set: { learning, updatedAt: new Date() },
  });
}
