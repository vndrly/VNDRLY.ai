import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowDown, ArrowUp, BellRing } from "lucide-react";
import {
  isNudgeAllowedForStatus,
  nudgeDirectionsForRole,
  type NudgeDirection,
  type TicketNudgeRow,
} from "@workspace/ticket-nudge-ui";
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

export function TicketNudgePanel({ ticketId, ticketStatus, userRole }: Props) {
  const { t } = useTranslation();
  const { toast } = useToast();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState<NudgeDirection | null>(null);
  const [history, setHistory] = useState<TicketNudgeRow[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);

  const directions = useMemo(() => nudgeDirectionsForRole(userRole), [userRole]);
  const visible =
    isNudgeAllowedForStatus(ticketStatus) && (directions.up || directions.down);

  const loadHistory = useCallback(async () => {
    try {
      const r = await fetch(`/api/tickets/${ticketId}/nudges`, {
        credentials: "include",
      });
      if (!r.ok) {
        setHistory([]);
        return;
      }
      const rows = (await r.json()) as TicketNudgeRow[];
      setHistory(Array.isArray(rows) ? rows : []);
    } catch {
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  }, [ticketId]);

  useEffect(() => {
    if (!visible) return;
    void loadHistory();
  }, [visible, loadHistory]);

  const send = async (direction: NudgeDirection) => {
    setBusy(direction);
    try {
      const r = await fetch(`/api/tickets/${ticketId}/nudge`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          direction,
          message: message.trim() || undefined,
        }),
      });
      const body = await r.json().catch(() => ({}));
      if (!r.ok) {
        const err = Object.assign(new Error(body?.message ?? "nudge failed"), {
          status: r.status,
          data: body,
          code: body?.code,
        });
        throw err;
      }
      setMessage("");
      const notifiedCount = body.notifiedCount ?? 0;
      toast({
        title: t("ticketDetail.nudge.sentTitle"),
        description:
          notifiedCount > 0
            ? t("ticketDetail.nudge.sentBody", { count: notifiedCount })
            : t("ticketDetail.nudge.sentBodyShort"),
      });
      await loadHistory();
    } catch (e) {
      toast({
        title: t("ticketDetail.nudge.failedTitle"),
        description: translateApiError(e, t, t("ticketDetail.nudge.failedBody")),
        variant: "destructive",
      });
    } finally {
      setBusy(null);
    }
  };

  if (!visible) return null;

  return (
    <Card data-testid="ticket-nudge-panel">
      <CardHeader className="pb-2">
        <CardTitle className="text-base flex items-center gap-2">
          <BellRing className="w-4 h-4" />
          {t("ticketDetail.nudge.title")}
        </CardTitle>
        <p className="text-sm text-muted-foreground">
          {t("ticketDetail.nudge.subtitle")}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea
          value={message}
          onChange={(e) => setMessage(e.target.value.slice(0, 500))}
          placeholder={t("ticketDetail.nudge.messagePlaceholder")}
          rows={2}
          data-testid="input-nudge-message"
        />
        <div className="flex flex-wrap gap-2">
          {directions.up ? (
            <PngPillButton
              color="blue"
              onClick={() => void send("up")}
              disabled={busy !== null}
              data-testid="button-nudge-up"
            >
              <ArrowUp className="w-4 h-4" />
              {busy === "up"
                ? t("ticketDetail.nudge.sending")
                : t("ticketDetail.nudge.up")}
            </PngPillButton>
          ) : null}
          {directions.down ? (
            <PngPillButton
              color="amber"
              onClick={() => void send("down")}
              disabled={busy !== null}
              data-testid="button-nudge-down"
            >
              <ArrowDown className="w-4 h-4" />
              {busy === "down"
                ? t("ticketDetail.nudge.sending")
                : t("ticketDetail.nudge.down")}
            </PngPillButton>
          ) : null}
        </div>
        {!loadingHistory && history.length > 0 ? (
          <div className="border-t pt-3 space-y-2" data-testid="nudge-history">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
              {t("ticketDetail.nudge.recent")}
            </p>
            {history.slice(0, 5).map((row) => (
              <div
                key={row.id}
                className="text-sm text-muted-foreground flex gap-2"
                data-testid={`nudge-history-${row.id}`}
              >
                <span className="font-medium text-foreground shrink-0">
                  {row.direction === "up"
                    ? t("ticketDetail.nudge.upShort")
                    : t("ticketDetail.nudge.downShort")}
                </span>
                <span>
                  {row.message ||
                    t("ticketDetail.nudge.noMessage", {
                      status: row.ticketStatus.replace(/_/g, " "),
                    })}
                </span>
              </div>
            ))}
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
