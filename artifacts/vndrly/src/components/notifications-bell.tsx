import { useEffect, useRef, useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import {
  Bell,
  BellRing,
  Briefcase,
  UserMinus,
  UserPlus,
  Clock,
  Flame,
  TrendingDown,
  Trophy,
  CalendarClock,
  CalendarX,
  Star,
  BatteryLow,
  type LucideIcon,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/use-auth";
import { notificationsApi, type NotificationRow } from "@/lib/notifications-api";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { useBrowserNotifications } from "@/hooks/use-browser-notifications";
import { useNotificationsModal } from "@/components/notifications-modal-context";

const CATEGORY_IDS = ["all", "tickets", "hotlist", "compliance", "crew", "visitor", "system"] as const;

// Map known notification `type` values to a recognizable icon + i18n label.
// Keeps `crew_added` visually equivalent to `ticket_assigned` so leads and
// crew see the same "you got the job" affordance in the inbox/dropdown.
const TYPE_META: Record<string, { Icon: LucideIcon; labelKey: string }> = {
  ticket_assigned: { Icon: Briefcase, labelKey: "notifications.types.ticket_assigned" },
  workflow_nudge: { Icon: BellRing, labelKey: "notifications.types.workflow_nudge" },
  crew_added: { Icon: UserPlus, labelKey: "notifications.types.crew_added" },
  // Task #649 — `schedule_changed` is the more useful signal when a
  // worker stays on the roster but the time/duration moved. Same
  // crew category, different icon/label.
  schedule_changed: { Icon: CalendarClock, labelKey: "notifications.types.schedule_changed" },
  // Task #639: removed-from-crew rows get the same recognizable badge in
  // the bell as in the inbox so a worker sees an obvious assignment vs
  // removal pattern in the dropdown.
  crew_removed: { Icon: UserMinus, labelKey: "notifications.types.crew_removed" },
  hotlist_match: { Icon: Flame, labelKey: "notifications.types.hotlist_match" },
  bid_outbid: { Icon: TrendingDown, labelKey: "notifications.types.bid_outbid" },
  job_awarded: { Icon: Trophy, labelKey: "notifications.types.job_awarded" },
  cert_expiring: { Icon: CalendarClock, labelKey: "notifications.types.cert_expiring" },
  cert_expired: { Icon: CalendarX, labelKey: "notifications.types.cert_expired" },
  long_checkin: { Icon: Clock, labelKey: "notifications.types.long_checkin" },
  // Task #57 — dispatcher alert when a crew member's phone battery
  // crosses below the critical threshold. Same crew category as the
  // roster notifications above.
  low_battery: { Icon: BatteryLow, labelKey: "notifications.types.low_battery" },
  rating_received: { Icon: Star, labelKey: "notifications.types.rating_received" },
};

function useTimeAgo() {
  const { t } = useTranslation();
  return (iso: string): string => {
    const ts = new Date(iso).getTime();
    const s = Math.floor((Date.now() - ts) / 1000);
    if (s < 60) return t("notifications.timeAgo.seconds", { count: s });
    const m = Math.floor(s / 60);
    if (m < 60) return t("notifications.timeAgo.minutes", { count: m });
    const h = Math.floor(m / 60);
    if (h < 24) return t("notifications.timeAgo.hours", { count: h });
    const d = Math.floor(h / 24);
    return t("notifications.timeAgo.days", { count: d });
  };
}

export default function NotificationsBell() {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<string>("all");
  const categories = CATEGORY_IDS.map((id) => ({ id, label: t(`notifications.categories.${id}`) }));
  const [location, navigate] = useLocation();
  const notificationsModal = useNotificationsModal();
  const isFieldOpsPortal = location.startsWith("/foreman") || location.startsWith("/field");
  // Task #48 — browser pop-up integration. The hook reads the per-browser
  // opt-in from localStorage; we never auto-prompt for permission here
  // (the toggle on the preferences page does that on user click). When
  // the user hasn't opted in, `show()` is a no-op and we just refresh
  // the bell state in the background.
  const browserNotif = useBrowserNotifications();
  // Keep the freshest `show` + `navigate` in refs so the SSE effect (a
  // long-lived subscription) doesn't tear down + rebuild every render
  // the parent does. Mirrors the ref-based pattern in ticket-detail.tsx.
  const showRef = useRef(browserNotif.show);
  const navigateRef = useRef(navigate);
  useEffect(() => {
    showRef.current = browserNotif.show;
  }, [browserNotif.show]);
  useEffect(() => {
    navigateRef.current = navigate;
  }, [navigate]);

  const enabled = !!user;
  // Task #699 — gate the polling on `notifications.rate_limited`. We
  // declare the gate state up front so the queries can read the
  // current `rateLimited` flag on the same render that the gate
  // trips. If the bell is parked we suspend the 30s unread-count
  // poll AND the popover-list query, and we render a small inline
  // "slow down" notice in the popover header. The shared 5min cap +
  // auto-clear semantics live in `useRateLimitGate` so the bell
  // re-enables itself without any additional wiring.
  const [rateLimitedState, setRateLimitedState] = useState(false);
  const { data: countData, error: countError } = useQuery({
    queryKey: ["notifications", "count", user?.userId],
    queryFn: () => notificationsApi.unreadCount(),
    enabled: enabled && !rateLimitedState,
    refetchInterval: 30000,
    retry: (failureCount: number, err: unknown) => {
      // Don't burn through the limiter window with the default 3-retry
      // storm — every other error keeps react-query's standard retry.
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });
  const { data: list, error: listError } = useQuery({
    queryKey: ["notifications", "list", user?.userId],
    queryFn: () => notificationsApi.list(),
    enabled: enabled && open && !rateLimitedState,
    retry: (failureCount: number, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });
  // Either query trips the same gate — both endpoints are protected by
  // the same per-session `notifications.rate_limited` limiter.
  const countGate = useRateLimitGate(countError, "notifications.rate_limited");
  const listGate = useRateLimitGate(listError, "notifications.rate_limited");
  const rateLimited = countGate.rateLimited || listGate.rateLimited;
  const retryAfterSeconds =
    Math.max(countGate.retryAfterSeconds ?? 0, listGate.retryAfterSeconds ?? 0) || null;
  // Mirror into local state so the queries can read the latest gate
  // value via their `enabled` flags without re-creating the queries
  // each render. Same shape as the tickets page (Task #675).
  useEffect(() => {
    setRateLimitedState(rateLimited);
  }, [rateLimited]);

  const grouped = useMemo(() => {
    const map: Record<string, NotificationRow[]> = { all: list ?? [] };
    for (const n of list ?? []) {
      const cat = n.category ?? "system";
      (map[cat] = map[cat] || []).push(n);
    }
    return map;
  }, [list]);

  const markRead = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "count", user?.userId] });
      qc.invalidateQueries({ queryKey: ["notifications", "list", user?.userId] });
    },
  });
  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "count", user?.userId] });
      qc.invalidateQueries({ queryKey: ["notifications", "list", user?.userId] });
    },
  });

  // Task #48 — subscribe to /api/notifications/events. Each push triggers
  // an immediate refetch of the unread-count + popover-list queries (so
  // the badge updates the same instant the row hits the DB instead of
  // waiting on the 30s poll), and — when the user has opted in via the
  // browser-pop-up toggle — also raises a system Notification with the
  // alert title/body. The hook itself swallows the show() call when the
  // tab is currently visible, so the bell never duplicates an alert the
  // user is already looking at.
  //
  // The effect deliberately depends only on `enabled` + `user?.userId`
  // so changing language, opening the popover, or any other unrelated
  // re-render doesn't tear down the long-lived EventSource. We pull
  // the latest `show` and `navigate` from refs above.
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
              // Tag by notification id so the same row arriving over
              // multiple reconnects (or a duplicate hello-driven refetch)
              // collapses into a single OS pop-up instead of stacking.
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
          // On reconnect with a non-zero gap we may have missed pushes
          // while disconnected — refresh once so the badge catches up.
          if (parsed.gap === true) refreshBell();
        } catch {
          /* malformed payload — ignore */
        }
      };
      es.addEventListener("notification.created", onCreated as EventListener);
      es.addEventListener("notification.hello", onHello as EventListener);
    } catch {
      // EventSource construction failed (e.g. some test environments).
      // The 30s poll still keeps the bell roughly fresh.
      es = null;
    }
    return () => {
      if (es) es.close();
    };
  }, [enabled, qc, user?.userId]);

  if (!user) return null;
  const count = countData?.count ?? 0;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className={`relative p-2 rounded-md hover:bg-white/10 transition-colors ${
            count > 0 ? "text-white hover:text-white" : "text-gray-400 hover:text-white"
          }`}
          data-testid="button-notifications-bell"
          aria-label={t("notifications.bellLabel")}
        >
          <Bell className="w-5 h-5" />
          {count > 0 && (
            <Badge
              className="absolute -top-1 -right-1 h-5 min-w-[24px] px-1.5 bg-red-600 text-white border-0 text-[10px] font-bold leading-none flex items-center justify-center rounded-full"
              data-testid="badge-notification-count"
            >
              {count > 99 ? "99+" : count}
            </Badge>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0" align="end" data-testid="popover-notifications">
        <div className="flex items-center justify-between px-3 py-2 border-b">
          <span className="text-sm font-semibold">{t("notifications.heading")}</span>
          <div className="flex items-center gap-2">
            <Link
              href="/notifications/preferences"
              className="text-xs text-muted-foreground hover:underline"
              onClick={() => setOpen(false)}
              data-testid="link-notification-prefs"
            >
              {t("notifications.settings")}
            </Link>
            {(list?.some((n) => !n.isRead) || count > 0) && (
              <button
                className="text-xs text-primary hover:underline"
                onClick={() => markAllRead.mutate()}
                data-testid="button-mark-all-read"
              >
                {t("notifications.markAllRead")}
              </button>
            )}
          </div>
        </div>
        {rateLimited && (
          <div
            className="flex items-center gap-1.5 px-3 py-1.5 border-b bg-amber-50 text-[11px] text-amber-800"
            data-testid="notifications-slow-down"
            role="status"
          >
            <Clock className="w-3 h-3 shrink-0" />
            <span>
              {retryAfterSeconds != null
                ? t("notifications.slowDown.retryIn", { seconds: retryAfterSeconds })
                : t("notifications.slowDown.brief")}
            </span>
          </div>
        )}
        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="w-full justify-start rounded-none border-b bg-transparent h-auto p-0">
            {categories.map((c) => {
              const items = grouped[c.id] ?? [];
              const unread = items.filter((n) => !n.isRead).length;
              return (
                <TabsTrigger
                  key={c.id}
                  value={c.id}
                  className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent text-xs px-2 py-2"
                  data-testid={`tab-notif-${c.id}`}
                >
                  {c.label}
                  {unread > 0 && (
                    <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[16px] rounded-full bg-amber-500 text-white text-[9px] px-1">
                      {unread}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
          {categories.map((c) => {
            const items = grouped[c.id] ?? [];
            return (
              <TabsContent key={c.id} value={c.id} className="m-0">
                <div className="max-h-80 overflow-y-auto">
                  {!list ? (
                    <p className="text-xs text-muted-foreground px-3 py-6 text-center">{t("notifications.loading")}</p>
                  ) : items.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-3 py-6 text-center">{t("notifications.noNotifications")}</p>
                  ) : (
                    items.slice(0, 25).map((n) => {
                      const meta = TYPE_META[n.type];
                      const Icon = meta?.Icon;
                      const inner = (
                        <div
                          className={`px-3 py-2 border-b cursor-pointer hover:bg-muted/40 ${!n.isRead ? "bg-amber-50" : ""}`}
                          onClick={() => {
                            if (!n.isRead) markRead.mutate(n.id);
                            if (n.link) setOpen(false);
                          }}
                          data-testid={`notification-${n.id}`}
                        >
                          <div className="flex items-start gap-2">
                            {!n.isRead && <span className="mt-1 w-2 h-2 rounded-full bg-amber-500 shrink-0" />}
                            <div className="flex-1 min-w-0">
                              {meta && Icon && (
                                <span
                                  className={`inline-flex items-center gap-1 h-[23px] px-3 rounded-full text-xs font-normal uppercase tracking-wide mb-1 ${
                                    !n.isRead
                                      ? "bg-amber-500 text-white"
                                      : "bg-muted text-muted-foreground"
                                  }`}
                                  data-testid={`notification-${n.id}-type-${n.type}`}
                                >
                                  <Icon className="w-3 h-3" />
                                  {t(meta.labelKey)}
                                </span>
                              )}
                              <p className="text-sm font-medium">{n.title}</p>
                              {n.body && <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>}
                              <p className="text-[10px] text-muted-foreground mt-0.5">{timeAgo(n.createdAt)}</p>
                            </div>
                          </div>
                        </div>
                      );
                      return n.link ? (
                        <Link key={n.id} href={n.link}>
                          {inner}
                        </Link>
                      ) : (
                        <div key={n.id}>{inner}</div>
                      );
                    })
                  )}
                </div>
              </TabsContent>
            );
          })}
        </Tabs>
        <div className="border-t px-3 py-2 text-center">
          {isFieldOpsPortal && notificationsModal ? (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => {
                setOpen(false);
                notificationsModal.openNotifications();
              }}
              data-testid="link-view-all-notifications"
            >
              {t("notifications.viewAll")}
            </button>
          ) : (
            <Link
              href="/notifications"
              className="text-xs text-primary hover:underline"
              onClick={() => setOpen(false)}
              data-testid="link-view-all-notifications"
            >
              {t("notifications.viewAll")}
            </Link>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
