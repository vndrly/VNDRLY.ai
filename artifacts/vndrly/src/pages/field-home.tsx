import { PngPillButton } from "@/components/png-pill-rollover";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Plus, ChevronRight, MapPin, Clock, HardHat } from "lucide-react";
import TicketStatusBadge from "@/components/ticket-status-badge";
import { useBrand } from "@/hooks/use-brand";
import { usePortalBase } from "@/lib/portal-base";
import ContentPaneBackLink from "@/components/content-pane-back-link";
import { FIELD_OPS_PAGE_CLASS } from "@/lib/field-ops-content-pane";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface FieldMe {
  employeeId: number;
  firstName: string;
  lastName: string;
  email: string;
  vendorId: number;
  vendorName: string;
}

interface OpenTicket {
  id: number;
  status: string;
  checkInTime: string | null;
  siteName: string | null;
  partnerName: string | null;
  workTypeName: string | null;
  fieldEmployeeName?: string | null;
  createdAt: string;
}

function elapsed(start: string | null, notCheckedInLabel: string) {
  if (!start) return notCheckedInLabel;
  const ms = Date.now() - new Date(start).getTime();
  const totalMin = Math.floor(ms / 60000);
  const days = Math.floor(totalMin / (60 * 24));
  const hrs = Math.floor((totalMin % (60 * 24)) / 60);
  const mins = totalMin % 60;
  if (days > 0) return `${days}d ${hrs}h`;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  return `${mins}m`;
}

function formatCheckIn(iso: string | null, locale: string, todayLabel: string, yesterdayLabel: string, notYetLabel: string) {
  if (!iso) return notYetLabel;
  const d = new Date(iso);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const time = d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" });
  if (sameDay) return `${todayLabel} · ${time}`;
  if (d.toDateString() === yesterday.toDateString()) return `${yesterdayLabel} · ${time}`;
  return d.toLocaleDateString(locale, { month: "short", day: "numeric" }) + " · " + time;
}

export default function FieldHome() {
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const portalBase = usePortalBase();
  const brand = useBrand();
  const [me, setMe] = useState<FieldMe | null>(null);
  const [tickets, setTickets] = useState<OpenTicket[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/field/me`, { credentials: "include" }).then(r => r.ok ? r.json() : null),
      fetch(`${BASE}/api/field/open-tickets`, { credentials: "include" }).then(r => r.ok ? r.json() : []),
    ]).then(([m, t]) => {
      setMe(m); setTickets(t || []); setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    );
  }

  const vendorLabel = me?.vendorName || t("fieldHome.vendorFallback");

  return (
    <div className={FIELD_OPS_PAGE_CLASS} data-testid="field-home">
      <div className="flex items-center gap-3">
        <ContentPaneBackLink href={portalBase} />
        <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">{t("fieldHome.whatDoing")}</h1>
        <p className="text-muted-foreground text-sm mt-1">{t("fieldHome.whatDoingSub")}</p>
        </div>
      </div>

      <div className="pb-4">
        <PngPillButton
          color="blue"
          onClick={() => navigate(`${portalBase}/new-ticket`)}
          data-testid="button-new-ticket"
          className="w-full"
        >
          <Plus className="w-4 h-4" />
          {t("fieldHome.startNewJob")}
        </PngPillButton>
        <p className="text-[11px] text-muted-foreground mt-1.5">{t("fieldHome.startNewJobSub")}</p>
      </div>

      <div className="pb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{t("fieldHome.continueExisting")}</h3>
        <span className="text-[11px] text-muted-foreground">{t("fieldHome.openCount", { count: tickets.length })}</span>
      </div>

      {tickets.length === 0 ? (
        <div className="pb-8">
          <div className="rounded-xl border-2 border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
            {t("fieldHome.emptyJobsPrefix", { vendor: vendorLabel })} <span className="font-semibold text-amber-600">{t("fieldHome.startNewJob")}</span> {t("fieldHome.emptyJobsSuffix")}
          </div>
        </div>
      ) : (
        <div className="space-y-3 pb-8">
          {tickets.map((ticket) => {
            const ownerName = (ticket as any).fieldEmployeeFirstName
              ? `${(ticket as any).fieldEmployeeFirstName} ${(ticket as any).fieldEmployeeLastName ?? ""}`.trim()
              : t("fieldHome.unassigned");
            const checkInWhen = formatCheckIn(
              ticket.checkInTime,
              i18n.language,
              t("fieldHome.today"),
              t("fieldHome.yesterday"),
              t("fieldHome.notCheckedInYet"),
            );
            const elapsedStr = elapsed(ticket.checkInTime, t("fieldHome.notCheckedIn"));
            return (
              <button
                key={ticket.id}
                onClick={() => navigate(`/tickets/${ticket.id}`)}
                className="w-full text-left rounded-xl bg-card p-4 border transition-shadow"
                style={{
                  borderColor: `${brand.primary}55`,
                  borderLeftWidth: 4,
                  borderLeftColor: brand.primary,
                }}
                data-testid={`button-open-ticket-${ticket.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-foreground truncate">#{ticket.id}</p>
                      <TicketStatusBadge status={ticket.status} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{ticket.workTypeName || "—"}</p>
                    <div className="flex items-center gap-1 mt-1.5 text-[11px] text-muted-foreground">
                      <MapPin className="w-3 h-3" />
                      <span className="truncate">{ticket.siteName} · {ticket.partnerName}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground">
                      <HardHat className="w-3 h-3" />
                      <span className="truncate">{ownerName}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-[11px] text-muted-foreground/80">
                      <Clock className="w-3 h-3" />
                      <span>{t("fieldHome.checkedIn", { when: checkInWhen, elapsed: elapsedStr })}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-muted-foreground/50 mt-1" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="pt-4 pb-8">
        <button
          type="button"
          onClick={() => navigate("/account/location")}
          className="w-full text-left text-sm text-muted-foreground hover:text-[color:var(--brand-primary)] underline transition-colors"
          data-testid="link-account-location"
        >
          {t("fieldHome.manageLocation")}
        </button>
      </div>
    </div>
  );
}
