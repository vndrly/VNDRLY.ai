/** Fleet grants are loaded by trusted server code, never from assistant arguments. */
export type FleetRole = "fleet_manager" | "dispatcher" | "driver";
export type FleetAction = "view" | "dispatch" | "manage_assets" | "manage_maintenance" | "perform_run" | "release_safety" | "view_finance";
export type FleetGrant = {
  companyId: number;
  fleetIds: readonly string[];
  siteIds: readonly number[];
  roles: readonly FleetRole[];
  safetyRelease: boolean;
  financeRead: boolean;
};
export type FleetTarget = { companyId: number; fleetId: string; siteId?: number; driverUserId?: number };

/** Stored capabilities replace legacy operational roles without granting unrelated authority. */
export function rolesForFleetCapabilities(capabilities: readonly string[]): FleetRole[] {
  const roles: FleetRole[] = [];
  if (capabilities.includes("admin")) roles.push("fleet_manager");
  else if (capabilities.includes("dispatch")) roles.push("dispatcher");
  if (capabilities.includes("driver")) roles.push("driver");
  return roles;
}

/** Shared outer boundary for legacy roles and composable mobile capabilities. */
export function hasFleetGrantScope(userId: number, grant: FleetGrant | null, target: Pick<FleetTarget, "companyId" | "fleetId" | "siteId">): grant is FleetGrant {
  return Number.isSafeInteger(userId) && userId > 0 && !!grant && grant.companyId === target.companyId && grant.fleetIds.includes(target.fleetId) && (target.siteId === undefined || grant.siteIds.includes(target.siteId));
}

/** A missing grant or assignment denies access, including same-company access. */
export function mayPerformFleetAction(userId: number, grant: FleetGrant | null, target: FleetTarget, action: FleetAction): boolean {
  if (!hasFleetGrantScope(userId, grant, target)) return false;
  const manager = grant.roles.includes("fleet_manager");
  const dispatcher = grant.roles.includes("dispatcher");
  const ownRun = grant.roles.includes("driver") && target.driverUserId === userId;
  switch (action) {
    case "view": return manager || dispatcher || ownRun;
    case "dispatch": return manager || dispatcher;
    case "manage_assets":
    case "manage_maintenance": return manager;
    case "perform_run": return ownRun;
    case "release_safety": return manager && grant.safetyRelease;
    case "view_finance": return manager && grant.financeRead;
    default: return false;
  }
}
