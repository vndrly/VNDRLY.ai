/** Gate-role login destination; the Gate tab itself remains directly navigable. */
export function gateDashboardRouteFor(user: { role?: string | null; vendorRole?: string | null } | null | undefined): string {
  return user?.vendorRole === "gatekeeper" || user?.vendorRole === "gate_supervisor"
    ? "/gate/change-over"
    : "/";
}
