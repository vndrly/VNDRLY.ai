import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { ChevronRight, MapPin, Clock, HardHat } from "lucide-react";
import { cn } from "@/lib/utils";
import { PillColorLayer, PillGlossOverlay } from "@/components/png-pill-chrome";
import {
  PILL_HEIGHT_CLASS,
  PILL_HEIGHT_PX,
  PILL_LABEL_CLASS,
  PILL_MIN_HEIGHT_CLASS,
  PILL_TEXT_SHADOW,
  PILL_WRAPPER_CLASS,
} from "@/lib/pill-doctrine";
import { useAuth } from "@/hooks/use-auth";
import { useBrand } from "@/hooks/use-brand";
import TicketStatusBadge from "@/components/ticket-status-badge";
import ForemanQuickActions from "@/components/foreman-quick-actions";
import ForemanSchedulePickDialog from "@/components/foreman-schedule-pick-dialog";
import { usePortalBase } from "@/lib/portal-base";
import { ticketLifecyclePills } from "@/lib/ticket-status-palette";

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
  fieldEmployeeId?: number | null;
  foremanUserId?: number | null;
  fieldEmployeeFirstName?: string | null;
  fieldEmployeeLastName?: string | null;
  crewNames?: string[];
  createdAt: string;
  scheduledStartAt?: string | null;
}

async function fetchOpenTickets(): Promise<OpenTicket[]> {
  const r = await fetch(`${BASE}/api/field/open-tickets?vendorWide=1`, { credentials: "include" });
  return r.ok ? await r.json() : [];
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

export default function ForemanHome() {
  const { user } = useAuth();
  const brand = useBrand();
  const portalBase = usePortalBase();
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
  const [me, setMe] = useState<FieldMe | null>(null);
  const [tickets, setTickets] = useState<OpenTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [unreadAlerts, setUnreadAlerts] = useState(0);
  const [pendingSchedule, setPendingSchedule] = useState(0);
  const [schedulePickOpen, setSchedulePickOpen] = useState(false);

  const loadTickets = useCallback(async () => {
    setTickets(await fetchOpenTickets());
  }, []);

  useEffect(() => {
    Promise.all([
      fetch(`${BASE}/api/field/me`, { credentials: "include" }).then((r) => (r.ok ? r.json() : null)),
      fetchOpenTickets(),
      fetch(`${BASE}/api/notifications/unread-count`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { count: 0 })),
      fetch(`${BASE}/api/me/upcoming-schedule?days=14`, { credentials: "include" }).then((r) => (r.ok ? r.json() : { tickets: [] })),
    ]).then(([m, tkts, unread, schedule]) => {
      setMe(m);
      setTickets(tkts || []);
      setUnreadAlerts(typeof unread?.count === "number" ? unread.count : 0);
      const pending = (schedule?.tickets ?? []).filter((tk: { myAckStatus?: string }) => tk.myAckStatus === "pending").length;
      setPendingSchedule(pending);
      setLoading(false);
    });
  }, []);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    );
  }

  const vendorLabel = me?.vendorName || t("foremanHome.vendorFallback");

  return (
    <div className="p-6 max-w-md mx-auto w-full" data-testid="foreman-home">
      <div className="pb-3">
        <h2 className="text-lg font-bold text-gray-900">{t("foremanHome.whatDoing")}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{t("foremanHome.whatDoingSub")}</p>
      </div>

      <ForemanQuickActions
        portalBase={portalBase}
        unreadAlerts={unreadAlerts}
        pendingSchedule={pendingSchedule}
        onSchedulePress={() => setSchedulePickOpen(true)}
      />

      {me?.vendorId ? (
        <ForemanSchedulePickDialog
          open={schedulePickOpen}
          onOpenChange={setSchedulePickOpen}
          vendorId={me.vendorId}
          onScheduled={() => void loadTickets()}
        />
      ) : null}

      <div className="pb-2 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{t("foremanHome.continueExisting")}</h3>
        <span className="text-[11px] text-gray-400">{t("foremanHome.openCount", { count: tickets.length })}</span>
      </div>

      {tickets.length === 0 ? (
        <div className="pb-8">
          <div className="rounded-xl border-2 border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            {t("foremanHome.emptyJobsPrefix", { vendor: vendorLabel })}{" "}
            <span className="font-semibold text-amber-600">{t("foremanHome.startNewJob")}</span>{" "}
            {t("foremanHome.emptyJobsSuffix")}
          </div>
        </div>
      ) : (
        <div className="space-y-3 pb-8">
          {tickets.map((ticket) => {
            const mine = ticket.fieldEmployeeId === me?.employeeId;
            const leading = ticket.foremanUserId === user?.userId;
            const ownerName = ticket.fieldEmployeeFirstName
              ? `${ticket.fieldEmployeeFirstName} ${ticket.fieldEmployeeLastName ?? ""}`.trim()
              : t("foremanHome.unassigned");
            const crewLine =
              ticket.crewNames && ticket.crewNames.length > 0
                ? ticket.crewNames.join(", ")
                : ownerName;
            const checkInWhen = formatCheckIn(
              ticket.checkInTime,
              i18n.language,
              t("foremanHome.today"),
              t("foremanHome.yesterday"),
              t("foremanHome.notCheckedInYet"),
            );
            const elapsedStr = elapsed(ticket.checkInTime, t("foremanHome.notCheckedIn"));
            return (
              <button
                key={ticket.id}
                onClick={() => navigate(`/tickets/${ticket.id}`)}
                className="w-full text-left rounded-xl bg-card p-4 border shadow-sm hover:shadow-md transition-shadow"
                style={{
                  borderColor: `${brand.primary}55`,
                  borderLeftWidth: 4,
                  borderLeftColor: leading ? brand.primary : mine ? brand.primary : `${brand.primary}88`,
                }}
                data-testid={`button-foreman-open-ticket-${ticket.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-bold text-gray-900 truncate">#{ticket.id}</p>
                      <TicketStatusBadge status={ticket.status} compact />
                      {ticket.scheduledStartAt ? (
                        <span
                          className={cn(
                            PILL_WRAPPER_CLASS,
                            "pointer-events-none",
                            PILL_HEIGHT_CLASS,
                            PILL_MIN_HEIGHT_CLASS,
                            "min-w-0 max-w-full",
                          )}
                          style={{ height: PILL_HEIGHT_PX }}
                          data-testid={`indicator-job-scheduled-${ticket.id}`}
                        >
                          <PillColorLayer src={ticketLifecyclePills.green.src} />
                          <PillGlossOverlay />
                          <span
                            className={cn(
                              PILL_LABEL_CLASS,
                              "leading-tight text-center whitespace-normal text-white",
                            )}
                            style={{ textShadow: PILL_TEXT_SHADOW }}
                          >
                            {t("ticketDetail.jobIsScheduled")}
                          </span>
                        </span>
                      ) : null}
                      {leading && (
                        <span className="inline-flex items-center h-[23px] text-[9px] font-normal uppercase tracking-wider px-3 rounded bg-violet-600 text-white">{t("foremanHome.leading")}</span>
                      )}
                      {mine && (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500 text-white">{t("foremanHome.you")}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-700 mt-0.5 truncate">{ticket.workTypeName || "—"}</p>
                    <div className="flex items-center gap-1 mt-1.5 text-[11px] text-gray-500">
                      <MapPin className="w-3 h-3" />
                      <span className="truncate">{ticket.siteName} · {ticket.partnerName}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-[11px] text-gray-500">
                      <HardHat className="w-3 h-3 shrink-0" />
                      <span className="line-clamp-2">{crewLine}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-[11px] text-gray-400">
                      <Clock className="w-3 h-3" />
                      <span>{t("foremanHome.checkedIn", { when: checkInWhen, elapsed: elapsedStr })}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 mt-1" />
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
          className="w-full text-left text-sm text-amber-700 hover:text-amber-800 underline"
          data-testid="link-foreman-account-location"
        >
          {t("foremanHome.manageLocation")}
        </button>
      </div>
    </div>
  );
}
