import { useEffect, useMemo, useState, type ButtonHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import { useBrand } from "@/hooks/use-brand";
import { useTheme } from "@/hooks/use-theme";
import { portalDisplayLogo } from "@/lib/portal-branding";
import { VNDRLY_LOGO_SQUARE } from "@/lib/vndrly-brand-assets";
import {
  notificationsModalTheme,
  type NotificationsModalTheme,
} from "@/components/notifications-modal-tokens";
import {
  parseTicketIdFromHref,
  ticketSendToApi,
  type SendToGroupId,
  type SendToRecipientGroups,
} from "@/lib/ticket-send-to-api";
import {
  recipientDetail,
  recipientHeadline,
  selectedRecipientUserIds,
  sendToRowKey,
} from "@/lib/send-to-display";
import type { NotificationRow } from "@/lib/notifications-api";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  notification: NotificationRow | null;
  typeLabel?: string;
};

const GROUP_LABEL_KEYS: Record<SendToGroupId, string> = {
  on_ticket: "notifications.sendToGroups.onTicket",
  vendor_poc_field: "notifications.sendToGroups.vendorPocField",
  vendor_poc_office: "notifications.sendToGroups.vendorPocOffice",
  vendor_office: "notifications.sendToGroups.vendorOffice",
  partner_poc_operations: "notifications.sendToGroups.partnerPocOperations",
  partner_poc_ap: "notifications.sendToGroups.partnerPocAp",
  partner_office: "notifications.sendToGroups.partnerOffice",
  field_crew: "notifications.sendToGroups.fieldCrew",
  vndrly_office: "notifications.sendToGroups.vndrlyOffice",
};

type FooterPillTone = "cancel" | "submit";

function footerPillClass(theme: NotificationsModalTheme, tone: FooterPillTone) {
  if (tone === "cancel") return theme.flatActionGreyHoverRedClassName;
  return theme.flatActionGreyHoverBlueClassName;
}

function ModalFooterPill({
  theme,
  tone,
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  theme: NotificationsModalTheme;
  tone: FooterPillTone;
}) {
  return (
    <button
      type="button"
      className={cn(theme.flatActionBaseClassName, footerPillClass(theme, tone), className)}
      {...props}
    />
  );
}

function sendToRecipientsErrorMessage(err: unknown, t: (key: string) => string): string {
  const data = (err as { data?: { code?: string } } | null)?.data;
  const code = data?.code;
  if (code === "send_to.forbidden") return t("notifications.sendToForbidden");
  if (code === "send_to.no_ticket") return t("notifications.sendToNoTicket");
  if (code === "notification.not_found") return t("notifications.sendToNotificationMissing");
  if (code === "auth.required" || code === "auth.not_authenticated" || code === "auth.unauthenticated") {
    return t("notifications.sendToAuthRequired");
  }
  if (code === "auth.session_invalidated") {
    return t("notifications.sendToSessionExpired");
  }
  return t("notifications.sendToLoadFailed");
}

export default function NotificationSendToDialog({
  open,
  onOpenChange,
  notification,
  typeLabel,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const brand = useBrand();
  const { resolved: themeResolved } = useTheme();
  const modalTheme = notificationsModalTheme(themeResolved);
  const displayLogo = portalDisplayLogo(brand, VNDRLY_LOGO_SQUARE);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState("");

  const ticketId = notification?.link ? parseTicketIdFromHref(notification.link) : null;

  const recipientsQuery = useQuery({
    queryKey: ["send-to-recipients", notification?.id, ticketId],
    queryFn: async () => {
      if (!notification) return null;
      if (notification.id && ticketId) {
        return ticketSendToApi.listRecipientsForNotification(notification.id);
      }
      if (ticketId) {
        const res = await ticketSendToApi.listRecipientsForTicket(ticketId);
        return { ticketId, groups: res.groups };
      }
      return null;
    },
    enabled: open && !!notification && ticketId !== null,
  });

  useEffect(() => {
    if (!open) {
      setSelected(new Set());
      setMessage("");
    }
  }, [open]);

  const groups: SendToRecipientGroups = recipientsQuery.data?.groups ?? [];

  const allRecipients = useMemo(
    () => groups.flatMap((g) => g.recipients),
    [groups],
  );

  const toggle = (rowKey: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(rowKey)) next.delete(rowKey);
      else next.add(rowKey);
      return next;
    });
  };

  const recipientUserIds = useMemo(
    () => selectedRecipientUserIds(selected),
    [selected],
  );

  const send = useMutation({
    mutationFn: async () => {
      if (!notification) throw new Error("No notification");
      const recipientUserIds = selectedRecipientUserIds(selected);
      const payload = {
        recipientUserIds,
        message: message.trim() || null,
      };
      if (notification.id) {
        return ticketSendToApi.sendFromNotification(notification.id, payload);
      }
      if (ticketId) {
        return ticketSendToApi.sendFromTicket(ticketId, {
          ...payload,
          sourceTitle: notification.title,
          sourceBody: notification.body ?? undefined,
        });
      }
      throw new Error("No ticket link");
    },
    onSuccess: (result) => {
      toast({
        title: t("notifications.sendToSuccess", { count: result.notifiedCount }),
        description: t("notifications.sendToCoopNote"),
      });
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const msg =
        (err instanceof Error && err.message) || t("notifications.sendToFailed");
      toast({ title: msg, variant: "destructive" });
    },
  });

  const canSend =
    recipientUserIds.length > 0 && !send.isPending && !recipientsQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent bare className={modalTheme.shellClassName} data-testid="dialog-send-to">
        <div className="relative z-10 flex min-h-0 flex-1 flex-col">
          <DialogHeader className={modalTheme.toolbarClassName}>
            <div className="flex min-w-0 items-center gap-2 sm:gap-2.5">
              <img
                src={displayLogo}
                alt={brand.name ? `${brand.name} logo` : "VNDRLY logo"}
                className={modalTheme.logoClassName}
                draggable={false}
                data-testid="dialog-send-to-logo"
              />
              <DialogTitle className={modalTheme.titleClassName}>
                {t("notifications.sendToTitle")}
              </DialogTitle>
            </div>
          </DialogHeader>

          <div className={cn("min-h-0 flex-1 overflow-y-auto", modalTheme.bodySurfaceClassName)}>
            {ticketId === null ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">{t("notifications.sendToNoTicket")}</p>
            ) : recipientsQuery.isLoading || recipientsQuery.isFetching ? (
              <div className="flex items-center justify-center px-4 py-8 text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                {t("notifications.loading")}
              </div>
            ) : recipientsQuery.isError ? (
              <div className="space-y-3 px-4 py-4 text-center">
                <p className="text-sm text-muted-foreground">
                  {sendToRecipientsErrorMessage(recipientsQuery.error, t)}
                </p>
                <ModalFooterPill
                  theme={modalTheme}
                  tone="submit"
                  onClick={() => {
                    void recipientsQuery.refetch();
                  }}
                  data-testid="send-to-retry"
                >
                  {t("common.refresh")}
                </ModalFooterPill>
              </div>
            ) : allRecipients.length === 0 ? (
              <p className="px-4 py-3 text-sm text-muted-foreground">{t("notifications.sendToEmpty")}</p>
            ) : (
              <div className="space-y-4 pb-3">
                <p className="px-4 pt-3 text-xs text-muted-foreground">{t("notifications.sendToCoopNote")}</p>
                {notification?.title ? (
                  <div className="mx-4 rounded-md border border-gray-400/50 bg-black/5 px-3 py-2 text-xs dark:border-gray-500/60 dark:bg-black/10">
                    {typeLabel ? (
                      <p className="mb-1 font-medium uppercase tracking-wide text-muted-foreground">
                        {typeLabel}
                      </p>
                    ) : null}
                    <p className="font-medium">{notification.title}</p>
                    {notification.body ? (
                      <p className="mt-1 text-muted-foreground">{notification.body}</p>
                    ) : null}
                  </div>
                ) : null}

                {groups.map((group) => (
                  <div key={group.id}>
                    <p className="mb-2 px-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                      {t(GROUP_LABEL_KEYS[group.id])}
                    </p>
                    <ul>
                      {group.recipients.map((r) => {
                        const rowKey = sendToRowKey(group.id, r.userId);
                        const checked = selected.has(rowKey);
                        return (
                          <li key={rowKey}>
                            <label
                              className={cn(
                                "flex items-start gap-2",
                                modalTheme.rowHoverClassName,
                                checked && modalTheme.rowSelectedClassName,
                              )}
                            >
                              <Checkbox
                                className="mt-0.5"
                                checked={checked}
                                onCheckedChange={() => toggle(rowKey)}
                                data-testid={`send-to-recipient-${rowKey}`}
                              />
                              <span className="min-w-0 flex-1">
                                <span className="block text-sm font-medium">
                                  {recipientHeadline(r)}
                                </span>
                                <span className="block text-xs text-muted-foreground">
                                  {recipientDetail(r)}
                                </span>
                              </span>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}

                <div className="px-4">
                  <Label htmlFor="send-to-message">{t("notifications.sendToMessageLabel")}</Label>
                  <Textarea
                    id="send-to-message"
                    value={message}
                    onChange={(e) => setMessage(e.target.value.slice(0, 500))}
                    placeholder={t("notifications.sendToMessagePlaceholder")}
                    className="mt-1.5 min-h-[72px] bg-background"
                    data-testid="send-to-message"
                  />
                </div>
              </div>
            )}
          </div>

          <div
            className={cn(
              "flex shrink-0 flex-wrap items-center justify-end gap-2 border-t px-4 py-3",
              modalTheme.sectionBorderClassName,
              modalTheme.bodySurfaceClassName,
            )}
          >
            <ModalFooterPill
              theme={modalTheme}
              tone="cancel"
              onClick={() => onOpenChange(false)}
              data-testid="send-to-cancel"
            >
              {t("common.cancel")}
            </ModalFooterPill>
            <ModalFooterPill
              theme={modalTheme}
              tone="submit"
              disabled={!canSend}
              className={cn(!canSend && "pointer-events-none opacity-50")}
              onClick={() => send.mutate()}
              data-testid="send-to-submit"
            >
              {send.isPending ? (
                <>
                  <Loader2 className="mr-1 inline h-3 w-3 animate-spin" />
                  {t("notifications.sendToSending")}
                </>
              ) : (
                t("notifications.sendToSubmit", { count: recipientUserIds.length })
              )}
            </ModalFooterPill>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
