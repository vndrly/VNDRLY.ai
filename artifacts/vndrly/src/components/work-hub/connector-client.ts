import { useQueries, useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import type { CommunicationProvider } from "./provider-logo";
export type Account = {
  id: string;
  provider: CommunicationProvider;
  label: string;
  status: string;
};
export type Folder = {
  id: string;
  name: string;
  unread?: number;
  children?: number;
  team?: boolean;
  kind?: string;
};
export type Message = {
  id: string;
  subject?: string;
  from: string;
  to?: string[];
  cc?: string[];
  bcc?: string[];
  text: string;
  date: string;
  unread?: boolean;
  starred?: boolean;
  draftId?: string;
  replies?: number;
  attachments?: { id: string; name: string; type: string; size: number }[];
};
export type Selection = {
  account: Account;
  kind: "email" | "chats" | "channels";
  folder?: Folder;
  message?: Message;
};
export async function connectorRequest<T = any>(
  path: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const r = await fetch(`/api/work-hub/connectors${path}`, {
      credentials: "include",
      method: body === undefined ? "GET" : "POST",
      headers: { "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal,
    });
    const text = await r.text();
    // A local restart or gateway interruption can return an empty/non-JSON body.
    // Retry reads once; never replay sends or other mutations.
    if (
      body === undefined &&
      attempt === 0 &&
      (!text.trim() || [502, 503, 504].includes(r.status))
    ) {
      await new Promise((resolve) => setTimeout(resolve, 750));
      signal?.throwIfAborted();
      continue;
    }
    let value;
    try {
      value = JSON.parse(text);
    } catch {
      throw new Error(
        "Unable to load the connection response. Please try again.",
      );
    }
    if (!r.ok) throw new Error(value.message || "Connection request failed.");
    return value;
  }
}
export function useConnectorScope() {
  const { user } = useAuth();
  return `${user?.userId}:${user?.activeMembershipId}:${user?.vendorId}:${user?.partnerId}`;
}
export function useAccounts() {
  const scope = useConnectorScope();
  return useQuery({
    queryKey: ["comms-accounts", scope],
    queryFn: ({ signal }) =>
      connectorRequest<{
        accounts: Account[];
        configured: Record<string, boolean>;
      }>("/accounts", undefined, signal),
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
    queryFn: ({signal}: {signal: AbortSignal}) => connectorRequest(`/accounts/${a.id}/folders?`, undefined, signal),
    staleTime: 60_000,
    retry: false,
  })) });
  // Prime only five lightweight inbox summaries while the overview is visible.
  // Full messages remain on-demand and all cache keys include the private scope.
  useQueries({ queries: mail.filter(a => a.status === "connected").map(a => {
    const folder = a.provider === "gmail" ? "INBOX" : "inbox";
    return {
      queryKey: ["comms-mail", scope, a.id, folder, undefined, ""],
      queryFn: ({signal}: {signal: AbortSignal}) => connectorRequest(`/accounts/${a.id}/messages?folder=${folder}`, undefined, signal),
      staleTime: 30_000,
      retry: false,
    };
  }) });
  const results = useQueries({ queries: mail.map(a => ({
    queryKey: ["comms-inbox-count", scope, a.id],
    queryFn: ({ signal }: { signal: AbortSignal }) => connectorRequest<{ total: number; unread?: number }>(`/accounts/${a.id}/inbox-summary`, undefined, signal),
    enabled: a.status === "connected",
    staleTime: 30_000,
    refetchInterval: 60_000,
    refetchIntervalInBackground: false,
    retry: false,
  })) });
  const counts = Object.fromEntries(mail.map((a,i) => [a.id, results[i].data?.total]));
  return { counts, unread: results.reduce((sum, result) => sum + (result.data?.unread ?? 0), 0), total: mail.every(a => typeof counts[a.id] === "number") ? mail.reduce((sum,a) => sum + counts[a.id]!,0) : undefined };
}
