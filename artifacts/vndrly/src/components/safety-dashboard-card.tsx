import { CompanySafetyReadinessSchema } from "@workspace/api-zod";
import { useAuth } from "@/hooks/use-auth";
import { useLocation } from "wouter";
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
  const [,navigate] = useLocation();
  const {user}=useAuth();
  const readiness=useQuery({queryKey:["company-safety-readiness",user?.userId,user?.vendorId,user?.partnerId],queryFn:async()=>{const response=await fetch(`${API_BASE}/api/safety/readiness`,{credentials:"include"});if(!response.ok)throw Error("readiness unavailable");return CompanySafetyReadinessSchema.parse((await response.json()).data);},refetchInterval:60000});
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
        <div
          className={CARD_INNER_TILE_CLICKABLE_CLASS + " block w-full text-left text-sm"}
          data-testid="safety-dashboard-open-notifications"
        >
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className="text-left" onClick={()=>navigate("/safety-score")}>
              <div className="text-xs text-muted-foreground">{t("safety.score")}</div>
              <div className="text-2xl font-bold">{readiness.data ? `${readiness.data.score}${readiness.data.provisional ? "*" : ""}` : "—"}</div>
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
      </CardContent>
    </Card>
  );
}
