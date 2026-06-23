import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import {
  useListTickets,
  getListTicketsQueryKey,
} from "@workspace/api-client-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CARD_INNER_TILE_CLICKABLE_CLASS,
  CARD_TITLE_ICON_CLASS,
} from "@/components/ui/card";
import { useBrand } from "@/hooks/use-brand";
import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";
import TicketStatusBadge from "@/components/ticket-status-badge";
import TicketLifecyclePill from "@/components/ticket-lifecycle-pill";

type Props = {
  siteLocationId: number | null;
  className?: string;
};

export function RecentTicketsCard({ siteLocationId, className }: Props) {
  const { t } = useTranslation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };
  const listParams =
    siteLocationId != null ? { siteLocationId, limit: 100, offset: 0 } : undefined;

  const { data: ticketsPage, isLoading } = useListTickets(listParams, {
    query: {
      enabled: siteLocationId != null,
      queryKey: getListTicketsQueryKey(listParams),
      staleTime: 30_000,
    },
  });

  const recentTickets = useMemo(() => {
    const tickets = ticketsPage?.items ?? [];
    return [...tickets]
      .sort((a, b) => b.id - a.id)
      .slice(0, 100);
  }, [ticketsPage]);

  return (
    <Card className={className ?? "mt-4"} data-testid="card-recent-tickets">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2">
          <FileText className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
          {t("siteMap.recentTickets.title", "Recent tickets")} (
          {siteLocationId != null ? recentTickets.length : 0})
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2 max-h-[320px] overflow-y-auto">
        {siteLocationId == null ? (
          <div className="text-sm text-muted-foreground">
            {t(
              "siteMap.recentTickets.pickSite",
              "Select a site location to see recent tickets.",
            )}
          </div>
        ) : isLoading ? (
          <div className="text-sm text-muted-foreground">
            {t("siteMap.recentTickets.loading", "Loading recent tickets…")}
          </div>
        ) : recentTickets.length === 0 ? (
          <div
            className="text-sm text-muted-foreground"
            data-testid="text-recent-tickets-empty"
          >
            {t(
              "siteMap.recentTickets.empty",
              "No tickets for this site yet.",
            )}
          </div>
        ) : (
          recentTickets.map((ticket) => (
            <Link
              key={ticket.id}
              href={`/tickets/${ticket.id}`}
              className={cn(
                CARD_INNER_TILE_CLICKABLE_CLASS,
                "block text-sm no-underline text-inherit",
              )}
              data-testid={`recent-ticket-row-${ticket.id}`}
            >
              <div className="font-medium flex items-center gap-1.5">
                <FileText
                  className="w-3.5 h-3.5 shrink-0"
                  style={iconStyle}
                />
                #{String(ticket.id).padStart(8, "0")}
              </div>
              <div className="text-xs text-muted-foreground">
                {ticket.workTypeName || "—"}
                {ticket.fieldEmployeeName
                  ? ` · ${ticket.fieldEmployeeName}`
                  : ""}
              </div>
              <div className="flex items-center gap-2 flex-wrap mt-1">
                <TicketStatusBadge
                  status={ticket.status}
                  updatedAt={ticket.updatedAt}
                  compact
                />
                <TicketLifecyclePill
                  state={ticket.lifecycleState}
                  idSuffix={ticket.id}
                />
                <span className="text-xs text-muted-foreground ml-auto">
                  {new Date(ticket.updatedAt).toLocaleDateString()}
                </span>
              </div>
            </Link>
          ))
        )}
      </CardContent>
    </Card>
  );
}
