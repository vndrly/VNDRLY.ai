import { useMemo, useState } from "react";
import { Link } from "wouter";
import { useTranslation } from "react-i18next";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
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
import { notificationsApi, type NotificationRow } from "@/lib/notifications-api";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PngPillButton as PillButton } from "@/components/png-pill-rollover";

const CATEGORY_IDS = ["all", "tickets", "hotlist", "compliance", "crew", "visitor", "system"] as const;

// Same type→icon/label mapping as the bell dropdown so leads (`ticket_assigned`)
// and crew (`crew_added`) get the same recognizable badge across both surfaces.
const TYPE_META: Record<string, { Icon: LucideIcon; labelKey: string }> = {
  ticket_assigned: { Icon: Briefcase, labelKey: "notifications.types.ticket_assigned" },
  crew_added: { Icon: UserPlus, labelKey: "notifications.types.crew_added" },
  // Task #649 — distinguish a re-schedule of someone already on the
  // crew from a fresh add. Same crew category, different icon/label so
  // workers can tell at a glance what changed.
  schedule_changed: { Icon: CalendarClock, labelKey: "notifications.types.schedule_changed" },
  // Task #639: a removed-from-crew row deserves the same recognizable
  // badge as the added one so a worker scanning the Crew tab can
  // immediately see which entries are assignments vs removals.
  crew_removed: { Icon: UserMinus, labelKey: "notifications.types.crew_removed" },
  hotlist_match: { Icon: Flame, labelKey: "notifications.types.hotlist_match" },
  bid_outbid: { Icon: TrendingDown, labelKey: "notifications.types.bid_outbid" },
  job_awarded: { Icon: Trophy, labelKey: "notifications.types.job_awarded" },
  cert_expiring: { Icon: CalendarClock, labelKey: "notifications.types.cert_expiring" },
  cert_expired: { Icon: CalendarX, labelKey: "notifications.types.cert_expired" },
  long_checkin: { Icon: Clock, labelKey: "notifications.types.long_checkin" },
  // Task #57 — same crew-category low-battery alert exposed in the bell;
  // mirrored here so the inbox shows the same recognizable badge.
  low_battery: { Icon: BatteryLow, labelKey: "notifications.types.low_battery" },
  rating_received: { Icon: Star, labelKey: "notifications.types.rating_received" },
};

function timeAgo(iso: string, t: (k: string, opts?: any) => string): string {
  const ts = new Date(iso).getTime();
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return t("notifications.timeAgo.seconds", { count: s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("notifications.timeAgo.minutes", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("notifications.timeAgo.hours", { count: h });
  const d = Math.floor(h / 24);
  return t("notifications.timeAgo.days", { count: d });
}

export default function NotificationsInboxPage() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const [tab, setTab] = useState<string>("all");
  const { data, isLoading } = useQuery({
    queryKey: ["notifications", "list", "inbox"],
    queryFn: () => notificationsApi.list(),
  });

  const grouped = useMemo(() => {
    const map: Record<string, NotificationRow[]> = { all: data ?? [] };
    for (const n of data ?? []) {
      const cat = n.category ?? "system";
      (map[cat] = map[cat] || []).push(n);
    }
    return map;
  }, [data]);

  const markRead = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });
  const markAllRead = useMutation({
    mutationFn: () => notificationsApi.markAllRead(),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["notifications"] }),
  });

  return (
    <div className="max-w-3xl mx-auto p-6">
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-2xl font-semibold">{t("notifications.title")}</h1>
        <div className="flex gap-2">
          <Link href="/notifications/preferences">
            <PillButton color="image" data-testid="link-prefs-from-inbox">
              {t("notifications.preferences")}
            </PillButton>
          </Link>
          <PillButton
            color="blue"
            onClick={() => markAllRead.mutate()}
            data-testid="button-inbox-mark-all-read"
          >
            {t("notifications.markAllRead")}
          </PillButton>
        </div>
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          {CATEGORY_IDS.map((id) => {
            const items = grouped[id] ?? [];
            const unread = items.filter((n) => !n.isRead).length;
            return (
              <TabsTrigger
                key={id}
                value={id}
                data-testid={`inbox-tab-${id}`}
              >
                {t(`notifications.categories.${id}`)}
                {unread > 0 && (
                  <span className="ml-1 inline-flex items-center justify-center h-4 min-w-[16px] rounded-full bg-amber-500 text-white text-[9px] px-1">
                    {unread}
                  </span>
                )}
              </TabsTrigger>
            );
          })}
        </TabsList>
        {CATEGORY_IDS.map((id) => {
          const items = grouped[id] ?? [];
          return (
            <TabsContent key={id} value={id}>
              {isLoading ? (
                <p className="text-sm text-muted-foreground py-12 text-center">{t("notifications.loading")}</p>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground py-12 text-center">{t("notifications.noNotifications")}</p>
              ) : (
                <div className="rounded-lg border bg-card divide-y">
                  {items.map((n) => {
                    const meta = TYPE_META[n.type];
                    const Icon = meta?.Icon;
                    const inner = (
                      <div
                        className={`px-4 py-3 cursor-pointer hover:bg-muted/40 ${!n.isRead ? "bg-amber-50" : ""}`}
                        onClick={() => {
                          if (!n.isRead) markRead.mutate(n.id);
                        }}
                        data-testid={`inbox-notification-${n.id}`}
                      >
                        <div className="flex items-start gap-2">
                          {!n.isRead && (
                            <span className="mt-1.5 w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                          )}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between gap-2">
                              <div className="flex items-center gap-2 min-w-0">
                                {meta && Icon && (
                                  <span
                                    className={`inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide shrink-0 ${
                                      !n.isRead
                                        ? "bg-amber-500 text-white"
                                        : "bg-muted text-muted-foreground"
                                    }`}
                                    data-testid={`inbox-notification-${n.id}-type-${n.type}`}
                                  >
                                    <Icon className="w-3 h-3" />
                                    {t(meta.labelKey)}
                                  </span>
                                )}
                                <p className="text-sm font-medium truncate">{n.title}</p>
                              </div>
                              <span className="text-[10px] uppercase text-muted-foreground shrink-0">
                                {(CATEGORY_IDS as readonly string[]).includes(n.category ?? "")
                                  ? t(`notifications.categories.${n.category}`)
                                  : n.category}
                              </span>
                            </div>
                            {n.body && (
                              <p className="text-xs text-muted-foreground mt-0.5">{n.body}</p>
                            )}
                            <p className="text-[10px] text-muted-foreground mt-1">
                              {timeAgo(n.createdAt, t)}
                            </p>
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
                  })}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
