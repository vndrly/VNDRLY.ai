import type { SessionPayload } from "./session";
import { managedWorkerSiteRole } from "./managed-worker-access";

export function hasGateSupervisorAuthority(
  session: SessionPayload & { gateSupervisorAccess?: boolean },
  siteId: number,
): boolean {
  if (session.managedSubcontractor) {
    return managedWorkerSiteRole(session, siteId) === "gate_supervisor";
  }
  // A freshly resolved capability overrides stale claims in the signed session.
  if (session.gateSupervisorAccess !== undefined) return session.gateSupervisorAccess;
  return session.role === "admin" || session.role === "partner" ||
    session.membershipRole === "admin" || session.vendorRole === "gate_supervisor";
}
