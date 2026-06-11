import { Bell, Calendar, PlusCircle, Radio } from "lucide-react";

import { useTranslation } from "react-i18next";

import { useLocation } from "wouter";

import { useBrand } from "@/hooks/use-brand";
import { cn } from "@/lib/utils";

import { useNotificationsModal } from "@/components/notifications-modal-context";

import { Card, CardContent, CARD_MINI_CONTENT_CLASS, CARD_ICON_ROW_CLASS, CARD_ICON_CLASS, CARD_SURFACE_LINK_HOVER_CLASS } from "@/components/ui/card";



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

  const notificationsModal = useNotificationsModal();



  const tiles = [

    {

      key: "alerts",

      icon: Bell,

      label: t("foremanHome.alerts"),

      badge: unreadAlerts,

      onClick: () => notificationsModal?.openNotifications(),

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



  const iconStyle = { color: brand.primary };



  return (

    <div data-testid="foreman-quick-actions">

      <h3 className="text-sm font-semibold text-foreground mb-2.5">{t("foremanHome.quickActions")}</h3>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">

        {tiles.map((tile) => {

          const Icon = tile.icon;

          return (

            <button

              key={tile.key}

              type="button"

              onClick={tile.onClick}

              data-testid={tile.testId}

              className="text-left"

            >

              <Card className={cn("h-full", CARD_SURFACE_LINK_HOVER_CLASS)}>

                <CardContent className={cn(CARD_MINI_CONTENT_CLASS, "relative")}>

                  {tile.badge != null && tile.badge > 0 ? (

                    <span className="absolute top-3 right-3 min-w-[18px] h-[18px] px-1 rounded-full bg-red-600 text-white text-[10px] font-semibold flex items-center justify-center">

                      {tile.badge > 99 ? "99+" : tile.badge}

                    </span>

                  ) : null}

                  <div className={CARD_ICON_ROW_CLASS}>

                    <Icon className={CARD_ICON_CLASS} style={iconStyle} />

                    <span className="text-xs font-medium text-gray-700">{tile.label}</span>

                  </div>

                </CardContent>

              </Card>

            </button>

          );

        })}

      </div>

    </div>

  );

}

