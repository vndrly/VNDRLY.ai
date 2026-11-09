import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { isWorkHubAdmin, ownerForUser } from "@/lib/work-hub-client";
import type { AccountNextStepsSummary } from "@/lib/next-steps-model";

export function accountNextStepsKey(userId: number | undefined, membershipId: number | null | undefined, companyType: string | undefined, companyId: number | undefined) {
  return ["account-next-steps", userId, membershipId, companyType, companyId] as const;
}

/** Mounted once above the router's pages so navigation retains this saved plan. */
export function useAccountNextSteps() {
  const { user } = useAuth();
  const owner = ownerForUser(user);
  const vendorAdmin = owner?.type === "vendor" && user?.role === "vendor" && isWorkHubAdmin(user);
  const gateRole = user?.vendorRole === "gatekeeper" || user?.vendorRole === "gate_supervisor" || Boolean(user?.managedSubcontractor?.siteGrants.length);
  const officeRole = user?.role === "vendor" && user.vendorRole === "office";
  const queryEnabled = Boolean(user?.userId && user.activeMembershipId && owner?.type === "vendor" &&
    (vendorAdmin || officeRole || gateRole));
  const queryKey = accountNextStepsKey(user?.userId, user?.activeMembershipId, owner?.type, owner?.id);
  const query = useQuery({
    queryKey,
    queryFn: async ({ signal }): Promise<AccountNextStepsSummary> => {
      const response = await fetch("/api/account-next-steps", { credentials: "include", signal });
      if (!response.ok) throw new Error("Next Steps could not be refreshed.");
      return response.json();
    },
    enabled: queryEnabled,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
    retry: false,
    refetchOnWindowFocus: true,
  });
  const enabled = queryEnabled && (!query.isSuccess || query.data.firstWatch !== null || gateRole);
  return { query, queryKey, enabled, vendorAdmin, vendorId: owner?.type === "vendor" ? owner.id : null, scope: JSON.stringify(queryKey), user };
}
