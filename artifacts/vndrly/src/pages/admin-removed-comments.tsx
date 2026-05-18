// Admin "Removed comments" audit page (Task #52).
//
// One-stop view of every soft-deleted comment across both ticket
// note logs and hotlist comments in a recent window (default 30 d,
// configurable up to 365 via the days dropdown). The list is fed
// directly by `GET /api/admin/removed-comments?days=N` which already
// merges the two tables and resolves display names server-side, so
// this page stays a thin presentation layer with no client-side
// joining or N+1 fetches.
//
// Each row shows source (ticket vs hotlist), the parent ticket /
// job id (linked to the deep page so the admin can jump straight
// into context and restore from the comments panel there), the
// original author and content, and who removed it / when. Restore
// is intentionally NOT a button on this list page — restore lives
// on the comments panel itself so the admin sees the surrounding
// thread before un-deleting. We deliberately just link to the
// parent record.
//
// Admin-only — the route handler also enforces this; the client
// guard short-circuits the wasted fetch and shows a clearer state
// when a non-admin lands here directly.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { PillButton } from "@/components/pill";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { MessageSquareOff, RefreshCcw, ExternalLink } from "lucide-react";

type RemovedComment = {
  source: "ticket" | "hotlist";
  id: number;
  parentId: number;
  content: string;
  attachments: string[] | null;
  attachmentCount: number;
  createdAt: string;
  createdById: number | null;
  createdByName: string | null;
  deletedAt: string | null;
  deletedById: number | null;
  deletedByName: string | null;
};

type RemovedCommentsResponse = {
  days: number;
  since: string;
  items: RemovedComment[];
};

const DAY_OPTIONS = [7, 14, 30, 60, 90, 180, 365];

function formatDateTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString();
}

// Cap content at ~280 chars in the table cell — admins click through
// to the parent record for the full context. Without a cap a single
// long comment stretches the row to multiple screens.
function truncate(s: string, max = 280): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function parentLink(row: RemovedComment): string {
  // Tickets have a dedicated route (App.tsx: /tickets/:id), so we deep
  // link straight to the ticket page with a fragment that the comments
  // panel can scroll to. Hotlist jobs don't have a standalone route —
  // they live inside the dashboard's HotlistSection which keys off the
  // `?hotlistJob=` query string (see components/hotlist-section.tsx
  // around line 203). The fragment is harmless if that section ignores
  // it; admins land on the dashboard with the right job opened.
  return row.source === "ticket"
    ? `/tickets/${row.parentId}#comment-${row.id}`
    : `/?hotlistJob=${row.parentId}#comment-${row.id}`;
}

export default function AdminRemovedComments() {
  const { user } = useAuth();
  const isAdmin = user?.role === "admin";
  const [days, setDays] = useState<number>(30);

  const { data, isLoading, isError, error, refetch, isFetching } = useQuery<
    RemovedCommentsResponse
  >({
    queryKey: ["admin", "removed-comments", days],
    enabled: isAdmin,
    queryFn: async () => {
      const r = await fetch(`/api/admin/removed-comments?days=${days}`, {
        credentials: "include",
      });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error(body.error || `HTTP ${r.status}`);
      }
      return (await r.json()) as RemovedCommentsResponse;
    },
  });

  const items = data?.items ?? [];
  const counts = useMemo(() => {
    let ticket = 0;
    let hotlist = 0;
    for (const r of items) {
      if (r.source === "ticket") ticket += 1;
      else hotlist += 1;
    }
    return { ticket, hotlist, total: items.length };
  }, [items]);

  if (!isAdmin) {
    return (
      <div className="p-6 text-sm text-muted-foreground">
        Admin role required.
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6" data-testid="page-admin-removed-comments">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3">
          <MessageSquareOff className="h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-2xl font-semibold">Removed comments</h1>
            <p className="text-sm text-muted-foreground">
              Soft-deleted ticket and hotlist comments from the last{" "}
              {data?.days ?? days} days.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Select
            value={String(days)}
            onValueChange={(v) => setDays(parseInt(v))}
          >
            <SelectTrigger
              className="w-[140px]"
              data-testid="select-days-window"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DAY_OPTIONS.map((d) => (
                <SelectItem key={d} value={String(d)}>
                  Last {d} days
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <PillButton
            color="image"
            onClick={() => refetch()}
            disabled={isFetching}
            data-testid="button-refresh"
          >
            <RefreshCcw
              className={`h-4 w-4 mr-1 ${isFetching ? "animate-spin" : ""}`}
            />
            Refresh
          </PillButton>
        </div>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-base">
            {counts.total} removed comments
          </CardTitle>
          <div className="flex gap-2 text-xs text-muted-foreground">
            <Badge variant="outline" data-testid="badge-count-ticket">
              {counts.ticket} ticket
            </Badge>
            <Badge variant="outline" data-testid="badge-count-hotlist">
              {counts.hotlist} hotlist
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          {isError ? (
            <div className="text-sm text-red-600" data-testid="text-error">
              Failed to load removed comments:{" "}
              {error instanceof Error ? error.message : "unknown error"}
            </div>
          ) : isLoading ? (
            <div className="space-y-2">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div
              className="text-sm text-muted-foreground py-6 text-center"
              data-testid="text-empty"
            >
              No removed comments in the selected window.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Source</TableHead>
                    <TableHead>Author</TableHead>
                    <TableHead>Original content</TableHead>
                    <TableHead>Posted</TableHead>
                    <TableHead>Removed by</TableHead>
                    <TableHead>Removed at</TableHead>
                    <TableHead className="text-right">Open</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((row) => (
                    <TableRow
                      key={`${row.source}-${row.id}`}
                      data-testid={`row-removed-${row.source}-${row.id}`}
                    >
                      <TableCell>
                        <Badge
                          variant={
                            row.source === "ticket" ? "default" : "secondary"
                          }
                        >
                          {row.source === "ticket"
                            ? `Ticket #${row.parentId}`
                            : `Hotlist #${row.parentId}`}
                        </Badge>
                      </TableCell>
                      <TableCell
                        className="text-sm"
                        data-testid={`text-author-${row.source}-${row.id}`}
                      >
                        {row.createdByName || "—"}
                      </TableCell>
                      <TableCell
                        className="text-sm max-w-[480px] whitespace-pre-wrap break-words"
                        data-testid={`text-content-${row.source}-${row.id}`}
                      >
                        <div>{truncate(row.content)}</div>
                        {row.attachmentCount > 0 && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            +{row.attachmentCount} attachment
                            {row.attachmentCount === 1 ? "" : "s"}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(row.createdAt)}
                      </TableCell>
                      <TableCell
                        className="text-sm"
                        data-testid={`text-deleted-by-${row.source}-${row.id}`}
                      >
                        {row.deletedByName || "—"}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                        {formatDateTime(row.deletedAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        <Link href={parentLink(row)}>
                          <PillButton
                            color="image"
                            className="min-w-[28px] px-0"
                            data-testid={`link-open-${row.source}-${row.id}`}
                          >
                            <ExternalLink className="h-4 w-4" />
                          </PillButton>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
