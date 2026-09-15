import { apiFetch } from "@/lib/api";

type ActiveTrip = { id: string; version: number };

export async function completeActiveFieldTrip(input: { operationId: string; reason: "end_of_work" | "unattended_timeout"; needsSupervisorConfirmation: boolean; completedAt: Date }): Promise<boolean> {
  const trip = await apiFetch<ActiveTrip | null>("/api/implementation-a/trips/active");
  if (!trip) return false;
  await apiFetch(`/api/implementation-a/trips/${trip.id}/complete`, {
    method: "POST",
    body: JSON.stringify({
      operationId: input.operationId,
      expectedVersion: trip.version,
      reason: input.reason,
      needsSupervisorConfirmation: input.needsSupervisorConfirmation,
      completedAt: input.completedAt.toISOString(),
    }),
  });
  return true;
}
