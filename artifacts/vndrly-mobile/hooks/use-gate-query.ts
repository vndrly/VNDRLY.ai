import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { captureAuthScope } from "@/lib/auth";
import { apiFetch } from "@/lib/api";
export function useGateQuery<T>(
  path: string,
  enabled = true,
  interval?: number,
) {
  const { user, activeMembershipId } = useAuth(),
    scope = captureAuthScope();
  return useQuery({
    queryKey: [
      "gate-release",
      user?.id,
      activeMembershipId,
      scope.generation,
      path,
    ],
    queryFn: () => apiFetch<T>(path, {}, scope),
    enabled: !!user && enabled,
    retry: false,
    refetchInterval: interval,
  });
}
