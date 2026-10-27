import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import BrandPillButton from "@/components/brand-pill-button";
import { useAuth } from "@/hooks/use-auth";
import {
  effectiveNotificationCategory,
  NOTIFICATION_CATEGORY_IDS,
} from "@/lib/notification-categories";
import { notificationsApi, type NotificationRow } from "@/lib/notifications-api";

export function NotificationTree() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<NotificationRow | null>(null);
  const list = useQuery({
    queryKey: ["notifications", "list", user?.userId],
    queryFn: () => notificationsApi.list(),
    enabled: !!user,
    retry: false,
  });
  const grouped = useMemo(() => {
    const groups = new Map<string, NotificationRow[]>();
    for (const notification of list.data ?? []) {
      const category = effectiveNotificationCategory(notification);
      groups.set(category, [...(groups.get(category) ?? []), notification]);
    }
    return groups;
  }, [list.data]);
  const categories = NOTIFICATION_CATEGORY_IDS
    .filter((category) => category !== "all")
    .map((category) => ({
      id: category,
      label: t(`notifications.categories.${category}`),
      items: grouped.get(category) ?? [],
    }))
    .filter((category) => category.items.length > 0);
  const unreadTotal = (list.data ?? []).filter((notification) => !notification.isRead).length;
  const markRead = useMutation({
    mutationFn: (id: number) => notificationsApi.markRead(id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["notifications", "list", user?.userId] }),
        queryClient.invalidateQueries({ queryKey: ["notifications", "count", user?.userId] }),
      ]);
      setSelected(null);
    },
  });

  return (
    <details open role="group" aria-label="Notifications" className="hub-conversation-category">
      <summary>
        <BellRing className="h-4 w-4 text-[color:var(--brand-primary)]" aria-hidden="true" />
        {t("notifications.heading")}
        <span>{unreadTotal}</span>
      </summary>
      <div className="hub-notification-tree space-y-1 pb-3 pl-3">
        {list.isPending && <p className="py-2 text-xs text-muted-foreground">{t("notifications.loading")}</p>}
        {list.isError && <p role="alert" className="py-2 text-xs text-red-400">{t("notifications.loadFailed")}</p>}
        {!list.isPending && !list.isError && categories.length === 0 && (
          <p className="py-2 text-xs text-muted-foreground">{t("notifications.noNotifications")}</p>
        )}
        {categories.map((category) => {
          const unread = category.items.filter((notification) => !notification.isRead).length;
          const unreadLabel = `${unread} unread ${category.label} notification${unread === 1 ? "" : "s"}`;
          return (
            <details
              key={category.id}
              open
              aria-label={`${category.label} notifications`}
              className="hub-notification-category"
            >
              <summary>
                <span className="font-medium">{category.label}</span>
                <span aria-label={unreadLabel}>{unread}</span>
              </summary>
              <div className="space-y-1 pb-2">
                {category.items.map((notification) => {
                  const description = notification.body?.trim() || t("notifications.noNotifications");
                  return (
                    <button
                      key={notification.id}
                      type="button"
                      className="hub-notification-row block w-full rounded-lg px-3 py-2 text-left"
                      aria-label={`${notification.title}: ${description}`}
                      data-read={notification.isRead}
                      onClick={() => setSelected(notification)}
                    >
                      <span className="block truncate text-sm font-semibold">{notification.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{description}</span>
                    </button>
                  );
                })}
              </div>
            </details>
          );
        })}
      </div>

      {selected && (
        <section
          role="dialog"
          aria-modal="false"
          aria-label={selected.title}
          className="hub-notification-detail-layer"
        >
          <header className="flex items-start gap-3 border-b border-[#454548] p-4">
            <BellRing className="mt-1 h-5 w-5 shrink-0 text-[color:var(--brand-primary)]" aria-hidden="true" />
            <div className="min-w-0 flex-1">
              <p className="text-xs uppercase tracking-wide text-muted-foreground">
                {t(`notifications.categories.${effectiveNotificationCategory(selected)}`)}
              </p>
              <h2 className="break-words text-lg font-semibold">{selected.title}</h2>
            </div>
            <button
              type="button"
              className="hub-conversation-tool shrink-0"
              aria-label="Close notification"
              title={t("common.close")}
              onClick={() => setSelected(null)}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </button>
          </header>
          <div className="space-y-4 p-4">
            <p className="whitespace-pre-wrap break-words text-sm">
              {selected.body?.trim() || selected.title}
            </p>
            <time className="block text-xs text-muted-foreground" dateTime={selected.createdAt}>
              {new Date(selected.createdAt).toLocaleString()}
            </time>
            {markRead.error && <p role="alert" className="text-sm text-red-400">{String(markRead.error)}</p>}
            <BrandPillButton
              tone="blue"
              disabled={markRead.isPending}
              onClick={() => {
                if (selected.isRead) setSelected(null);
                else markRead.mutate(selected.id);
              }}
            >
              {t("notifications.markRead")}
            </BrandPillButton>
          </div>
        </section>
      )}
    </details>
  );
}
