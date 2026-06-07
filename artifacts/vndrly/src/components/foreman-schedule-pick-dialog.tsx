import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { MapPin } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog";
import { PngPillButton } from "@/components/png-pill-rollover";
import TicketStatusBadge from "@/components/ticket-status-badge";
import ScheduleTicketDialog from "@/components/schedule-ticket-dialog";
import { useBrand } from "@/hooks/use-brand";
import { translateApiError } from "@/lib/api-error";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

type OpenTicket = {
  id: number;
  status: string;
  siteName: string | null;
  partnerName: string | null;
  workTypeName: string | null;
};

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  vendorId: number;
  onScheduled?: () => void;
};

export default function ForemanSchedulePickDialog({
  open,
  onOpenChange,
  vendorId,
  onScheduled,
}: Props) {
  const { t } = useTranslation();
  const brand = useBrand();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<OpenTicket[]>([]);
  const [scheduleTicketId, setScheduleTicketId] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await fetch(`${BASE}/api/field/open-tickets?vendorWide=1`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      const rows = (await r.json()) as OpenTicket[];
      setTickets(Array.isArray(rows) ? rows : []);
    } catch (e) {
      setError(translateApiError(e, t));
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    if (open) {
      setScheduleTicketId(null);
      void load();
    }
  }, [open, load]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent bare className="max-w-lg flex max-h-[min(85vh,calc(100vh-2rem))] flex-col overflow-hidden p-0">
          <div className="shrink-0 border-b border-border/60 px-6 py-4 pr-12">
            <DialogTitle className="break-words">{t("foremanSchedule.pickTicketTitle")}</DialogTitle>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden pl-6 pr-2 pb-6 pt-4">
            {loading ? (
              <div className="flex justify-center py-10">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[color:var(--brand-primary)]" />
              </div>
            ) : error ? (
              <p className="text-sm text-destructive text-center py-6 break-words">{error}</p>
            ) : tickets.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6 break-words">{t("foremanSchedule.noOpenTickets")}</p>
            ) : (
              <ul className="space-y-3 w-full min-w-0">
                {tickets.map((ticket) => (
                  <li
                    key={ticket.id}
                    className="w-full rounded-xl border bg-card p-4 min-w-0 overflow-hidden box-border"
                    style={{
                      borderColor: `${brand.primary}55`,
                      borderLeftWidth: 4,
                      borderLeftColor: brand.primary,
                    }}
                    data-testid={`open-ticket-schedule-${ticket.id}`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-1 min-w-0">
                      <span className="text-sm font-semibold shrink-0">
                        #{String(ticket.id).padStart(4, "0")}
                      </span>
                      <div className="flex flex-wrap items-center justify-end gap-2 min-w-0 max-w-full">
                        <TicketStatusBadge status={ticket.status} compact className="max-w-[8.5rem]" />
                        <PngPillButton
                          color="brand"
                          height={24}
                          size="xs"
                          onClick={() => setScheduleTicketId(ticket.id)}
                          data-testid={`button-schedule-now-${ticket.id}`}
                          className="shrink-0 max-w-[9rem] [&_span]:whitespace-normal [&_span]:leading-tight [&_span]:text-[10px]"
                        >
                          {t("foremanSchedule.scheduleNow")}
                        </PngPillButton>
                      </div>
                    </div>
                    <p className="font-semibold text-sm mb-1 break-words leading-snug">
                      {ticket.workTypeName || t("mySchedule.untitledJob")}
                    </p>
                    <div className="flex items-start gap-1.5 text-xs text-muted-foreground min-w-0">
                      <MapPin className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                      <span className="break-words leading-snug min-w-0">
                        {[ticket.partnerName, ticket.siteName].filter(Boolean).join(" — ") || "—"}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {scheduleTicketId != null ? (
        <ScheduleTicketDialog
          open
          onOpenChange={(next) => {
            if (!next) setScheduleTicketId(null);
          }}
          ticketId={scheduleTicketId}
          vendorId={vendorId}
          foremanMode
          onSaved={() => {
            setScheduleTicketId(null);
            onOpenChange(false);
            onScheduled?.();
          }}
        />
      ) : null}
    </>
  );
}
