import type { RepositoryData } from "@/components/work-hub/repository-client";
import { workHubRequest, type WorkHubOwner } from "./work-hub-client";

type TrainingIdentity = { userId: number; activeMembershipId?: number | null };
export type TrainingProgressData = Pick<RepositoryData, "certifications" | "completedCertifications" | "displayGroups" | "profileGroups" | "overallPercent" | "overallCompleted" | "overallTotal"> & { canViewTeamTraining?: boolean };

/** The same identity boundary is used by the card and optional local prefetch experiments. */
export function trainingProgressKey(user: TrainingIdentity | null | undefined, owner: WorkHubOwner | null) {
  return ["training-progress", user?.userId, user?.activeMembershipId, owner?.type, owner?.id];
}

export function trainingProgressOptions(user: TrainingIdentity | null | undefined, owner: WorkHubOwner | null) {
  return {
    queryKey: trainingProgressKey(user, owner),
    enabled: !!owner,
    queryFn: () => workHubRequest<TrainingProgressData>("/repository/progress"),
    staleTime: 30_000,
    refetchInterval: 30_000,
  };
}
