import { FleetCapabilitySchema, type FleetCapability } from "@workspace/api-zod";
import { apiFetch } from "@/lib/api";
import { isAuthScopeCurrent } from "@/lib/auth";

export type FleetYardActor = {
  companyId: number;
  userId: number;
  membershipId: number;
  sessionVersion: number;
  capabilities: FleetCapability[];
};

export async function readFleetYardActor(identity: { companyId: number; userId: number; membershipId: number }, authScope: ReturnType<typeof import("@/lib/auth").captureAuthScope>): Promise<FleetYardActor> {
  const [overview, grant] = await Promise.all([
    apiFetch<{ accountScope?: { companyId: number; userId: number; membershipId: number; sessionVersion: number } }>("/api/fleet/overview", {}, authScope),
    apiFetch<{ companyId: number; userId: number; capabilities: unknown }>("/api/fleet/capabilities", {}, authScope),
  ]);
  if (!isAuthScopeCurrent(authScope) || !overview.accountScope ||
    overview.accountScope.companyId !== identity.companyId || overview.accountScope.userId !== identity.userId ||
    overview.accountScope.membershipId !== identity.membershipId || grant.companyId !== identity.companyId || grant.userId !== identity.userId)
    throw Error("Fleet account changed. Refresh this workspace.");
  return { ...overview.accountScope, capabilities: FleetCapabilitySchema.array().parse(grant.capabilities) };
}

export function yardScope(actor: FleetYardActor) {
  return { owner: { type: "vendor" as const, id: actor.companyId }, userId: actor.userId, membershipId: actor.membershipId, sessionVersion: actor.sessionVersion };
}
