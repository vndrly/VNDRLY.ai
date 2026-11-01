import { EquipmentProfileSchema, type EquipmentProfile, type EquipmentLocation, type EquipmentObservation } from "@workspace/api-zod";
import { AssetServiceError } from "./assets";
import type { CustodyEvent } from "./assets";

export function equipmentProfile(raw: unknown, category = "other"): EquipmentProfile {
  const defaults: EquipmentProfile = { equipmentType: ["truck", "cab", "trailer", "towed_rig", "booth"].includes(category) ? category as EquipmentProfile["equipmentType"] : "other", trackOnMap: false, photoUrls: [], assignedUserId: null, ticketId: null, taskId: null, parentAssetId: null, activity: "unassigned", location: null, history: [] };
  const parsed = EquipmentProfileSchema.safeParse({ ...defaults, ...(raw && typeof raw === "object" ? raw : {}) });
  if (!parsed.success) throw new AssetServiceError("equipment.profile_invalid", 409);
  return parsed.data;
}

/** Manual observations never become live GPS merely because they were recently entered. */
export function projectEquipmentLocation(observation: EquipmentObservation | null, now: Date): EquipmentLocation | null {
  if (!observation) return null;
  const age = now.getTime() - Date.parse(observation.observedAt);
  if (!Number.isFinite(age) || age < -30000) return null;
  return { ...observation, freshness: observation.source !== "manual" && age <= 120000 ? "fresh" : "last_known" };
}

export function assertEquipmentConnection(childId: string, parentId: string, profiles: Map<string, EquipmentProfile>) {
  const seen = new Set([childId]);
  let current: string | null = parentId;
  while (current) {
    if (seen.has(current)) throw new AssetServiceError("equipment.connection_cycle", 409);
    seen.add(current);
    const profile = profiles.get(current);
    if (!profile) throw new AssetServiceError("equipment.parent_not_found", 404);
    current = profile.parentAssetId;
  }
}

/** Freeze the same timestamp on a drop/return; reading must never refresh its age. */
export function droppedEquipmentLocation(location: EquipmentLocation | null): EquipmentObservation | null {
  return location ? { latitude: location.latitude, longitude: location.longitude, observedAt: location.observedAt, source: "manual", label: `Last known at drop (${location.source.replaceAll("_", " ")})`, ...(location.reportedByUserId ? { reportedByUserId: location.reportedByUserId } : {}) } : null;
}

/** Prefer the newest actual observation; a phone never silently overrides a newer yard record. */
export function newestEquipmentLocation(...observations: (EquipmentLocation | null)[]): EquipmentLocation | null {
  return observations.filter((value): value is EquipmentLocation => value !== null)
    .reduce<EquipmentLocation | null>((newest, value) => !newest || Date.parse(value.observedAt) > Date.parse(newest.observedAt) ? value : newest, null);
}

/** Existing inventory custody remains authoritative when actions originate outside /equipment. */
export function synchronizeInventoryEquipmentCustody(raw: Record<string, unknown> | null, category: string, holderUserId: number | null, event: CustodyEvent, priorLocation: EquipmentLocation | null): Record<string, unknown> | null {
  if (!raw) return null;
  const profile = equipmentProfile(raw, category);
  const previousContext = { assignedUserId: event.fromHolderUserId ?? profile.assignedUserId, ticketId: profile.ticketId, taskId: profile.taskId, parentAssetId: profile.parentAssetId };
  profile.assignedUserId = holderUserId;
  profile.ticketId = null;
  profile.taskId = null;
  profile.parentAssetId = null;
  profile.location = droppedEquipmentLocation(priorLocation);
  profile.activity = "unassigned";
  profile.history.push({ operationId: event.id, action: event.type, actorUserId: event.actorUserId ?? event.toHolderUserId ?? event.fromHolderUserId ?? 0, occurredAt: event.occurredAt.toISOString(), ...(event.note ? { note: event.note } : {}), assignedUserId: holderUserId, ticketId: null, taskId: null, parentAssetId: null, activity: profile.activity, location: profile.location, ...(event.type === "return" ? previousContext : {}) });
  return { ...raw, ...profile, phoneLocationEnabled: holderUserId !== null };
}
