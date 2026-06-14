import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Flag, FlagOff } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";

type Props = {
  ticketId: number;
  ticketStatus: string;
  userRole: string | undefined;
};

const TERMINAL = new Set(["cancelled", "denied", "completed", "funds_dispersed"]);

export function TicketFlagPanel({ ticketId, ticketStatus, userRole }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [reason, setReason] = useState("");
  const [flagged, setFlagged] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const visible =
    !!userRole &&
    !TERMINAL.has(ticketStatus) &&
    ["admin", "partner", "vendor", "field_employee"].includes(userRole);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/tickets/${ticketId}/flag`, { credentials: "include" });
      if (!r.ok) {
        setFlagged(false);
        return;
      }
      const body = (await r.json()) as { flagged?: boolean; reason?: string | null };
      setFlagged(!!body.flagged);
      if (body.reason) setReason(body.reason);
    } catch {
      setFlagged(false);
    } finally {
      setLoading(false);
    }
  }, [ticketId]);

  useEffect(() => {
    if (!visible) return;
    void load();
  }, [visible, load]);

  const flag = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/tickets/${ticketId}/flag`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: reason.trim() || undefined }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(body?.message ?? "flag failed"), { data: body });
      setFlagged(true);
      toast({ title: t("ticketDetail.flag.flaggedTitle"), description: t("ticketDetail.flag.flaggedBody") });
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: translateApiError(e, t),
      });
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    setBusy(true);
    try {
      const r = await fetch(`/api/tickets/${ticketId}/flag`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok && r.status !== 204) {
        const body = await r.json().catch(() => ({}));
        throw Object.assign(new Error(body?.message ?? "clear failed"), { data: body });
      }
      setFlagged(false);
      setReason("");
      toast({ title: t("ticketDetail.flag.clearedTitle") });
    } catch (e) {
      toast({
        variant: "destructive",
        title: t("common.error"),
        description: translateApiError(e, t),
      });
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  return (
    <Card data-testid="ticket-flag-panel">
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <Flag className="h-4 w-4" />
          {t("ticketDetail.flag.title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{t("ticketDetail.flag.help")}</p>
        {loading ? (
          <p className="text-sm text-muted-foreground">{t("common.loading")}</p>
        ) : flagged ? (
          <>
            {reason ? (
              <p className="text-sm">
                <span className="font-medium">{t("ticketDetail.flag.reasonLabel")}: </span>
                {reason}
              </p>
            ) : null}
            <PngPillButton color="amber" onClick={clear} disabled={busy}>
              <span className="inline-flex items-center gap-1.5">
                <FlagOff className="h-3.5 w-3.5" />
                {t("ticketDetail.flag.clear")}
              </span>
            </PngPillButton>
          </>
        ) : (
          <>
            <Textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={t("ticketDetail.flag.reasonPlaceholder")}
              rows={2}
              maxLength={500}
            />
            <PngPillButton color="amber" onClick={flag} disabled={busy}>
              {t("ticketDetail.flag.submit")}
            </PngPillButton>
          </>
        )}
      </CardContent>
    </Card>
  );
}
