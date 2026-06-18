import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { useMutation, useQuery } from "@tanstack/react-query";
import { Loader2, Send } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";
import {
  parseTicketIdFromHref,
  ticketSendToApi,
  type SendToGroupId,
  type SendToRecipientGroups,
} from "@/lib/ticket-send-to-api";
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

export default function NotificationSendToDialog({
  open,
  onOpenChange,
  notification,
  typeLabel,
}: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [selected, setSelected] = useState<Set<number>>(new Set());
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

  const toggle = (userId: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  };

  const send = useMutation({
    mutationFn: async () => {
      if (!notification) throw new Error("No notification");
      const recipientUserIds = [...selected];
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

  const canSend = selected.size > 0 && !send.isPending && !recipientsQuery.isLoading;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-hidden sm:max-w-lg" data-testid="dialog-send-to">
        <DialogHeader>
          <DialogTitle>{t("notifications.sendToTitle")}</DialogTitle>
        </DialogHeader>

        {ticketId === null ? (
          <p className="text-sm text-muted-foreground">{t("notifications.sendToNoTicket")}</p>
        ) : recipientsQuery.isLoading ? (
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t("notifications.loading")}
          </div>
        ) : allRecipients.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("notifications.sendToEmpty")}</p>
        ) : (
          <div className="max-h-[50vh] space-y-4 overflow-y-auto pr-1">
            <p className="text-xs text-muted-foreground">{t("notifications.sendToCoopNote")}</p>
            {notification?.title ? (
              <div className="rounded-md border bg-muted/30 px-3 py-2 text-xs">
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
                <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  {t(GROUP_LABEL_KEYS[group.id])}
                </p>
                <ul className="space-y-2">
                  {group.recipients.map((r) => {
                    const checked = selected.has(r.userId);
                    return (
                      <li key={r.userId}>
                        <label
                          className={cn(
                            "flex cursor-pointer items-start gap-3 rounded-md border px-3 py-2",
                            checked && "border-primary bg-primary/5",
                          )}
                        >
                          <Checkbox
                            checked={checked}
                            onCheckedChange={() => toggle(r.userId)}
                            data-testid={`send-to-recipient-${r.userId}`}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="block text-sm font-medium">{r.displayName}</span>
                            <span className="block text-xs text-muted-foreground">{r.roleLabel}</span>
                          </span>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}

            <div>
              <Label htmlFor="send-to-message">{t("notifications.sendToMessageLabel")}</Label>
              <Textarea
                id="send-to-message"
                value={message}
                onChange={(e) => setMessage(e.target.value.slice(0, 500))}
                placeholder={t("notifications.sendToMessagePlaceholder")}
                className="mt-1.5 min-h-[72px]"
                data-testid="send-to-message"
              />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <button
            type="button"
            className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm"
            onClick={() => onOpenChange(false)}
          >
            {t("common.cancel")}
          </button>
          <button
            type="button"
            disabled={!canSend}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm text-primary-foreground disabled:opacity-50"
            onClick={() => send.mutate()}
            data-testid="send-to-submit"
          >
            {send.isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
            {t("notifications.sendToSubmit", { count: selected.size })}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
