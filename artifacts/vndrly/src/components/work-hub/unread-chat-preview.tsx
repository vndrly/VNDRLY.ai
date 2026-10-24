import { useId, useState } from "react";
import { Link } from "wouter";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import BrandPillButton from "@/components/brand-pill-button";
import { workHubRequest } from "@/lib/work-hub-client";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";

type UnreadPage = {
  messages: { id: string; body: string; authorName: string; createdAt: string }[];
  total: number; page: number; hasNext: boolean;
};

export default function UnreadChatPreview({ channel }: { channel: { id: string; name?: string; channelName?: string; unreadCount?: number } }) {
  const { user } = useAuth();
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(0);
  const regionId = useId();
  const client = useQueryClient();
  const path = `/channels/${encodeURIComponent(channel.id)}`;
  const href = `/work-hub/chat?channel=${encodeURIComponent(channel.id)}`;
  const query = useQuery<UnreadPage>({
    queryKey: ["work-hub", "unread-preview", channel.id, user?.userId, user?.activeMembershipId, page],
    queryFn: () => workHubRequest(`${path}/unread?page=${page}`),
    enabled: expanded,
  });
  const markRead = useMutation({
    mutationFn: (id: string) => workHubRequest(`${path}/messages/${encodeURIComponent(id)}/read`, { method: "PUT", body: "{}" }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["work-hub"] }); },
  });
  const data = query.data;
  return <>
    <button type="button" className="hub-home-row" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpanded(value => !value)}>
      <span className="hub-row-label">{channel.name ?? channel.channelName ?? "Conversation"}</span>
      <span className="hub-row-value" aria-label={`${data?.total ?? channel.unreadCount ?? 0} unread messages`}>{data?.total ?? channel.unreadCount ?? 0}</span>
      <ChevronRight aria-hidden="true" className={cn("hub-chevron", expanded && "rotate-90")} />
    </button>
    {expanded && <div id={regionId} className="pb-3 pl-3">
      <Link href={href} className="text-sm text-[var(--brand-primary)] underline">View chat</Link>
      {query.isPending ? <p role="status">Loading unread messages…</p>
        : query.isError ? <div role="alert">Messages could not load. <button type="button" onClick={() => void query.refetch()}>Retry</button></div>
        : <>
          {!data?.messages.length && <p role="status" className="py-3 text-sm">No unread messages.</p>}
          <ul>{data?.messages.map(message => <li key={message.id} className="border-b border-white/10 py-3" data-testid="unread-message">
            <div className="flex items-start justify-between gap-3 text-xs">
              <Link href={href} className="min-w-0 text-muted-foreground">{message.authorName || "Message"} · {new Date(message.createdAt).toLocaleString()}</Link>
              <button type="button" className="shrink-0 whitespace-nowrap text-[var(--brand-primary)] no-underline hover:no-underline disabled:opacity-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]" disabled={markRead.isPending} onClick={() => markRead.mutate(message.id)}>MARK AS READ</button>
            </div>
            <Link href={href} className="block min-w-0 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--brand-primary)]">
              <span className="block whitespace-pre-wrap break-words text-sm">{message.body || "Attachment"}</span>
            </Link>
          </li>)}</ul>
          {!!data?.total && <div className="mt-3 flex flex-wrap items-center gap-3">
            <BrandPillButton tone="brand" disabled={data.page === 0 || query.isFetching || markRead.isPending} onClick={() => setPage(data.page - 1)}>Previous</BrandPillButton>
            <span className="text-xs">{data.page * 10 + 1}–{data.page * 10 + data.messages.length} of {data.total}</span>
            <BrandPillButton tone="brand" disabled={!data.hasNext || query.isFetching || markRead.isPending} onClick={() => setPage(data.page + 1)}>Next</BrandPillButton>
          </div>}
        </>}
      {markRead.isError && <p role="alert" className="text-sm text-red-400">Could not mark the message read. Please try again.</p>}
    </div>}
  </>;
}
