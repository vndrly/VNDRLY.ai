import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
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

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type SafetyEventRow = {
  id: number;
  eventNumber: string;
  eventType: string;
  status: string;
  title: string;
  siteName?: string;
  isHighPotential: boolean;
  isStopWork: boolean;
  createdAt: string;
};

export default function SafetyInboxPage() {
  const { t } = useTranslation();
  const brand = useBrand();
  const iconStyle = { color: brand.isOrgBranded ? brand.primary : "#dc2626" };

  const { data, isLoading } = useQuery({
    queryKey: ["safety-events"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/safety/events?openOnly=true&limit=50`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("safety fetch failed");
      const json = await r.json();
      return (json.data ?? []) as SafetyEventRow[];
    },
    refetchInterval: 30_000,
  });

  const events = data ?? [];

  return (
    <div className="space-y-4 p-4 md:p-6 max-w-4xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <ShieldAlert className="h-6 w-6" style={iconStyle} />
          {t("safety.inboxTitle")}
        </h1>
        <p className="text-muted-foreground text-sm mt-1">{t("safety.inboxSubtitle")}</p>
      </div>

      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldAlert className={CARD_TITLE_ICON_CLASS} style={iconStyle} />
            {t("safety.openCount", { count: events.length })}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {isLoading ? (
            <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
          ) : events.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t("safety.inboxEmpty")}</p>
          ) : (
            events.map((event) => (
              <Link
                key={event.id}
                href={`/safety/${event.id}`}
                className={cn(CARD_INNER_TILE_CLICKABLE_CLASS, "block text-sm")}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{event.eventNumber}</span>
                  <span className="text-xs uppercase">{event.status.replace(/_/g, " ")}</span>
                </div>
                <div className="mt-1">{event.title}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {event.siteName} · {event.eventType.replace(/_/g, " ")}
                  {event.isStopWork ? ` · ${t("safety.stopWork")}` : ""}
                </div>
              </Link>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
