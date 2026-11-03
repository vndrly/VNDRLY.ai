import {useRef} from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import {
  ownerForUser,
  workHubRequest,
  commandEnvelope,
  createWorkHubOperationId,
} from "@/lib/work-hub-client";
export type RepositoryRecord = {
  id: string;
  createdBy: number;
  createdAt: string;
  updatedAt: string;
  data: Record<string, any>;
};
export type RepositoryData = {
  certifications: {
    id: string;
    title: string;
    userId: number;
    augmented: boolean;
    standalone?: boolean;
    groupingOnly?: boolean;
    complete: boolean;
    steps: {
      id: string;
      title: string;
      type: string;
      complete: boolean;
      href: string;
      expiresAt?: string | null;
    }[];
  }[];
  bonusScore: number;
  bonusCompleted: number;
  bonusRequired: number;
  canAdmin: boolean;
  canManageTraining: boolean;
  canAssignTravel: boolean;
  folders: RepositoryRecord[];
  trips: RepositoryRecord[];
  expenses: RepositoryRecord[];
  templates: RepositoryRecord[];
  travelTemplates: { id: string; name: string; fields: string[] }[];
  renewalSources: {
    id: string;
    label: string;
    months: number | null;
    url: string;
    condition: string;
  }[];
  options: {
    people: {
      userId: number;
      name: string;
      role: string;
      canAssignTravelRole?: boolean;
    }[];
    groups: { id: string; name: string }[];
    positions: { id: string; name: string }[];
    accountTypes: { id: string; name: string }[];
  };
  creators: { id: number; name: string }[];
  travelGrants: RepositoryRecord[];
  augmentations: RepositoryRecord[];
  courses: { id: string; title: string; version: number }[];
};
export function useRepository({ enabled = true }: { enabled?: boolean } = {}) {
  const { user } = useAuth(),
    owner = ownerForUser(user),
    cache = useQueryClient();
  const attempts=useRef(new Map<string,string>());
  const key = [
    "vendor-repository",
    user?.userId,
    user?.activeMembershipId,
    owner?.type,
    owner?.id,
  ];
  const query = useQuery({
    queryKey: key,
    enabled: enabled && !!owner,
    queryFn: () => workHubRequest<RepositoryData>("/repository"),
  });
  const mutation = useMutation({
    mutationFn: async ({
      action,
      payload,
      version = null,
      operationId,
    }: {
      action: string;
      payload: unknown;
      version?: number | null;
      operationId?: string;
    }) => {
      if (!owner) throw Error("Choose a company");
      const fingerprint=JSON.stringify({owner,action,payload,version});
      const id=operationId??attempts.current.get(fingerprint)??createWorkHubOperationId();
      attempts.current.set(fingerprint,id);
      const envelope = commandEnvelope(owner, payload, id);
      const result=await workHubRequest(`/repository/${action}`, {
        method: "POST",
        body: JSON.stringify({ ...envelope, expectedVersion: version }),
      });
      attempts.current.delete(fingerprint);
      return result;
    },
    onSuccess: async () => {
      await cache.invalidateQueries({ queryKey: key });
      await cache.invalidateQueries({ queryKey: ["work-hub-file-library"] });
    },
  });
  return {
    user,
    owner,
    query,
    mutation,
    data: query.data,
    save: mutation.mutateAsync,
    error: mutation.error?.message ?? query.error?.message,
    pending: mutation.isPending,
  };
}
