export type SafetyIncidentOwner = { type: "vendor" | "partner"; id: number };

export interface SafetyIncidentOrganization {
  vendorId: number | null;
  partnerId: number;
}

export function isSafetyIncidentInScope(
  owner: SafetyIncidentOwner | null,
  event: SafetyIncidentOrganization,
): boolean {
  if (!owner) return false;
  return owner.type === "vendor"
    ? event.vendorId === owner.id
    : event.partnerId === owner.id;
}
