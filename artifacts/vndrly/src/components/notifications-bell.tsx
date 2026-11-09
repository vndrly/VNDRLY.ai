import { NextStepsNavButton, useNextSteps } from "@/components/next-steps";
import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import {
  NOTIFICATION_CREATED_BROWSER_EVENT,
  notificationsApi,
  type NotificationCreatedBrowserDetail,
} from "@/lib/notifications-api";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import { useNotificationsModal } from "@/components/notifications-modal-context";
import { useMessageSound } from "@/hooks/use-message-sound";
import { subscribeNotificationStream } from "@/lib/shared-notification-stream";
import { useGateStaffingAlerts } from "@/hooks/use-gate-staffing-alerts";

export default function NotificationsBell() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const staffing = useGateStaffingAlerts();
  const setWorkflowOffers = useNextSteps()?.setWorkflowOffers;
  useEffect(() => {
    if (!setWorkflowOffers || staffing.data?.notificationsPaused || staffing.isError) return;
    const blocker = staffing.data?.alerts.find(alert => alert.status !== "resolved" && alert.severity === "critical" && alert.canAcknowledge && !alert.notificationsPaused);
    return setWorkflowOffers("gate-staffing-alerts", blocker ? [{ id: "gate-staffing-recovery", kind: "gate-operation", title: "Restore gate staffing", description: "Review the saved gap and arrange actual watch coverage.", priority: 1, action: { title: "Open saved staffing calendar", href: blocker.href }, context: { siteId: blocker.siteId, stationId: blocker.stationId, shiftId: blocker.shiftId, alertId: blocker.id, siteName: blocker.siteName, stationName: blocker.gateName, day: new URL(blocker.href, "https://vndrly.ai").searchParams.get("date") ?? undefined } }] : []);
  }, [setWorkflowOffers, staffing.data, staffing.isError]);
  const staffingRef = useRef(staffing.data);
  staffingRef.current = staffing.data;
  useMessageSound(user?.userId);
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const notificationsModal = useNotificationsModal();
  const browserNotif = useBrowserNotifications();
  const showRef = useRef(browserNotif.show);
  const navigateRef = useRef(navigate);

  useEffect(() => {
    showRef.current = browserNotif.show;
  }, [browserNotif.show]);

  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const enabled = !!user;
  const [rateLimitedState, setRateLimitedState] = useState(false);
  const { data: countData, error: countError } = useQuery({
    queryKey: ["notifications", "count", user?.userId],
    queryFn: () => notificationsApi.unreadCount(),
    enabled: enabled && !rateLimitedState,
    refetchInterval: 30000,
    retry: (failureCount: number, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });

  const countGate = useRateLimitGate(countError, "notifications.rate_limited");
  useEffect(() => {
    setRateLimitedState(countGate.rateLimited);
  }, [countGate.rateLimited]);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === "undefined" || typeof window.EventSource === "undefined") {
      return;
    }
    let unsubscribe: (() => void) | undefined;
    try {
      const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      const refreshBell = () => {
        void qc.invalidateQueries({ queryKey: ["gate-staffing-alerts", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId] });
        qc.invalidateQueries({
          queryKey: ["notifications", "count", user?.userId],
        });
        qc.invalidateQueries({
          queryKey: ["notifications", "list", user?.userId],
        });
      };
      const onCreated = (msg: MessageEvent) => {
        try {
          const parsed = JSON.parse(
            msg.data,
          ) as NotificationCreatedBrowserDetail;
          if (parsed.type !== "notification.created") return;
          refreshBell();
          // Staffing surfaces consult saved shared state; stale recipient events cannot
          // re-alarm an acknowledged incident or bypass a company's notification hold.
          if (staffingRef.current?.notificationsPaused === true || parsed.notifType === "gate_watch_radar" || parsed.notifType?.startsWith("gate_coverage_")) return;
          window.dispatchEvent(
            new CustomEvent(NOTIFICATION_CREATED_BROWSER_EVENT, {
              detail: parsed,
            }),
          );
          if (parsed.title) {
            const link = parsed.link ?? null;
            showRef.current({
              title: parsed.title,
              body: parsed.body ?? null,
              tag:
                parsed.notificationId != null
                  ? `vndrly-notif-${parsed.notificationId}`
                  : undefined,
              onClick: link
                ? () => {
                    try {
                      navigateRef.current(link);
                    } catch {
                      /* navigation guard */
                    }
                  }
                : undefined,
            });
          }
        } catch {
          /* malformed payload — ignore */
        }
      };
      const onHello = (msg: MessageEvent) => {
        try {
          const parsed = JSON.parse(msg.data) as {
            type?: string;
            gap?: boolean;
          };
          if (parsed.type !== "notification.hello") return;
          if (parsed.gap === true) refreshBell();
        } catch {
          /* malformed payload — ignore */
        }
      };
      const identity = JSON.stringify([user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId]);
      unsubscribe = subscribeNotificationStream(`${apiBase}/api/notifications/events`, identity, (type, event) => {
        if (type === "notification.created") onCreated(event);
        else if (type === "notification.hello") onHello(event);
        else refreshBell();
      });
    } catch {
      unsubscribe = undefined;
    }
    return () => unsubscribe?.();
  }, [enabled, qc, user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId]);

  if (!user) return null;
  const count = countData?.count ?? 0;
  const currentGaps = (staffing.data?.alerts ?? []).filter(alert => alert.status !== "resolved" && alert.severity === "critical" && !alert.notificationsPaused);
  const alarm = !staffing.data?.notificationsPaused && currentGaps.length > 0;
  const pulse = alarm && currentGaps.some(alert => alert.status === "open");

  return (
    <div className="flex items-center gap-1">
    <button
      type="button"
      className={`relative rounded-md p-2 transition-colors hover:bg-white/10 ${
        alarm ? "bg-red-700 text-white hover:text-white" : count > 0 ? "text-white hover:text-white" : "text-gray-400 hover:text-white"
      } ${pulse ? "motion-safe:animate-pulse" : ""}`}
      data-testid="button-notifications-bell"
      data-staffing-pulse={pulse}
      aria-label={`${t("notifications.bellLabel")}${alarm ? pulse ? " · Critical staffing gap needs acknowledgment" : " · Acknowledged staffing gap remains unresolved" : ""}`}
      onClick={() => notificationsModal?.openNotifications()}
    >
      <Bell className="h-5 w-5" />
      {count > 0 && (
        <Badge
          className="absolute -right-1 -top-1 flex h-5 min-w-[24px] items-center justify-center rounded-full border-0 bg-red-600 px-1.5 text-[10px] font-bold leading-none text-white"
          data-testid="badge-notification-count"
        >
          {count > 99 ? "99+" : count}
        </Badge>
      )}
    </button>
    <NextStepsNavButton />
    </div>
  );
}
