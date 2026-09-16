import type { StoredUser } from "@/lib/auth";

type GatekeeperUserShape = Pick<StoredUser, "role"> &
  Partial<
    Pick<
      StoredUser,
      "vendorRole" | "username" | "displayName" | "managedSubcontractor"
    >
  >;

/** Top-level session role is field employee (crew / foreman mobile workflows). */
export function isFieldEmployeeUser(
  user: Pick<StoredUser, "role"> | null | undefined,
): boolean {
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

export function isGatekeeperUser(
  user: GatekeeperUserShape | null | undefined,
): boolean {
  return (
    (user?.role === "vendor" && user.vendorRole === "gatekeeper") ||
    (user?.role === "field_employee" &&
      !!user.managedSubcontractor &&
      (user.vendorRole === "gatekeeper" ||
        user.vendorRole === "gate_supervisor"))
  );
}

/** Tab route segments a gatekeeper may stay on without being bounced to Gate. */
export const GATEKEEPER_TAB_KEYS = [
  "askv",
  "gate",
  "gate-history",
  "profile",
] as const;

export function isGatekeeperTabKey(segment: string | undefined): boolean {
  return (
    !!segment && (GATEKEEPER_TAB_KEYS as readonly string[]).includes(segment)
  );
}

export function isVendorOfficeUser(
  user: Pick<StoredUser, "role"> | null | undefined,
): boolean {
  return user?.role === "vendor";
}

export function isPartnerOfficeUser(
  user: Pick<StoredUser, "role"> | null | undefined,
): boolean {
  return user?.role === "partner";
}

export function isAdminOfficeUser(
  user: Pick<StoredUser, "role"> | null | undefined,
): boolean {
  return user?.role === "admin";
}

/**
 * Office-side mobile viewers (vendor admin, partner, platform admin).
 * These users get read-heavy ticket oversight — not field GPS / scan flows.
 */
export function isOfficeMobileViewer(
  user: GatekeeperUserShape | null | undefined,
): boolean {
  if (!user) return false;
  if (isGatekeeperUser(user)) return false;
  if (isFieldEmployeeUser(user)) return false;
  return (
    isVendorOfficeUser(user) ||
    isPartnerOfficeUser(user) ||
    isAdminOfficeUser(user)
  );
}

export function homeTabTitleKey(
  user: GatekeeperUserShape | null | undefined,
): string {
  if (isGatekeeperUser(user)) return "gatekeeper.portal";
  if (isForemanEmployeeUser(user)) return "foremanHome.portal";
  if (isVendorOfficeUser(user)) return "vendorHome.portal";
  if (isPartnerOfficeUser(user)) return "partnerHome.portal";
  if (isAdminOfficeUser(user)) return "adminHome.portal";
  return "tabs.home";
}

/** Map tab: foreman crew GPS, or partner/admin site crew map. */
export function crewMapTabVisible(
  user: GatekeeperUserShape | null | undefined,
): boolean {
  if (isGatekeeperUser(user)) return false;
  return (
    isForemanEmployeeUser(user) ||
    isPartnerOfficeUser(user) ||
    isAdminOfficeUser(user)
  );
}
