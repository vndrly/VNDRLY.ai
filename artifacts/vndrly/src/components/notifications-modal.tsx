import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
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
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@/hooks/use-auth";
import { notificationsApi, type NotificationRow } from "@/lib/notifications-api";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { cn } from "@/lib/utils";
import { PILL_HEIGHT_CLASS, PILL_MIN_HEIGHT_CLASS } from "@/lib/pill-doctrine";

const CATEGORY_IDS = ["all", "tickets", "hotlist", "compliance", "crew", "visitor", "system"] as const;

const TYPE_META: Record<string, { Icon: LucideIcon; labelKey: string }> = {
  ticket_assigned: { Icon: Briefcase, labelKey: "notifications.types.ticket_assigned" },
  workflow_nudge: { Icon: BellRing, labelKey: "notifications.types.workflow_nudge" },
  crew_added: { Icon: UserPlus, labelKey: "notifications.types.crew_added" },
  schedule_changed: { Icon: CalendarClock, labelKey: "notifications.types.schedule_changed" },
  crew_removed: { Icon: UserMinus, labelKey: "notifications.types.crew_removed" },
  hotlist_match: { Icon: Flame, labelKey: "notifications.types.hotlist_match" },
  bid_outbid: { Icon: TrendingDown, labelKey: "notifications.types.bid_outbid" },
  job_awarded: { Icon: Trophy, labelKey: "notifications.types.job_awarded" },
  cert_expiring: { Icon: CalendarClock, labelKey: "notifications.types.cert_expiring" },
  cert_expired: { Icon: CalendarX, labelKey: "notifications.types.cert_expired" },
  long_checkin: { Icon: Clock, labelKey: "notifications.types.long_checkin" },
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

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export default function NotificationsModal({ open, onOpenChange }: Props) {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const { user } = useAuth();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>("all");
  const categories = CATEGORY_IDS.map((id) => ({ id, label: t(`notifications.categories.${id}`) }));
  const enabled = !!user && open;
  const [rateLimitedState, setRateLimitedState] = useState(false);

  const { data: countData, error: countError } = useQuery({
    queryKey: ["notifications", "count", user?.userId],
    queryFn: () => notificationsApi.unreadCount(),
    enabled: enabled && !rateLimitedState,
    retry: (failureCount: number, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });

  const { data: list, error: listError } = useQuery({
    queryKey: ["notifications", "list", user?.userId],
    queryFn: () => notificationsApi.list(),
    enabled: enabled && !rateLimitedState,
    retry: (failureCount: number, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });

  const countGate = useRateLimitGate(countError, "notifications.rate_limited");
  const listGate = useRateLimitGate(listError, "notifications.rate_limited");
  const rateLimited = countGate.rateLimited || listGate.rateLimited;
  const retryAfterSeconds =
    Math.max(countGate.retryAfterSeconds ?? 0, listGate.retryAfterSeconds ?? 0) || null;

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

  const count = countData?.count ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        bare
        className="w-[min(100vw-2rem,42rem)] max-h-[min(100vh-2rem,40rem)] p-0"
        data-testid="modal-notifications"
      >
        <div className="flex min-h-0 flex-1 flex-col">
          <DialogHeader className="border-b px-4 py-3 pr-12">
            <div className="flex items-center justify-between gap-3">
              <DialogTitle className="text-base">{t("notifications.heading")}</DialogTitle>
              <div className="flex items-center gap-2">
                {(list?.some((n) => !n.isRead) || count > 0) && (
                  <button
                    type="button"
                    className="text-xs text-primary hover:underline"
                    onClick={() => markAllRead.mutate()}
                    data-testid="button-modal-mark-all-read"
                  >
                    {t("notifications.markAllRead")}
                  </button>
                )}
              </div>
            </div>
          </DialogHeader>

          {rateLimited && (
            <div
              className="flex items-center gap-1.5 border-b bg-amber-50 px-4 py-1.5 text-[11px] text-amber-800"
              data-testid="modal-notifications-slow-down"
              role="status"
            >
              <Clock className="h-3 w-3 shrink-0" />
              <span>
                {retryAfterSeconds != null
                  ? t("notifications.slowDown.retryIn", { seconds: retryAfterSeconds })
                  : t("notifications.slowDown.brief")}
              </span>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab} className="flex min-h-0 flex-1 flex-col">
            <TabsList className="h-auto w-full justify-start gap-1.5 overflow-x-auto rounded-none border-b bg-transparent px-3 py-2">
              {categories.map((c) => {
                const items = grouped[c.id] ?? [];
                const unread = items.filter((n) => !n.isRead).length;
                return (
                  <TabsTrigger
                    key={c.id}
                    value={c.id}
                    className={cn(
                      PILL_HEIGHT_CLASS,
                      PILL_MIN_HEIGHT_CLASS,
                      "group shrink-0 rounded-full border px-3 text-xs font-normal shadow-none",
                      "data-[state=active]:!border-[color:var(--brand-primary)] data-[state=active]:!bg-[color:var(--brand-primary)] data-[state=active]:!text-white data-[state=active]:drop-shadow-[0_1.5px_3px_rgba(0,0,0,0.55)]",
                      "data-[state=inactive]:!border-[color:var(--brand-primary)]/35 data-[state=inactive]:!bg-[color:color-mix(in_srgb,var(--brand-primary)_18%,white)] data-[state=inactive]:!text-[color:var(--brand-primary)]",
                    )}
                    data-testid={`modal-tab-notif-${c.id}`}
                  >
                    {c.label}
                    {unread > 0 && (
                      <span
                        className={cn(
                          "ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-normal",
                          "bg-[color:var(--brand-primary)] text-white group-data-[state=active]:bg-white/30",
                        )}
                      >
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
                <TabsContent key={c.id} value={c.id} className="m-0 min-h-0 flex-1 overflow-y-auto">
                  {!list ? (
                    <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                      {t("notifications.loading")}
                    </p>
                  ) : items.length === 0 ? (
                    <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                      {t("notifications.noNotifications")}
                    </p>
                  ) : (
                    items.map((n) => {
                      const meta = TYPE_META[n.type];
                      const Icon = meta?.Icon;
                      const inner = (
                        <div
                          className={`cursor-pointer border-b px-4 py-3 hover:bg-muted/40 ${!n.isRead ? "bg-amber-50" : ""}`}
                          onClick={() => {
                            if (!n.isRead) markRead.mutate(n.id);
                            if (n.link) onOpenChange(false);
                          }}
                          data-testid={`modal-notification-${n.id}`}
                        >
                          <div className="flex items-start gap-2">
                            {!n.isRead && (
                              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-amber-500" />
                            )}
                            <div className="min-w-0 flex-1">
                              {meta && Icon && (
                                <span
                                  className={`mb-1 inline-flex h-[23px] items-center gap-1 rounded-full px-3 text-xs font-normal uppercase tracking-wide ${
                                    !n.isRead
                                      ? "bg-amber-500 text-white"
                                      : "bg-muted text-muted-foreground"
                                  }`}
                                  data-testid={`modal-notification-${n.id}-type-${n.type}`}
                                >
                                  <Icon className="h-3 w-3" />
                                  {t(meta.labelKey)}
                                </span>
                              )}
                              <p className="text-sm font-medium">{n.title}</p>
                              {n.body && (
                                <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                              )}
                              <p className="mt-0.5 text-[10px] text-muted-foreground">
                                {timeAgo(n.createdAt)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                      return n.link ? (
                        <Link
                          key={n.id}
                          href={n.link}
                          onClick={() => {
                            if (!n.isRead) markRead.mutate(n.id);
                            onOpenChange(false);
                          }}
                        >
                          {inner}
                        </Link>
                      ) : (
                        <div key={n.id}>{inner}</div>
                      );
                    })
                  )}
                </TabsContent>
              );
            })}
          </Tabs>
        </div>
      </DialogContent>
    </Dialog>
  );
}
