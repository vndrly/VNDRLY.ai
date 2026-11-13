import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { formatTicketTrackingNumber } from "@workspace/db/format";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TicketStatusBadge from "@/components/ticket-status-badge";

type DashboardTicket = {
  id: number;
  status: string;
  siteId: number;
  siteName: string;
  partnerName?: string;
  gateCount?: number | null;
  linkId: string | null;
  stationId: string | null;
  gateName: string | null;
  approvedThisMonth: boolean;
};

const activeStatuses = new Set(["initiated", "draft", "in_progress", "pending_review"]);

export function useDashboardTicketPanels(scope: string, enabled: boolean) {
  return useQuery({
    queryKey: ["dashboard-ticket-panels", scope],
    enabled,
    staleTime: 30_000,
    retry: false,
    queryFn: async ({ signal }): Promise<{ tickets: DashboardTicket[]; gateLocationCount: number | null }> => {
      const response = await fetch(`${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/dashboard/ticket-panels`, {
        credentials: "include",
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      if (!response.ok) throw new Error("Unable to load tickets");
      return response.json();
    },
  });
}

export function DashboardTicketPanels({ query, enabled }: { query: ReturnType<typeof useDashboardTicketPanels>; enabled: boolean }) {
  const { t } = useTranslation();
  const tickets = [...new Map(query.data?.tickets.map(ticket => [ticket.id, ticket])).values()];
  const gateLocationCount = query.data?.gateLocationCount;
  const locationLabel = gateLocationCount != null ? t("nav.gateLocations") : t("dashboard.stats.siteLocations");
  const locationCount = gateLocationCount ?? new Set(tickets.map(ticket => ticket.siteId)).size;
  const linkedSites = new Map<string, Set<string>>();
  for (const ticket of tickets) {
    if (!ticket.linkId) continue;
    const sites = linkedSites.get(ticket.linkId) ?? new Set<string>();
    sites.add(ticket.siteName);
    linkedSites.set(ticket.linkId, sites);
  }
  const panels = [
    { label: t("dashboard.ticketPanels.all"), tickets },
    { label: t("dashboard.stats.active"), tickets: tickets.filter(ticket => activeStatuses.has(ticket.status)) },
    { label: t("dashboard.stats.pendingApproval"), tickets: tickets.filter(ticket => ticket.status === "submitted") },
    { label: t("dashboard.stats.approvedThisMonth"), tickets: tickets.filter(ticket => ticket.approvedThisMonth), href: "/tickets?status=approval_history" },
    { label: t("tickets.awaitingAcceptance"), tickets: tickets.filter(ticket => ticket.status === "awaiting_acceptance") },
  ];

  return (
    <Card className="min-w-0" data-testid="dashboard-ticket-panels">
      <CardHeader>
        <CardTitle className="flex w-full items-center gap-3">
          <span>{t("dashboard.ticketPanels.title")}</span>
          {query.data && !query.isError && (
            <span className="ml-auto text-right text-sm font-normal" data-testid="ticket-panel-location-count">
              {locationLabel} <span className="font-semibold tabular-nums">{locationCount}</span>
            </span>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {query.isError ? (
          <button type="button" onClick={() => void query.refetch()}>Unable to load tickets. Retry</button>
        ) : !enabled ? (
          <p role="status">Ticket loading is paused. Try again shortly.</p>
        ) : !query.data ? (
          <p role="status">Loading tickets…</p>
        ) : panels.map(panel => {
          if (panel.href) return <Link key={panel.label} href={panel.href} className="flex items-center gap-2 border-t border-border py-3 font-medium">
            <ChevronRight aria-hidden="true" className="size-4 shrink-0" />
            <span className="min-w-0 flex-1">{panel.label}</span>
            <span className="tabular-nums">{panel.tickets.length}</span>
          </Link>;
          const groups = new Map<string, DashboardTicket[]>();
          for (const ticket of panel.tickets) {
            const key = ticket.linkId ? `linked:${ticket.linkId}` : ticket.stationId ?? `site:${ticket.siteId}`;
            const rows = groups.get(key) ?? [];
            rows.push(ticket);
            groups.set(key, rows);
          }
          return (
            <details key={panel.label} className="group/panel border-t border-border">
              <summary className="flex cursor-pointer list-none items-center gap-2 py-3 font-medium [&::-webkit-details-marker]:hidden">
                <ChevronRight aria-hidden="true" className="size-4 shrink-0 group-open/panel:rotate-90" />
                <span className="min-w-0 flex-1">{panel.label}</span>
                <span className="tabular-nums">{panel.tickets.length}</span>
              </summary>
              {groups.size === 0 && <p className="pb-3 pl-6 text-sm text-muted-foreground">No tickets</p>}
              {[...groups.entries()].map(([key, rows]) => {
                const first = rows[0];
                const isWarwickGate = first.partnerName === "Warwick Energy Group" &&
                  /^(San Roman Completions|Precision 550|Cactus 152)$/i.test(first.siteName);
                const label = isWarwickGate ? `Warwick ${first.siteName}` : first.linkId
                  ? `${[...(linkedSites.get(first.linkId) ?? [])].join(" / ")} · Linked gates`
                  : [first.siteName, first.gateName].filter(Boolean).join(" · ");
                return (
                  <details key={key} className="group/gate mb-2 min-w-0 rounded-lg border border-border">
                    <summary className="flex cursor-pointer list-none items-center gap-2 p-2 text-sm [&::-webkit-details-marker]:hidden">
                      <ChevronRight aria-hidden="true" className="size-4 shrink-0 group-open/gate:rotate-90" />
                      <span className="min-w-0 flex-1 break-words">{label}</span>
                      <span className="tabular-nums">{first.gateCount ?? rows.length}</span>
                    </summary>
                    <ul className="max-h-80 overflow-y-auto px-2">
                      {rows.map(ticket => (
                        <li key={ticket.id} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-t border-border py-2 text-sm">
                          <Link href={`/tickets/${ticket.id}`} className="hover:underline">{formatTicketTrackingNumber(ticket.id)}</Link>
                          <TicketStatusBadge status={ticket.status} />
                        </li>
                      ))}
                    </ul>
                  </details>
                );
              })}
            </details>
          );
        })}
      </CardContent>
    </Card>
  );
}
