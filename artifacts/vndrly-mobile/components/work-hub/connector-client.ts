import { useQueries, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import type { Provider } from "./ProviderLogo";
export type Account = {
  id: string;
  provider: Provider;
  label: string;
  status: string;
};
export type Row = {
  id: string;
  name?: string;
  subject?: string;
  from?: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  text?: string;
  date?: string;
  unread?: number | boolean;
  starred?: boolean;
  children?: number;
  team?: boolean;
  draftId?: string;
  replies?: number;
  attachments?: { id: string; name: string; type: string; size: number }[];
};
export type Selection = {
  account: Account;
  kind: "email" | "chats" | "channels";
  folder?: Row;
  message?: Row;
};
export const request = <T = any>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
) =>
  apiFetch<T>(`/api/work-hub/connectors${path}`, {
    method: body === undefined ? "GET" : "POST",
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal,
  });
export function useConnectorScope() {
  const { user } = useAuth();
  return `${user?.id}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}`;
}
export function useAccounts() {
  const scope = useConnectorScope();
  return useQuery({
    queryKey: ["comms-accounts", scope],
    queryFn: ({ signal }) =>
      request<{ accounts: Account[]; configured: Record<string, boolean> }>(
        "/accounts",
        undefined,
        signal,
      ),
    staleTime: 15000,
    retry: false,
  });
}
export const enc = encodeURIComponent;

export function useInboxCounts(accounts: Account[] = []) {
  const scope = useConnectorScope();
  const mail = accounts.filter(a => ["gmail", "outlook"].includes(a.provider));
  // Warm folder navigation alongside the overview, rather than waiting until expansion.
  useQueries({ queries: mail.filter(a => a.status === "connected").map(a => ({
    queryKey: ["comms-folders", scope, `/accounts/${a.id}/folders?`],
    queryFn: ({signal}: {signal: AbortSignal}) => request(`/accounts/${a.id}/folders?`, undefined, signal),
    staleTime: 60_000,
    retry: false,
  })) });
  // Prime only five lightweight inbox summaries while the overview is visible.
  // Full messages remain on-demand and all cache keys include the private scope.
  useQueries({ queries: mail.filter(a => a.status === "connected").map(a => {
    const folder = a.provider === "gmail" ? "INBOX" : "inbox";
    return {
      queryKey: ["comms-mail", scope, a.id, folder, undefined, ""],
      queryFn: ({signal}: {signal: AbortSignal}) => request(`/accounts/${a.id}/messages?folder=${folder}`, undefined, signal),
      staleTime: 30_000,
      retry: false,
    };
  }) });
  const results = useQueries({ queries: mail.map(a => ({
    queryKey: ["comms-inbox-count", scope, a.id],
    queryFn: ({ signal }: { signal: AbortSignal }) => request<{ total: number }>(`/accounts/${a.id}/inbox-summary`, undefined, signal),
    enabled: a.status === "connected",
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  })) });
  const counts = Object.fromEntries(mail.map((a,i) => [a.id, results[i].data?.total]));
  return { counts, total: mail.every(a => typeof counts[a.id] === "number") ? mail.reduce((sum,a) => sum + counts[a.id]!,0) : undefined };
}
