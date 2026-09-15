import { FieldTripError, type FieldTripRecord, type TripOwner } from "./field-trips";

export type FieldTripActor = {
  userId: number;
  owner: TripOwner | null;
  isAdmin: boolean;
  vendorRole: string | null;
};

const SUPERVISOR_ROLES = new Set(["dispatcher", "foreman", "gate_supervisor", "safety_manager"]);

export function assertFieldTripAccess(trip: FieldTripRecord, actor: FieldTripActor) {
  if (actor.isAdmin) return;
  if (!actor.owner || trip.owner.type !== actor.owner.type || trip.owner.id !== actor.owner.id) {
    throw new FieldTripError("trip.not_found", 404);
  }
}

export function authorizeFieldTripCompletion(trip: FieldTripRecord, actor: FieldTripActor): { actorMayComplete: boolean } {
  assertFieldTripAccess(trip, actor);
  if (trip.driverUserId === actor.userId) return { actorMayComplete: false };
  const actorMayComplete = actor.isAdmin || SUPERVISOR_ROLES.has(actor.vendorRole ?? "");
  if (!actorMayComplete) throw new FieldTripError("trip.completion_forbidden", 403);
  return { actorMayComplete: true };
}
