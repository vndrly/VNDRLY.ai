import { useSafetyMaturity } from "@/hooks/use-safety-maturity";

import { Link, useLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Library, ShieldAlert } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CARD_INNER_TILE_CLICKABLE_CLASS } from "@/components/ui/card";
import { useNotificationsModal } from "@/components/notifications-modal-context";

const API_BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type Metrics = {
  safetyScore: number;
  daysWithoutRecordable: number | null;
  openEventCount: number;
  openHipoCount: number;
};

export function SafetyDashboardCard() {
  const { t } = useTranslation();
  const [,navigate] = useLocation();
  const maturity = useSafetyMaturity();
  const notificationsModal = useNotificationsModal();
  const { data, isLoading } = useQuery({
    queryKey: ["safety-metrics"],
    queryFn: async () => {
      const r = await fetch(`${API_BASE}/api/safety/metrics`, { credentials: "include" });
      if (!r.ok) throw new Error("metrics failed");
      const json = await r.json();
      return json.data as Metrics;
    },
    refetchInterval: 60_000,
  });

  if (isLoading || !data) return null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0 pb-2">
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-red-600" />
          {t("safety.dashboardTitle")}
        </CardTitle>
        <Link
          href="/work-hub/library"
          className="ml-auto inline-flex shrink-0 items-center gap-2 text-sm no-underline hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          <Library className="h-4 w-4" style={{ color: "var(--brand-primary)" }} aria-hidden="true" />
          {t("workHubLibrary.library")}
        </Link>
      </CardHeader>
      <CardContent>
        <div
          className={CARD_INNER_TILE_CLICKABLE_CLASS + " block w-full text-left text-sm"}
          data-testid="safety-dashboard-open-notifications"
        >
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="text-left" onClick={()=>navigate("/work-hub/library?tab=certifications")}>
              <div className="text-xs text-muted-foreground">{t("safetyMaturity.title")}</div>
              <div className="text-2xl font-bold">{maturity.data ? maturity.data.score : "—"}</div>
            <span className="block text-xs">{maturity.data?.incomplete ? t("safetyMaturity.incompleteShort") : ""}</span>
            </button>
            <div>
              <div className="text-xs text-muted-foreground">{t("safety.daysClean")}</div>
              <div className="text-2xl font-bold">{data.daysWithoutRecordable ?? "—"}</div>
            </div>
            <button type="button" className="text-left" onClick={()=>notificationsModal?.openNotificationsWithCategory("safety")}>
              <div className="text-xs text-muted-foreground">{t("safety.openEvents")}</div>
              <div className="text-lg font-semibold">{data.openEventCount}</div>
            </button>
            <div>
              <div className="text-xs text-muted-foreground">{t("safety.openHipo")}</div>
              <div className="text-lg font-semibold">{data.openHipoCount}</div>
            </div>
          </div>
        </div>
        {!!maturity.data?.recommendations?.length && <div className="mt-3 space-y-2">
          <p className="text-sm font-semibold">Improve your Safety program</p>
          {maturity.data.recommendations.map(item => <Link key={item.familyId}
            href={item.courseId ? `/work-hub/library/${encodeURIComponent(item.courseId)}` : '/work-hub/library?tab=certifications'}
            className="block text-sm hover:underline">
            Complete {item.title} for {item.remaining} outstanding staff requirement{item.remaining === 1 ? '' : 's'}, or submit matching outside certification for review.
          </Link>)}
        </div>}
      </CardContent>
    </Card>
  );
}
