type Actor = {
  userId?: number;
  sv?: number;
  activeMembershipId?: number | null;
  vendorId?: number | null;
  partnerId?: number | null;
  publicDemo?: boolean;
};
export function campaignActorCurrent(
  actor: Actor,
  user:
    | {
        id: number;
        sessionVersion: number;
        activeMembershipId: number | null;
        suspendedAt: unknown;
        mustChangePassword?: boolean;
      }
    | undefined,
  member:
    | {
        id: number;
        userId: number;
        orgType: string;
        vendorId?: number | null;
        partnerId?: number | null;
      }
    | undefined,
  owner: { type: "vendor" | "partner"; id: number },
): boolean {
  return (
    !!user &&
    !!member &&
    !actor.publicDemo &&
    !user.suspendedAt &&
    !user.mustChangePassword &&
    !!actor.sv &&
    user.id === actor.userId &&
    user.sessionVersion === actor.sv &&
    (user.activeMembershipId === null ||
      user.activeMembershipId === actor.activeMembershipId) &&
    (!actor.activeMembershipId || member.id === actor.activeMembershipId) &&
    member.userId === actor.userId &&
    member.orgType === owner.type &&
    (owner.type === "vendor"
      ? actor.vendorId === owner.id && member.vendorId === owner.id
      : actor.partnerId === owner.id && member.partnerId === owner.id)
  );
}
