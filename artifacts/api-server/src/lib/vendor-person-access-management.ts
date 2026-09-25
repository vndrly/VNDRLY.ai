import {
  VENDOR_PERSON_OPERATIONAL_ROLES,
  type VendorPersonOperationalRole,
} from "@workspace/db";

export type AccessReplacementInput = {
  operationalRoles: string[];
  siteLocationIds: number[];
};

export type PreparedAccessReplacement = {
  operationalRoles: VendorPersonOperationalRole[];
  siteLocationIds: number[];
  siteAccessMode: "all_authorized" | "selected";
};

export function prepareAccessReplacement(
  input: AccessReplacementInput,
  context: { isAdmin: boolean; authorizedSiteIds: number[] },
): PreparedAccessReplacement {
  const allowedRoles = new Set<string>(VENDOR_PERSON_OPERATIONAL_ROLES);
  if (input.operationalRoles.some((role) => !allowedRoles.has(role))) {
    throw new Error("Invalid operational role");
  }
  const operationalRoles = [...new Set(input.operationalRoles)] as VendorPersonOperationalRole[];
  if (context.isAdmin) {
    return { operationalRoles, siteLocationIds: [], siteAccessMode: "all_authorized" };
  }
  const allowedSites = new Set(context.authorizedSiteIds);
  if (input.siteLocationIds.some((siteId) => !Number.isInteger(siteId) || !allowedSites.has(siteId))) {
    throw new Error("Site access is not authorized for this vendor");
  }
  return {
    operationalRoles,
    siteLocationIds: [...new Set(input.siteLocationIds)].sort((a, b) => a - b),
    siteAccessMode: "selected",
  };
}
