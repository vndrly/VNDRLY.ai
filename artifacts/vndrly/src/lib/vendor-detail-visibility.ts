export function canViewVendorOfficeEmployees(
  role: string | null | undefined,
  isOwnVendor: boolean,
): boolean {
  return role === "admin" || (role === "vendor" && isOwnVendor);
}

export function canManageVendorSubcontractors(
  user: {
    role: string;
    vendorId: number | null;
    activeMembershipId: number | null;
    availableMemberships: { id: number; orgType: string; orgId: number; role: string }[];
  } | null | undefined,
  vendorId: number,
): boolean {
  if (user?.role !== "vendor" || user.vendorId !== vendorId) return false;
  return user.availableMemberships.some((membership) =>
    membership.id === user.activeMembershipId && membership.orgType === "vendor" &&
    membership.orgId === vendorId && membership.role === "admin",
  );
}
