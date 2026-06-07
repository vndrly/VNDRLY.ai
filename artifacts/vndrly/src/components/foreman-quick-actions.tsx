import { Bell, Calendar, PlusCircle, Radio } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useLocation } from "wouter";
import { cn } from "@/lib/utils";
import { useBrand } from "@/hooks/use-brand";

type Props = {
  portalBase?: string;
  unreadAlerts?: number;
  pendingSchedule?: number;
  onSchedulePress?: () => void;
};

export default function ForemanQuickActions({
  portalBase = "/foreman",
  unreadAlerts = 0,
  pendingSchedule = 0,
  onSchedulePress,
}: Props) {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const brand = useBrand();

  const tiles = [
    {
      key: "alerts",
      icon: Bell,
      label: t("foremanHome.alerts"),
      badge: unreadAlerts,
      onClick: () => navigate("/notifications"),
      testId: "foreman-action-alerts",
    },
    {
      key: "new",
      icon: PlusCircle,
      label: t("foremanHome.startJob"),
      onClick: () => navigate(`${portalBase}/new-ticket`),
      testId: "foreman-action-start-job",
    },
    {
      key: "schedule",
      icon: Calendar,
      label: t("foremanHome.schedule"),
      badge: pendingSchedule,
      onClick: onSchedulePress ?? (() => navigate(`${portalBase}/schedule`)),
      testId: "foreman-action-schedule",
    },
    {
      key: "comms",
      icon: Radio,
      label: t("foremanHome.crewComms"),
      onClick: () => navigate(`${portalBase}/crews`),
      testId: "foreman-action-comms",
    },
  ];

  return (
    <div className="pb-4" data-testid="foreman-quick-actions">
      <h3 className="text-sm font-semibold text-foreground mb-2.5">{t("foremanHome.quickActions")}</h3>
      <div className="grid grid-cols-2 gap-2.5">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <button
              key={tile.key}
              type="button"
              onClick={tile.onClick}
              data-testid={tile.testId}
              className={cn(
                "relative text-left rounded-xl border bg-card p-3.5 min-h-[96px]",
                "hover:shadow-md transition-shadow",
              )}
              style={{
                borderColor: `${brand.primary}55`,
                borderLeftWidth: 4,
                borderLeftColor: brand.primary,
              }}
            >
              <div
                className="relative w-11 h-11 rounded-full flex items-center justify-center mb-2"
                style={{ backgroundColor: `${brand.primary}28` }}
              >
                <Icon className="w-5 h-5" style={{ color: brand.primary }} />
                {tile.badge != null && tile.badge > 0 ? (
                  <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center">
                    {tile.badge > 99 ? "99+" : tile.badge}
                  </span>
                ) : null}
              </div>
              <span className="text-sm font-medium text-foreground leading-snug">{tile.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
