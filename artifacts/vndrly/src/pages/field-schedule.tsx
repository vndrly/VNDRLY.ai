import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Clock, MapPin, UserCheck, Users, Navigation, Check, X, ChevronRight, CalendarClock, Bell } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { translateApiError } from "@/lib/api-error";
import PngPill, { PngPillButton } from "@/components/png-pill-rollover";
import ScheduleTicketDialog from "@/components/schedule-ticket-dialog";
import ForemanSchedulePickDialog from "@/components/foreman-schedule-pick-dialog";
import { usePortalBase } from "@/lib/portal-base";
import { useAuth } from "@/hooks/use-auth";
import { useTicketNudgeFlash } from "@/hooks/use-ticket-nudge-flash";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface ScheduledCrewMember {
  name: string | null;
  isMe: boolean;
}

interface ScheduledTicket {
  id: number;
  status: string;
  workTypeName: string | null;
  scheduledStartAt: string | null;
  scheduledDurationMinutes: number | null;
  partnerName: string | null;
  siteName: string | null;
  siteAddress: string | null;
  siteLatitude: number | null;
  siteLongitude: number | null;
  foremanName: string | null;
  isForeman: boolean;
  myAckStatus: "pending" | "confirmed" | "declined" | null;
  crew: ScheduledCrewMember[];
  updatedAt: string;
}

interface UpcomingScheduleResponse {
  tickets: ScheduledTicket[];
}

function formatWhen(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function openInMaps(lat: number, lng: number, label?: string) {
  const q = encodeURIComponent(label ?? `${lat},${lng}`);
  const ua = navigator.userAgent;
  const isApple = /iPhone|iPad|iPod|Macintosh/i.test(ua);
  const url = isApple
    ? `https://maps.apple.com/?ll=${lat},${lng}&q=${q}`
    : `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
  window.open(url, "_blank", "noopener,noreferrer");
}

/** Compact schedule-card actions — fit content; label centered in pill. */
const scheduleBtnProps = { height: 24 as const, size: "xs" as const, className: "shrink-0" };

export default function FieldSchedule() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { nudgeFlashingTicketIds } = useTicketNudgeFlash({ enabled: !!user });
  const [, navigate] = useLocation();
  const portalBase = usePortalBase();
  const isForemanPortal = portalBase === "/foreman";
  const { toast } = useToast();
  const [tickets, setTickets] = useState<ScheduledTicket[]>([]);
  const [loading, setLoading] = useState(true);
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [scheduleTicketId, setScheduleTicketId] = useState<number | null>(null);
  const [schedulePickOpen, setSchedulePickOpen] = useState(false);
  const [resendingTicketId, setResendingTicketId] = useState<number | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}/api/me/upcoming-schedule?days=14`, { credentials: "include" });
      if (!r.ok) throw new Error(String(r.status));
      const json = (await r.json()) as UpcomingScheduleResponse;
      setTickets(json?.tickets ?? []);
    } catch {
      setTickets([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!isForemanPortal) return;
    fetch(`${BASE}/api/field/me`, { credentials: "include" })
      .then((r) => (r.ok ? r.json() : null))
      .then((me) => setVendorId(typeof me?.vendorId === "number" ? me.vendorId : null))
      .catch(() => setVendorId(null));
  }, [isForemanPortal]);

  async function sendAck(ticketId: number, status: "confirmed" | "declined") {
    try {
      const r = await fetch(`${BASE}/api/tickets/${ticketId}/crew/ack`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status }),
      });
      if (!r.ok) throw new Error(String(r.status));
      setTickets((prev) => prev.map((tk) => (tk.id === ticketId ? { ...tk, myAckStatus: status } : tk)));
    } catch {
      toast({
        title: t("mySchedule.ackErrorTitle"),
        description: t("common.tryAgain"),
        variant: "destructive",
      });
    }
  }

  function onDecline(ticketId: number) {
    if (window.confirm(t("mySchedule.declineBody"))) void sendAck(ticketId, "declined");
  }

  async function resendCrewNotifications(ticketId: number) {
    setResendingTicketId(ticketId);
    try {
      const r = await fetch(`${BASE}/api/tickets/${ticketId}/schedule/resend-notifications`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        toast({
          title: t("scheduleTicket.resendFailed"),
          description: translateApiError(j, t),
          variant: "destructive",
        });
        return;
      }
      const parts = [t("scheduleTicket.resendSuccess", { count: j.notified ?? 0 })];
      if (j.skippedNoLogin > 0) {
        parts.push(t("scheduleTicket.resendSkippedNoLogin", { count: j.skippedNoLogin }));
      }
      toast({ title: t("scheduleTicket.resendTitle"), description: parts.join(" ") });
    } catch (e) {
      toast({
        title: t("scheduleTicket.resendFailed"),
        description: translateApiError(e, t),
        variant: "destructive",
      });
    } finally {
      setResendingTicketId(null);
    }
  }

  return (
    <div className="px-4 pt-6 pb-6 max-w-2xl mx-auto w-full" data-testid="field-schedule">
      <h1 className="text-2xl font-bold mb-1">
        {isForemanPortal ? t("foremanSchedule.scheduleTicket") : t("mySchedule.title")}
      </h1>
      <p className="text-sm text-muted-foreground mb-5">{t("mySchedule.subtitle")}</p>

      {isForemanPortal && vendorId ? (
        <PngPillButton
          color="brand"
          {...scheduleBtnProps}
          onClick={() => setSchedulePickOpen(true)}
          className={`${scheduleBtnProps.className} mb-5`}
          data-testid="button-foreman-schedule-ticket"
        >
          <CalendarClock className="w-3 h-3" />
          {t("foremanSchedule.scheduleTicket")}
        </PngPillButton>
      ) : null}

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[color:var(--brand-primary)]" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {isForemanPortal ? t("foremanSchedule.emptyForeman") : t("mySchedule.empty")}
        </div>
      ) : (
        <ul className="space-y-3">
          {tickets.map((item) => {
            const crewNames = item.crew.filter((c) => !c.isMe).map((c) => c.name).filter(Boolean) as string[];
            const ack = item.myAckStatus;
            const ackPillColor: "green" | "red" | null =
              ack === "confirmed" ? "green" : ack === "declined" ? "red" : null;
            const ackIsRest = ack === "pending";
            const ackLabel =
              ack === "confirmed"
                ? t("mySchedule.ackConfirmed")
                : ack === "declined"
                  ? t("mySchedule.ackDeclined")
                  : t("mySchedule.ackPending");
            const canDirections = item.siteLatitude != null && item.siteLongitude != null;
            return (
              <li
                key={item.id}
                className={`rounded-xl border border-border bg-card text-card-foreground p-4 shadow-sm ${nudgeFlashingTicketIds.has(item.id) ? "nudge-flash" : ""}`}
                data-testid={`schedule-card-${item.id}`}
              >
                <button
                  type="button"
                  onClick={() => navigate(`/tickets/${item.id}`)}
                  className="w-full text-left"
                  data-testid={`schedule-open-${item.id}`}
                >
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-sm font-semibold">#{String(item.id).padStart(4, "0")}</span>
                    {ackPillColor ? (
                      <PngPill color={ackPillColor} className="text-[10px] px-2 py-0.5">
                        {ackLabel}
                      </PngPill>
                    ) : ackIsRest ? (
                      <PngPill rest className="text-[10px] px-2 py-0.5">
                        {ackLabel}
                      </PngPill>
                    ) : (
                      <PngPill rest className="text-[10px] px-2 py-0.5">
                        {item.status}
                      </PngPill>
                    )}
                  </div>
                  <h3 className="font-semibold text-base mb-2">{item.workTypeName || t("mySchedule.untitledJob")}</h3>
                  <div className="flex items-start gap-2 text-sm text-muted-foreground">
                    <Clock className="w-4 h-4 mt-0.5 shrink-0" />
                    <span>
                      {formatWhen(item.scheduledStartAt)}
                      {item.scheduledDurationMinutes ? ` · ${item.scheduledDurationMinutes}m` : ""}
                    </span>
                  </div>
                  <div className="flex items-start gap-2 text-sm text-muted-foreground mt-1">
                    <MapPin className="w-4 h-4 mt-0.5 shrink-0" />
                    <span className="truncate">
                      {[item.partnerName, item.siteName].filter(Boolean).join(" — ") || "—"}
                      {item.siteAddress ? ` · ${item.siteAddress}` : ""}
                    </span>
                  </div>
                  {item.foremanName ? (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground mt-1">
                      <UserCheck className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{t("mySchedule.foreman", { name: item.foremanName })}</span>
                    </div>
                  ) : null}
                  {crewNames.length > 0 ? (
                    <div className="flex items-start gap-2 text-sm text-muted-foreground mt-1">
                      <Users className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>{t("mySchedule.crewmates", { names: crewNames.join(", ") })}</span>
                    </div>
                  ) : null}
                </button>

                {ack && ack !== "confirmed" ? (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {ack === "pending" ? (
                      <PngPillButton
                        color="red"
                        {...scheduleBtnProps}
                        onClick={() => onDecline(item.id)}
                        data-testid={`button-decline-${item.id}`}
                      >
                        <X className="w-3 h-3" />
                        {t("mySchedule.decline")}
                      </PngPillButton>
                    ) : null}
                    <PngPillButton
                      color="green"
                      {...scheduleBtnProps}
                      onClick={() => void sendAck(item.id, "confirmed")}
                      data-testid={`button-confirm-${item.id}`}
                    >
                      <Check className="w-3 h-3" />
                      {t("mySchedule.confirm")}
                    </PngPillButton>
                  </div>
                ) : null}

                {item.isForeman ? (
                  <div className="flex flex-wrap items-center gap-2 mt-3">
                    {isForemanPortal && vendorId ? (
                      <PngPillButton
                        color={item.scheduledStartAt ? "green" : "brand"}
                        {...scheduleBtnProps}
                        onClick={() => setScheduleTicketId(item.id)}
                        data-testid={`button-schedule-${item.id}`}
                      >
                        <CalendarClock className="w-3 h-3" />
                        {item.scheduledStartAt ? t("scheduleTicket.scheduled") : t("scheduleTicket.button")}
                      </PngPillButton>
                    ) : null}
                    {isForemanPortal && item.scheduledStartAt ? (
                      <PngPillButton
                        color="brand"
                        {...scheduleBtnProps}
                        onClick={() => void resendCrewNotifications(item.id)}
                        disabled={resendingTicketId === item.id}
                        data-testid={`button-resend-crew-${item.id}`}
                      >
                        <Bell className="w-3 h-3" />
                        {resendingTicketId === item.id
                          ? t("scheduleTicket.resendingNotifications")
                          : t("scheduleTicket.resendCrewNotifications")}
                      </PngPillButton>
                    ) : null}
                    <PngPillButton
                      color="brand"
                      {...scheduleBtnProps}
                      onClick={() => navigate(`/tickets/${item.id}`)}
                      data-testid={`button-foreman-view-${item.id}`}
                    >
                      <Users className="w-3 h-3" />
                      {t("mySchedule.foremanView")}
                      <ChevronRight className="w-3 h-3" />
                    </PngPillButton>
                  </div>
                ) : null}

                {canDirections ? (
                  <div className="mt-2">
                    <PngPillButton
                      color="brand"
                      {...scheduleBtnProps}
                      onClick={() => openInMaps(item.siteLatitude!, item.siteLongitude!, item.siteName ?? undefined)}
                      data-testid={`button-directions-${item.id}`}
                    >
                      <Navigation className="w-3 h-3" />
                      {t("mySchedule.getDirections")}
                    </PngPillButton>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      {scheduleTicketId != null && vendorId != null ? (
        <ScheduleTicketDialog
          open={scheduleTicketId != null}
          onOpenChange={(open) => {
            if (!open) {
              setScheduleTicketId(null);
              void load();
            }
          }}
          ticketId={scheduleTicketId}
          vendorId={vendorId}
          foremanMode={isForemanPortal}
        />
      ) : null}
      {isForemanPortal && vendorId != null ? (
        <ForemanSchedulePickDialog
          open={schedulePickOpen}
          onOpenChange={setSchedulePickOpen}
          vendorId={vendorId}
          onScheduled={() => void load()}
        />
      ) : null}
    </div>
  );
}
