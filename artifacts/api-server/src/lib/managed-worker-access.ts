import type { SessionPayload } from "./session";

export function managedWorkerSiteRole(session: SessionPayload, siteId: number): "gatekeeper" | "gate_supervisor" | null {
  const roles = session.managedSubcontractor?.siteGrants.filter((grant) => grant.siteId === siteId).map((grant) => grant.role) ?? [];
  return roles.includes("gate_supervisor") ? "gate_supervisor" : roles.includes("gatekeeper") ? "gatekeeper" : null;
}

export function managedWorkerSiteIds(session: SessionPayload): number[] {
  return [...new Set(session.managedSubcontractor?.siteGrants.map((grant) => grant.siteId) ?? [])];
}
