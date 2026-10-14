import { useEffect, useRef } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { z } from "zod/v4";
import { workHubCommandResultSchema } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import {
  workHubRequest,
  commandEnvelope,
  type WorkHubOwner,
} from "@/lib/work-hub-client";
export function useCampaign<T>(path: string, parse: (value: unknown) => T) {
  const { user } = useAuth(),
    owner: WorkHubOwner | null = user?.partnerId
      ? { type: "partner", id: user.partnerId }
      : user?.vendorId
        ? { type: "vendor", id: user.vendorId }
        : null,
    identity = [
      user?.userId,
      user?.activeMembershipId,
      owner?.type,
      owner?.id,
    ].join(":"),
    current = useRef(identity);
  current.current = identity;
  const attempt = useRef<{
    path: string;
    method: string;
    body: string;
    identity: string;
  } | null>(null);
  useEffect(() => {
    attempt.current = null;
    completion.current = undefined;
  }, [identity]);
  const query = useQuery({
    queryKey: ["form-campaign", path, identity],
    queryFn: async () => parse(await workHubRequest(path)),
    enabled: !!owner,
    refetchInterval: () =>
      document.visibilityState === "visible" ? 15000 : false,
    retry: false,
  });
  const completion = useRef<((result: any) => void) | undefined>(undefined);
  const mutation = useMutation({
    mutationFn: async (q: {
      path: string;
      payload: unknown;
      version?: number;
      method?: string;
    }) => {
      if (!owner) throw Error("Current company required");
      if (
        attempt.current &&
        (attempt.current.path !== q.path ||
          attempt.current.method !== (q.method ?? "POST") ||
          JSON.stringify(JSON.parse(attempt.current.body).payload) !==
            JSON.stringify(q.payload))
      )
        throw Error("Retry original unconfirmed request first.");
      if (!attempt.current)
        attempt.current = {
          path: q.path,
          method: q.method ?? "POST",
          body: JSON.stringify(
            commandEnvelope(owner, q.payload, undefined, q.version),
          ),
          identity,
        };
      const request = attempt.current;
      try {
        const result = workHubCommandResultSchema(
          z.record(z.string(), z.unknown()),
        ).parse(
          await workHubRequest(request.path, {
            method: request.method,
            body: request.body,
          }),
        );
        if (request.identity !== current.current)
          throw Error("Account changed");
        if (result.operationId !== JSON.parse(request.body).operationId)
          throw Error("Saved operation could not be verified");
        attempt.current = null;
        await query.refetch();
        return result;
      } catch (e) {
        if (request.identity === current.current) {
          const status = (e as { status?: number }).status;
          if (status && status >= 400 && status < 500) attempt.current = null;
        }
        throw e;
      }
    },
  });
  const send = (
    q: Parameters<typeof mutation.mutate>[0],
    options?: { onSuccess?: (result: any) => void },
  ) => {
    if (!attempt.current) completion.current = options?.onSuccess;
    mutation.mutate(q, {
      onSuccess: (result) => {
        const callback = completion.current;
        completion.current = undefined;
        callback?.(result);
      },
    });
  };
  return {
    send,
    query,
    data: query.isError ? undefined : query.data,
    owner,
    user,
    identity,
    isCurrent: (value: string) => current.current === value,
    mutation,
    uncertain: !!attempt.current,
    retry: () => {
      const request = attempt.current;
      if (!request) return;
      const body = JSON.parse(request.body);
      send({
        path: request.path,
        payload: body.payload,
        version: body.expectedVersion ?? undefined,
        method: request.method,
      });
    },
  };
}
