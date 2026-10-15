import { useCampaign } from "../form-campaigns/use-campaign";
export function useLibrary<T>(path: string, parse: (value: unknown) => T) {
  const api = useCampaign(path.replace(/^\/api\/work-hub/, ""), parse);
  return {
    data: api.data ?? null,
    error: api.mutation.error?.message ?? api.query.error?.message ?? "",
    busy: api.mutation.isPending,
    loading: api.query.isPending,
    contextKey: api.identity,
    uncertain: api.uncertain,
    reload: () => api.query.refetch(),
    send: (
      target: string,
      payload: unknown,
      version?: number,
      method = "POST",
    ) =>
      api.sendAsync({
        path: target.replace(/^\/api\/work-hub/, ""),
        payload,
        version,
        method,
      }),
    retryOriginal: api.retryAsync,
  };
}
