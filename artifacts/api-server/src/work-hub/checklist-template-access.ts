type ChecklistActor = { role: string; membershipRole?: string | null; vendorRole?: string | null; vendorId?: number | null; partnerId?: number | null; managedSubcontractor?: unknown };
export function canManageChecklistTemplates(session: ChecklistActor, owner: { type: string; id: number }): boolean {
  if (session.managedSubcontractor) return false;
  if (session.role === "admin") return true;
  const matches = owner.type === "vendor" ? session.vendorId === owner.id : session.partnerId === owner.id;
  const staff = owner.type === "vendor" && ["office", "both"].includes(session.vendorRole ?? "");
  return matches && (session.membershipRole === "admin" || staff);
}
