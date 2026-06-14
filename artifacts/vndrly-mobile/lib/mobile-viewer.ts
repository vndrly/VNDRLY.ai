import type { StoredUser } from "@/lib/auth";

/** Top-level session role is field employee (crew / foreman mobile workflows). */
export function isFieldEmployeeUser(user: Pick<StoredUser, "role"> | null | undefined): boolean {
  return user?.role === "field_employee";
}

/** Field employee whose vendor role includes foreman duties. */
export function isForemanEmployeeUser(
  user: Pick<StoredUser, "role" | "vendorRole"> | null | undefined,
): boolean {
  return (
    isFieldEmployeeUser(user) &&
    (user?.vendorRole === "foreman" || user?.vendorRole === "both")
  );
}

export function isVendorOfficeUser(user: Pick<StoredUser, "role"> | null | undefined): boolean {
  return user?.role === "vendor";
}

export function isPartnerOfficeUser(user: Pick<StoredUser, "role"> | null | undefined): boolean {
  return user?.role === "partner";
}

export function isAdminOfficeUser(user: Pick<StoredUser, "role"> | null | undefined): boolean {
  return user?.role === "admin";
}

/**
 * Office-side mobile viewers (vendor admin, partner, platform admin).
 * These users get read-heavy ticket oversight — not field GPS / scan flows.
 */
export function isOfficeMobileViewer(
  user: Pick<StoredUser, "role"> | null | undefined,
): boolean {
  if (!user) return false;
  if (isFieldEmployeeUser(user)) return false;
  return (
    isVendorOfficeUser(user) ||
    isPartnerOfficeUser(user) ||
    isAdminOfficeUser(user)
  );
}

export function homeTabTitleKey(
  user: Pick<StoredUser, "role" | "vendorRole"> | null | undefined,
): string {
  if (isForemanEmployeeUser(user)) return "foremanHome.portal";
  if (isVendorOfficeUser(user)) return "vendorHome.portal";
  if (isPartnerOfficeUser(user)) return "partnerHome.portal";
  if (isAdminOfficeUser(user)) return "adminHome.portal";
  return "tabs.home";
}

/** Map tab: foreman crew GPS, or partner/admin site crew map. */
export function crewMapTabVisible(
  user: Pick<StoredUser, "role" | "vendorRole"> | null | undefined,
): boolean {
  return (
    isForemanEmployeeUser(user) ||
    isPartnerOfficeUser(user) ||
    isAdminOfficeUser(user)
  );
}
