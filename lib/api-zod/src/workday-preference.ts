/** One workday preference control. Supervisory/staff roles take precedence. */
export function workdayPreferenceForRole(user: {
  role?: string | null; vendorRole?: string | null; membershipRole?: string | null;
}) : "on-call" | "pickup-shifts" {
  const roles = [user.role, user.membershipRole, user.vendorRole];
  if (roles.some(role => role && ["admin", "office", "staff", "both", "gate_supervisor", "supervisor", "foreman", "dispatcher", "manager"].includes(role))) return "on-call";
  return roles.some(role => role && ["gatekeeper", "field", "field_employee", "driver", "employee"].includes(role)) ? "pickup-shifts" : "on-call";
}
