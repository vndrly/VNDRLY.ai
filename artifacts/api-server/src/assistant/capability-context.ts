export interface AskVCapabilityContext {
  revision: number;
  userId: number;
  membershipId: number | null;
  owner: { type: "vendor" | "partner"; id: number } | null;
  sponsorshipId: string | null;
  assignmentId: string | null;
  shiftId: string | null;
  siteId: number | null;
  crewId: string | null;
  vehicleAssetId: string | null;
  tripId: string | null;
  deviceId: string | null;
  communication: { kind: "chat" | "meeting" | "call"; id: string } | null;
  pendingConfirmationId: string | null;
}

export function switchAskVCapabilityContext(
  current: AskVCapabilityContext,
  patch: Partial<Omit<AskVCapabilityContext, "revision" | "pendingConfirmationId">>,
): AskVCapabilityContext {
  return { ...current, ...patch, revision: current.revision + 1, pendingConfirmationId: null };
}
