import { useEffect, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useLocation } from "wouter";
import { Bell } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { notificationsApi } from "@/lib/notifications-api";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import { useNotificationsModal } from "@/components/notifications-modal-context";

export default function NotificationsBell() {
  const { t } = useTranslation();
  const { user } = useAuth();
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
    let es: EventSource | null = null;
    try {
      const apiBase = import.meta.env.BASE_URL.replace(/\/$/, "");
      es = new EventSource(`${apiBase}/api/notifications/events`, {
        withCredentials: true,
      });
      const refreshBell = () => {
        qc.invalidateQueries({
          queryKey: ["notifications", "count", user?.userId],
        });
        qc.invalidateQueries({
          queryKey: ["notifications", "list", user?.userId],
        });
      };
      const onCreated = (msg: MessageEvent) => {
        try {
          const parsed = JSON.parse(msg.data) as {
            type?: string;
            notificationId?: number;
            title?: string;
            body?: string | null;
            link?: string | null;
          };
          if (parsed.type !== "notification.created") return;
          refreshBell();
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
      es.addEventListener("notification.created", onCreated as EventListener);
      es.addEventListener("notification.hello", onHello as EventListener);
    } catch {
      es = null;
    }
    return () => {
      if (es) es.close();
    };
  }, [enabled, qc, user?.userId]);

  if (!user) return null;
  const count = countData?.count ?? 0;

  return (
    <button
      type="button"
      className={`relative rounded-md p-2 transition-colors hover:bg-white/10 ${
        count > 0 ? "text-white hover:text-white" : "text-gray-400 hover:text-white"
      }`}
      data-testid="button-notifications-bell"
      aria-label={t("notifications.bellLabel")}
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
  );
}
