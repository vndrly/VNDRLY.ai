import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { workHubRequest } from "@/lib/work-hub-client";

export type ActiveWorkHubAudio = { occurrenceId: string; deviceId: string; callId: string | null; title: string };

export function useWorkHubActiveAudio() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["work-hub", "active-audio", user?.userId, user?.vendorId, user?.partnerId],
    queryFn: ({ signal }) => workHubRequest<ActiveWorkHubAudio | null>("/devices/active-audio", { signal }),
    enabled: Boolean(user?.userId && (user.vendorId || user.partnerId)),
    refetchInterval: 5_000,
    retry: false,
  });
}
