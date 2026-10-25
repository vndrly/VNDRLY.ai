type OfficeUser = { role?: string; vendorRole?: string | null; activeMembershipId?: number | null; availableMemberships?: { id: number; role: string }[] };
export function canUseOfficeNavigation(user: OfficeUser | null | undefined): boolean {
 if (!user) return false;
 const membership = user.availableMemberships?.find(item => item.id === user.activeMembershipId);
 return user.role === "admin" || membership?.role === "admin" || user.vendorRole === "office" || user.vendorRole === "both" || ((user.role === "vendor" || user.role === "partner") && !user.vendorRole);
}
