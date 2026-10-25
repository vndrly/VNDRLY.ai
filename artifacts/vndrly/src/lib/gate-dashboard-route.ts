/** GateGo company landing, independent of the member's job role. */
export function isGateGoUser(user: { vendorId?: number | null; activeMembershipId?: number | null; availableMemberships?: { id: number; orgId: number; orgType: string; orgName: string }[] } | null | undefined): boolean {
  const membership = user?.availableMemberships?.find(m => user.activeMembershipId != null ? m.id === user.activeMembershipId : m.orgType === "vendor" && m.orgId === user.vendorId);
  return membership?.orgType === "vendor" && membership.orgName.trim().toLowerCase() === "gatego";
}

/** Default login destination; explicit workflow links remain directly navigable. */
export function gateDashboardRouteFor(user: ({ role?: string | null; vendorRole?: string | null } & Parameters<typeof isGateGoUser>[0]) | null | undefined): string {
  return isGateGoUser(user) || user?.vendorRole === "gatekeeper" || user?.vendorRole === "gate_supervisor"
    ? "/gate/change-over"
    : "/";
}
