import { useQuery } from "@tanstack/react-query";
import { SafetyMaturitySummarySchema } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
export function useSafetyMaturity() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["safety-maturity", user?.userId, user?.vendorId, user?.partnerId],
    queryFn: async () => {
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/safety/maturity`, { credentials: "include" });
      if (!response.ok) throw Error("Safety maturity unavailable");
      return SafetyMaturitySummarySchema.parse((await response.json()).data);
    }, refetchInterval: 60_000,
  });
}
