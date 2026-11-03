import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { isWorkHubAdmin, ownerForUser, workHubRequest } from "@/lib/work-hub-client";
import { trainingProgressOptions, type TrainingProgressData } from "@/lib/training-progress-query";
import { effectiveTrainingProgressMethod, trainingProgressMethod } from "@/lib/training-progress-experiment";

/** Start the existing authenticated reads during app startup.
 * No persistent storage or longer freshness window. Server authorization and
 * the progress response still control whether team data can be displayed.
 */
export default function TrainingCachePrefetch() {
  const { user, isLoading } = useAuth();
  const cache = useQueryClient();
  const owner = ownerForUser(user);
  const method = effectiveTrainingProgressMethod();
  const enabled = method === "cache" || method === "render";
  const canPrefetch = enabled && !isLoading && !!user && !!owner &&
    !user.offlineOnly && !user.requiresContextChoice && !user.mustChangePassword;
  const context = canPrefetch
    ? JSON.stringify([user?.userId, user?.activeMembershipId, owner?.type, owner?.id])
    : null;
  const currentContext = useRef(context);
  // Update during render so a response arriving before effect cleanup cannot
  // start another request for an identity that has just changed.
  currentContext.current = context;
  useEffect(() => {
    if (!canPrefetch || !user || !owner) return;
    let active = true;
    const controller = new AbortController();
    const identity = [user.userId, user.activeMembershipId, owner.type, owner.id];
    const prefetchTeam = () => cache.prefetchQuery({
      queryKey: ["training-progress", "team", ...identity],
      queryFn: () => workHubRequest("/repository/team-progress", { signal: controller.signal }),
      staleTime: 15_000,
      retry: false,
    });
    // Admin authority is already part of the authenticated company context.
    // Start this read before other home requests can occupy browser connections.
    // The endpoint independently authorizes it, and display still waits for the
    // personal response's canViewTeamTraining. Explicit cache ghosts retain the
    // earlier serial behavior so the queue improvement remains measurable.
    const parallelTeam = (method === "render" || trainingProgressMethod() === null) && isWorkHubAdmin(user);
    if (parallelTeam) void prefetchTeam();
    // fetchQuery shares in-flight work with the mounted card and respects its
    // existing staleTime. The request still performs normal server authorization.
    void cache.fetchQuery({
      ...trainingProgressOptions(user, owner),
      queryFn: () => workHubRequest<TrainingProgressData>("/repository/progress", { signal: controller.signal }),
    }).then(progress => {
      if (!active || currentContext.current !== context || !progress.canViewTeamTraining || parallelTeam) return;
      return prefetchTeam();
    }).catch(() => { /* The normal card owns error presentation and retry. */ });
    void cache.prefetchQuery({
      queryKey: ["training-progress", "safety-summary", ...identity],
      queryFn: () => workHubRequest("/repository/safety-summary", { signal: controller.signal }),
      staleTime: 15_000,
      retry: false,
    });
    return () => { active = false; controller.abort(); };
  }, [canPrefetch, context, method, cache]);
  return null;
}
