import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { Flag } from "lucide-react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CARD_INNER_TILE_CLICKABLE_CLASS,
  CARD_TITLE_ICON_CLASS,
} from "@/components/ui/card";
import TicketStatusBadge from "@/components/ticket-status-badge";
import { useBrand } from "@/hooks/use-brand";
import { cn } from "@/lib/utils";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type FlaggedTicket = {
  ticketId: number;
  trackingNumber: string;
  status: string;
  siteName: string | null;
  vendorName: string | null;
  reason: string | null;
  flaggedAt: string;
  flaggedByName: string | null;
};

export default function FlaggedTicketsPage() {
  const { t } = useTranslation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#f59e0b" };

  const { data, isLoading } = useQuery({
    queryKey: ["flagged-tickets"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/tickets/flagged`, { credentials: "include" });
      if (!r.ok) throw new Error("flagged fetch failed");
      return (await r.json()) as { tickets: FlaggedTicket[] };
    },
    refetchInterval: 30_000,
  });

  const tickets = data?.tickets ?? [];

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Flag className="h-6 w-6" style={iconStyle} />
          {t("flagged.title")}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{t("flagged.subtitle")}</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Flag className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
            {t("flagged.activeCount", { count: tickets.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : tickets.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("flagged.empty")}</p>
          ) : (
            tickets.map((ticket) => (
              <Link
                key={ticket.ticketId}
                href={`/tickets/${ticket.ticketId}`}
                className={cn(CARD_INNER_TILE_CLICKABLE_CLASS, "block text-sm")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{ticket.trackingNumber}</span>
                  <TicketStatusBadge status={ticket.status} />
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  {ticket.siteName ?? t("flagged.unknownSite")}
                  {ticket.vendorName ? ` · ${ticket.vendorName}` : ""}
                </div>
                {ticket.reason ? (
                  <div className="text-xs mt-1">{ticket.reason}</div>
                ) : null}
                <div className="text-xs text-muted-foreground mt-1">
                  {t("flagged.flaggedBy", {
                    name: ticket.flaggedByName ?? t("flagged.someone"),
                    date: new Date(ticket.flaggedAt).toLocaleString(),
                  })}
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
