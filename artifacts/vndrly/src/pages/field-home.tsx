import { TogglePillButton } from "@/components/toggle-pill";
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Plus, ChevronRight, MapPin, Clock, LogOut, HardHat } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import TicketStatusBadge from "@/components/ticket-status-badge";
import headerBg from "@assets/VNDRLY_Header_Blur_4_1776220762025.png";
import vndrlyLogo from "@assets/512_Vndrly_Logo_2_1777147855089.png";
import GreyButton from "@/components/grey-button";
import LanguageToggle from "@/components/language-toggle";

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
  const { logout } = useAuth();
  const { t, i18n } = useTranslation();
  const [, navigate] = useLocation();
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
      <div className="min-h-screen bg-white flex items-center justify-center">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500" />
      </div>
    );
  }

  const vendorLabel = me?.vendorName || t("fieldHome.vendorFallback");

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col relative" data-testid="field-home">
      <div
        className="absolute top-0 left-0 right-0 pointer-events-none z-0"
        style={{
          backgroundImage: `url(${headerBg})`,
          backgroundSize: "cover",
          backgroundPosition: "center top",
          opacity: 0.85,
          height: "240px",
          maskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, black 0%, transparent 100%)",
        }}
      />
      <header className="relative z-10 px-5 pt-24 pb-4 max-w-md mx-auto w-full flex items-center gap-3">
        <img src={vndrlyLogo} alt="VNDRLY Logo" className="w-12 h-12 rounded-lg shrink-0" draggable={false} />
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl font-bold tracking-tight leading-none text-gray-900">VNDRLY</h1>
          <p className="text-sm font-semibold text-gray-700 leading-tight mt-1">{t("fieldHome.portal")}</p>
        </div>
        <TogglePillButton
          onClick={() => { logout().then(() => navigate("/")); }}
          data-testid="button-field-logout"
        >
          <LogOut className="w-4 h-4" />
          {t("fieldHome.logout")}
        </TogglePillButton>
      </header>
      <div className="relative z-10 px-5 pb-3 max-w-md mx-auto w-full flex items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-600 truncate">{vendorLabel}</p>
          <p className="text-sm font-bold text-gray-900 truncate">{me?.firstName} {me?.lastName}</p>
        </div>
        <LanguageToggle variant="light" />
      </div>

      <div className="px-5 pt-5 pb-3 max-w-md mx-auto w-full">
        <h2 className="text-lg font-bold text-gray-900">{t("fieldHome.whatDoing")}</h2>
        <p className="text-xs text-gray-500 mt-0.5">{t("fieldHome.whatDoingSub")}</p>
      </div>

      <div className="px-5 max-w-md mx-auto w-full">
        <TogglePillButton
          color="amber"
          height={72}
          onClick={() => navigate("/field/new-ticket")}
          data-testid="button-new-ticket"
          className="w-full px-4"
        >
          <span className="flex items-center gap-3 w-full">
            <span className="w-10 h-10 rounded-lg bg-white/25 flex items-center justify-center shrink-0">
              <Plus className="w-5 h-5 text-white" />
            </span>
            <span className="flex-1 text-left flex flex-col">
              <span className="text-sm font-bold text-white leading-tight">{t("fieldHome.startNewJob")}</span>
              <span className="text-[11px] text-white/85 leading-tight">{t("fieldHome.startNewJobSub")}</span>
            </span>
            <ChevronRight className="w-5 h-5 text-white/85 shrink-0" />
          </span>
        </TogglePillButton>
      </div>

      <div className="px-5 pt-6 pb-2 flex items-center justify-between max-w-md mx-auto w-full">
        <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">{t("fieldHome.continueExisting")}</h3>
        <span className="text-[11px] text-gray-400">{t("fieldHome.openCount", { count: tickets.length })}</span>
      </div>

      {tickets.length === 0 ? (
        <div className="px-5 max-w-md mx-auto w-full pb-8">
          <div className="rounded-xl border-2 border-dashed border-gray-300 p-6 text-center text-sm text-gray-500">
            {t("fieldHome.emptyJobsPrefix", { vendor: vendorLabel })} <span className="font-semibold text-amber-600">{t("fieldHome.startNewJob")}</span> {t("fieldHome.emptyJobsSuffix")}
          </div>
        </div>
      ) : (
        <div className="px-5 space-y-3 pb-8 max-w-md mx-auto w-full">
          {tickets.map((ticket) => {
            const mine = (ticket as any).fieldEmployeeId === me?.employeeId;
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
                className={`w-full text-left rounded-xl bg-white p-4 border-2 shadow-sm hover:shadow-md transition-shadow ${
                  mine ? "border-amber-400" : "border-gray-300"
                }`}
                data-testid={`button-open-ticket-${ticket.id}`}
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-gray-900 truncate">#{ticket.id}</p>
                      <TicketStatusBadge status={ticket.status} />
                      {mine && (
                        <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-amber-500 text-white">{t("fieldHome.you")}</span>
                      )}
                    </div>
                    <p className="text-xs text-gray-700 mt-0.5 truncate">{ticket.workTypeName || "—"}</p>
                    <div className="flex items-center gap-1 mt-1.5 text-[11px] text-gray-500">
                      <MapPin className="w-3 h-3" />
                      <span className="truncate">{ticket.siteName} · {ticket.partnerName}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-[11px] text-gray-500">
                      <HardHat className="w-3 h-3" />
                      <span className="truncate">{ownerName}</span>
                    </div>
                    <div className="flex items-center gap-1 mt-1 text-[11px] text-gray-400">
                      <Clock className="w-3 h-3" />
                      <span>{t("fieldHome.checkedIn", { when: checkInWhen, elapsed: elapsedStr })}</span>
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-gray-300 mt-1" />
                </div>
              </button>
            );
          })}
        </div>
      )}

      <div className="px-5 pt-4 pb-8 max-w-md mx-auto w-full">
        <button
          type="button"
          onClick={() => navigate("/account/location")}
          className="w-full text-left text-sm text-amber-700 hover:text-amber-800 underline"
          data-testid="link-account-location"
        >
          {t("fieldHome.manageLocation")}
        </button>
      </div>
    </div>
  );
}
