import { useEffect, useMemo, useState, type ButtonHTMLAttributes } from "react";
import { Link, useLocation } from "wouter";
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
  MessageSquare,
  AtSign,
  Mic,
  StickyNote,
  TimerOff,
  CheckCircle,
  XCircle,
  RotateCcw,
  Banknote,
  Unlock,
  Send,
  Flag,
  HandCoins,
  UserCheck,
  LogIn,
  LogOut,
  Plug,
  ShieldAlert,
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
import { buildNotificationMailtoUrl } from "@/lib/notification-mailto";
import NotificationSendToDialog from "@/components/notification-send-to-dialog";
import { parseTicketIdFromNotificationLink } from "@/lib/ticket-send-to-api";
import { useRateLimitGate } from "@/hooks/use-rate-limit-gate";
import { cn } from "@/lib/utils";
import { PILL_HEIGHT_CLASS, PILL_MIN_HEIGHT_CLASS } from "@/lib/pill-doctrine";
import { useBrand } from "@/hooks/use-brand";
import { portalDisplayLogo } from "@/lib/portal-branding";
import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";
import { notificationsModalTheme, type NotificationsModalTheme } from "@/components/notifications-modal-tokens";
import { useTheme } from "@/hooks/use-theme";

const CATEGORY_IDS = ["all", "tickets", "hotlist", "compliance", "crew", "comments", "visitor", "system", "safety"] as const;

const SAFETY_NOTIFICATION_TYPES = new Set([
  "safety_event_submitted",
  "safety_stop_work",
  "safety_event_hipo",
  "safety_event_update",
  "safety_event_closed",
]);

function effectiveNotificationCategory(n: NotificationRow): string {
  if (SAFETY_NOTIFICATION_TYPES.has(n.type) || n.category === "safety") return "safety";
  return n.category ?? "system";
}

function stripLinkQuery(href: string): string {
  const idx = href.indexOf("?");
  return idx >= 0 ? href.slice(0, idx) : href;
}

function parseSiteLocationFromHref(href: string): { id: number; name: string | null } | null {
  try {
    const url = new URL(href, "https://vndrly.ai");
    const rawId = url.searchParams.get("siteLocationId");
    if (!rawId || !Number.isFinite(Number(rawId))) return null;
    const name = url.searchParams.get("siteName");
    return { id: Number(rawId), name: name ?? null };
  } catch {
    return null;
  }
}

const TYPE_META: Record<string, { Icon: LucideIcon; labelKey: string }> = {
  ticket_assigned: { Icon: Briefcase, labelKey: "notifications.types.ticket_assigned" },
  ticket_kicked_back: { Icon: RotateCcw, labelKey: "notifications.types.ticket_kicked_back" },
  ticket_rejected: { Icon: XCircle, labelKey: "notifications.types.ticket_rejected" },
  ticket_approved: { Icon: CheckCircle, labelKey: "notifications.types.ticket_approved" },
  funds_dispersed: { Icon: Banknote, labelKey: "notifications.types.funds_dispersed" },
  ticket_pending_long: { Icon: Clock, labelKey: "notifications.types.ticket_pending_long" },
  ticket_inactive: { Icon: TimerOff, labelKey: "notifications.types.ticket_inactive" },
  ticket_note_added: { Icon: StickyNote, labelKey: "notifications.types.ticket_note_added" },
  ticket_forwarded: { Icon: Send, labelKey: "notifications.types.ticket_forwarded" },
  askv_shared: { Icon: Send, labelKey: "notifications.types.askv_shared" },
  ticket_unblocked: { Icon: Unlock, labelKey: "notifications.types.ticket_unblocked" },
  ticket_flagged: { Icon: Flag, labelKey: "notifications.types.ticket_flagged" },
  direct_assignment_offered: { Icon: Briefcase, labelKey: "notifications.types.direct_assignment_offered" },
  direct_assignment_committed: { Icon: CheckCircle, labelKey: "notifications.types.direct_assignment_committed" },
  direct_assignment_passed: { Icon: XCircle, labelKey: "notifications.types.direct_assignment_passed" },
  direct_assignment_cancelled: { Icon: XCircle, labelKey: "notifications.types.direct_assignment_cancelled" },
  workflow_nudge: { Icon: BellRing, labelKey: "notifications.types.workflow_nudge" },
  crew_added: { Icon: UserPlus, labelKey: "notifications.types.crew_added" },
  schedule_changed: { Icon: CalendarClock, labelKey: "notifications.types.schedule_changed" },
  crew_removed: { Icon: UserMinus, labelKey: "notifications.types.crew_removed" },
  crew_punch_in: { Icon: LogIn, labelKey: "notifications.types.crew_punch_in" },
  crew_punch_out: { Icon: LogOut, labelKey: "notifications.types.crew_punch_out" },
  ptt_message: { Icon: Mic, labelKey: "notifications.types.ptt_message" },
  hotlist_match: { Icon: Flame, labelKey: "notifications.types.hotlist_match" },
  bid_placed: { Icon: HandCoins, labelKey: "notifications.types.bid_placed" },
  bid_updated: { Icon: HandCoins, labelKey: "notifications.types.bid_updated" },
  bid_declined: { Icon: XCircle, labelKey: "notifications.types.bid_declined" },
  bid_outbid: { Icon: TrendingDown, labelKey: "notifications.types.bid_outbid" },
  job_awarded: { Icon: Trophy, labelKey: "notifications.types.job_awarded" },
  cert_expiring: { Icon: CalendarClock, labelKey: "notifications.types.cert_expiring" },
  cert_expired: { Icon: CalendarX, labelKey: "notifications.types.cert_expired" },
  long_checkin: { Icon: Clock, labelKey: "notifications.types.long_checkin" },
  low_battery: { Icon: BatteryLow, labelKey: "notifications.types.low_battery" },
  rating_received: { Icon: Star, labelKey: "notifications.types.rating_received" },
  oa_connection_revoked: { Icon: Plug, labelKey: "notifications.types.oa_connection_revoked" },
  oa_connection_expiring: { Icon: Plug, labelKey: "notifications.types.oa_connection_expiring" },
  visitor_checked_in: { Icon: UserCheck, labelKey: "notifications.types.visitor_checked_in" },
  visitor_checked_out: { Icon: UserCheck, labelKey: "notifications.types.visitor_checked_out" },
  comment_mention: { Icon: AtSign, labelKey: "notifications.types.comment_mention" },
  comment_added: { Icon: MessageSquare, labelKey: "notifications.types.comment_added" },
  hotlist_comment_added: { Icon: MessageSquare, labelKey: "notifications.types.hotlist_comment_added" },
  safety_event_submitted: { Icon: ShieldAlert, labelKey: "notifications.types.safety_event_submitted" },
  safety_stop_work: { Icon: ShieldAlert, labelKey: "notifications.types.safety_stop_work" },
  safety_event_hipo: { Icon: ShieldAlert, labelKey: "notifications.types.safety_event_hipo" },
  safety_event_update: { Icon: ShieldAlert, labelKey: "notifications.types.safety_event_update" },
  safety_event_closed: { Icon: ShieldAlert, labelKey: "notifications.types.safety_event_closed" },
};

const DEFAULT_TYPE_META = { Icon: BellRing, labelKey: "notifications.types.default" };

function typeMetaFor(type: string) {
  return TYPE_META[type] ?? DEFAULT_TYPE_META;
}

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

type FlatBubbleTone = "brand" | "grey" | "danger";

function flatBubbleToneClass(theme: NotificationsModalTheme, tone: FlatBubbleTone) {
  if (tone === "brand") return theme.flatActionBrandClassName;
  if (tone === "danger") return theme.flatActionDangerClassName;
  return theme.flatActionGreyClassName;
}

function FlatBubbleButton({
  theme,
  tone = "grey",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  theme: NotificationsModalTheme;
  tone?: FlatBubbleTone;
}) {
  return (
    <button
      type="button"
      className={cn(
        theme.flatActionBaseClassName,
        flatBubbleToneClass(theme, tone),
        className,
      )}
      {...props}
    />
  );
}

function FlatBubbleLink({
  theme,
  tone = "brand",
  className,
  ...props
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & {
  theme: NotificationsModalTheme;
  tone?: FlatBubbleTone;
}) {
  return (
    <a
      className={cn(
        theme.flatActionBaseClassName,
        flatBubbleToneClass(theme, tone),
        className,
      )}
      {...props}
    />
  );
}

function stopRowAction(e: React.MouseEvent) {
  e.preventDefault();
  e.stopPropagation();
}

function stopRowBubble(e: React.MouseEvent) {
  e.stopPropagation();
}

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialTab?: string;
};

export default function NotificationsModal({ open, onOpenChange, initialTab = "all" }: Props) {
  const { t } = useTranslation();
  const timeAgo = useTimeAgo();
  const { user } = useAuth();
  const brand = useBrand();
  const displayLogo = portalDisplayLogo(brand, VNDRLY_LOGO_SQUARE);
  const { resolved: themeResolved } = useTheme();
  const modalTheme = notificationsModalTheme(themeResolved);
  const [, navigate] = useLocation();
  const qc = useQueryClient();
  const [activeTab, setActiveTab] = useState<string>("all");
  const [sendToNotification, setSendToNotification] = useState<NotificationRow | null>(null);
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

  const listQueryEnabled = enabled && !rateLimitedState;
  const {
    data: list,
    error: listError,
    isPending: listPending,
    isFetching: listFetching,
    isError: listIsError,
    refetch: refetchList,
  } = useQuery({
    queryKey: ["notifications", "list", user?.userId],
    queryFn: () => notificationsApi.list(),
    enabled: listQueryEnabled,
    retry: (failureCount: number, err: unknown) => {
      const status = (err as { status?: number } | null)?.status;
      if (status === 429) return false;
      return failureCount < 3;
    },
  });
  const listLoading =
    listQueryEnabled && !listIsError && (listPending || listFetching);

  const countGate = useRateLimitGate(countError, "notifications.rate_limited");
  const listGate = useRateLimitGate(listError, "notifications.rate_limited");
  const rateLimited = countGate.rateLimited || listGate.rateLimited;
  const listLoadFailed = listIsError && !rateLimited;
  const retryAfterSeconds =
    Math.max(countGate.retryAfterSeconds ?? 0, listGate.retryAfterSeconds ?? 0) || null;

  useEffect(() => {
    setRateLimitedState(rateLimited);
  }, [rateLimited]);

  useEffect(() => {
    if (open) setActiveTab(initialTab);
  }, [open, initialTab]);

  const grouped = useMemo(() => {
    const map: Record<string, NotificationRow[]> = { all: list ?? [] };
    for (const n of list ?? []) {
      const cat = effectiveNotificationCategory(n);
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

  const markUnread = useMutation({
    mutationFn: (id: number) => notificationsApi.markUnread(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["notifications", "count", user?.userId] });
      qc.invalidateQueries({ queryKey: ["notifications", "list", user?.userId] });
    },
  });

  const deleteNotification = useMutation({
    mutationFn: (id: number) => notificationsApi.delete(id),
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
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        bare
        className={modalTheme.shellClassName}
        data-testid="modal-notifications"
      >
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <DialogHeader className={modalTheme.toolbarClassName}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
                <img
                  src={displayLogo}
                  alt={brand.name ? `${brand.name} logo` : "VNDRLY logo"}
                  className={modalTheme.logoClassName}
                  draggable={false}
                  data-testid="modal-notifications-logo"
                />
                <DialogTitle className={modalTheme.titleClassName}>{t("notifications.heading")}</DialogTitle>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                <FlatBubbleButton
                  theme={modalTheme}
                  tone="brand"
                  onClick={() => {
                    onOpenChange(false);
                    navigate("/notifications/preferences");
                  }}
                  data-testid="link-modal-notification-prefs"
                >
                  {t("notifications.settings")}
                </FlatBubbleButton>
                {(list?.some((n) => !n.isRead) || count > 0) && (
                  <FlatBubbleButton
                    theme={modalTheme}
                    tone="brand"
                    onClick={() => markAllRead.mutate()}
                    data-testid="button-modal-mark-all-read"
                  >
                    {t("notifications.markAllRead")}
                  </FlatBubbleButton>
                )}
              </div>
            </div>
          </DialogHeader>

          {rateLimited && (
            <div
              className={modalTheme.rateLimitedBannerClassName}
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

          <Tabs value={activeTab} onValueChange={setActiveTab} className={cn("flex min-h-0 flex-1 flex-col", modalTheme.bodySurfaceClassName)}>
            <TabsList className={modalTheme.tabsListClassName}>
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
                      modalTheme.tabTriggerExtraClassName,
                      modalTheme.tabTriggerActiveClassName,
                      modalTheme.tabTriggerInactiveClassName,
                    )}
                    data-testid={`modal-tab-notif-${c.id}`}
                  >
                    {c.label}
                    {unread > 0 && (
                      <span
                        className={cn(
                          "ml-1 inline-flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[9px] font-normal",
                          modalTheme.tabUnreadBadgeClassName,
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
                <TabsContent key={c.id} value={c.id} className={modalTheme.tabsContentClassName}>
                  {listLoading ? (
                    <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                      {t("notifications.loading")}
                    </p>
                  ) : listLoadFailed ? (
                    <div className="space-y-3 px-4 py-8 text-center">
                      <p className="text-xs text-muted-foreground">
                        {t("notifications.loadFailed")}
                      </p>
                      <FlatBubbleButton
                        theme={modalTheme}
                        tone="brand"
                        onClick={() => {
                          void refetchList();
                        }}
                        data-testid="modal-notifications-retry"
                      >
                        {t("common.refresh")}
                      </FlatBubbleButton>
                    </div>
                  ) : rateLimited && list === undefined ? (
                    <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                      {retryAfterSeconds != null
                        ? t("notifications.slowDown.retryIn", { seconds: retryAfterSeconds })
                        : t("notifications.slowDown.brief")}
                    </p>
                  ) : items.length === 0 ? (
                    <p className="px-4 py-8 text-center text-xs text-muted-foreground">
                      {t("notifications.noNotifications")}
                    </p>
                  ) : (
                    items.map((n) => {
                      const meta = typeMetaFor(n.type);
                      const Icon = meta.Icon;
                      const rowHref = n.link ? stripLinkQuery(n.link) : null;
                      const siteLocation = n.link ? parseSiteLocationFromHref(n.link) : null;
                      const inner = (
                        <div
                          className={modalTheme.rowHoverClassName}
                          onClick={() => {
                            if (!n.isRead) markRead.mutate(n.id);
                            if (rowHref) onOpenChange(false);
                          }}
                          data-testid={`modal-notification-${n.id}`}
                        >
                          <div className="flex items-start gap-2">
                            {!n.isRead && (
                              <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", modalTheme.unreadDotClassName)} />
                            )}
                            <div className="flex min-w-0 flex-1 items-start justify-between gap-2">
                              <div className="min-w-0 flex-1">
                                <span
                                  className={cn(
                                    "mb-1 inline-flex max-w-full h-[23px] items-center gap-1 rounded-full px-2 text-[10px] font-normal uppercase tracking-wide sm:px-3 sm:text-xs",
                                    !n.isRead
                                      ? modalTheme.unreadTypeBadgeClassName
                                      : modalTheme.readTypeBadgeClassName,
                                  )}
                                  data-testid={`modal-notification-${n.id}-type-${n.type}`}
                                >
                                  <Icon className="h-3 w-3" />
                                  {t(meta.labelKey)}
                                </span>
                                <p className="text-sm font-medium">{n.title}</p>
                                {n.body && (
                                  <p className="mt-0.5 text-xs text-muted-foreground">{n.body}</p>
                                )}
                                {siteLocation && (
                                  <Link
                                    href={`/site-locations/${siteLocation.id}`}
                                    className="mt-1 inline-block text-xs font-medium text-primary hover:underline"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onOpenChange(false);
                                    }}
                                    data-testid={`modal-notification-${n.id}-site-link`}
                                  >
                                    {t("notifications.siteLocationLink", {
                                      name: siteLocation.name ?? t("notifications.siteLocationFallback"),
                                    })}
                                  </Link>
                                )}
                                <p className="mt-0.5 text-[10px] text-muted-foreground">
                                  {timeAgo(n.createdAt)}
                                </p>
                              </div>
                              <div className="flex shrink-0 flex-wrap items-start justify-end gap-1.5">
                                <FlatBubbleButton
                                  theme={modalTheme}
                                  tone="grey"
                                  onClick={(e) => {
                                    stopRowAction(e);
                                    if (n.isRead) markUnread.mutate(n.id);
                                    else markRead.mutate(n.id);
                                  }}
                                  data-testid={`modal-notification-${n.id}-toggle-read`}
                                >
                                  {n.isRead ? t("notifications.markUnread") : t("notifications.markRead")}
                                </FlatBubbleButton>
                                <FlatBubbleButton
                                  theme={modalTheme}
                                  tone="danger"
                                  onClick={(e) => {
                                    stopRowAction(e);
                                    deleteNotification.mutate(n.id);
                                  }}
                                  data-testid={`modal-notification-${n.id}-delete`}
                                >
                                  {t("notifications.delete")}
                                </FlatBubbleButton>
                                {parseTicketIdFromNotificationLink(n.link ?? "") !== null ? (
                                  <FlatBubbleButton
                                    theme={modalTheme}
                                    tone="brand"
                                    onClick={(e) => {
                                      stopRowAction(e);
                                      setSendToNotification(n);
                                    }}
                                    data-testid={`modal-notification-${n.id}-send-to`}
                                  >
                                    {t("notifications.sendTo")}
                                  </FlatBubbleButton>
                                ) : null}
                                <FlatBubbleLink
                                  theme={modalTheme}
                                  tone="grey"
                                  href={buildNotificationMailtoUrl(n, t(meta.labelKey))}
                                  onClick={stopRowBubble}
                                  data-testid={`modal-notification-${n.id}-share-email`}
                                >
                                  {t("notifications.shareViaEmail")}
                                </FlatBubbleLink>
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                      return rowHref ? (
                        <Link
                          key={n.id}
                          href={rowHref}
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
    <NotificationSendToDialog
      open={sendToNotification !== null}
      onOpenChange={(next) => {
        if (!next) setSendToNotification(null);
      }}
      notification={sendToNotification}
      typeLabel={
        sendToNotification ? t(typeMetaFor(sendToNotification.type).labelKey) : undefined
      }
    />
    </>
  );
}
