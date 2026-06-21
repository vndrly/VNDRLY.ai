import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { ShieldAlert } from "lucide-react";
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
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-red-600" />
          {t("safety.dashboardTitle")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <button
          type="button"
          className={CARD_INNER_TILE_CLICKABLE_CLASS + " block w-full text-left text-sm"}
          onClick={() => notificationsModal?.openNotificationsWithCategory("safety")}
          data-testid="safety-dashboard-open-notifications"
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <div className="text-xs text-muted-foreground">{t("safety.score")}</div>
              <div className="text-2xl font-bold">{data.safetyScore}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("safety.daysClean")}</div>
              <div className="text-2xl font-bold">{data.daysWithoutRecordable ?? "—"}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("safety.openEvents")}</div>
              <div className="text-lg font-semibold">{data.openEventCount}</div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground">{t("safety.openHipo")}</div>
              <div className="text-lg font-semibold">{data.openHipoCount}</div>
            </div>
          </div>
        </button>
      </CardContent>
    </Card>
  );
}
