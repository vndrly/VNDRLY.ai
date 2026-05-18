import { useEffect, useState, useCallback } from "react";
import { useLocation } from "wouter";
import { useTranslation } from "react-i18next";
import { Clock, MapPin, UserCheck, Users, Navigation, Check, X, ChevronRight } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import TogglePill, { TogglePillButton } from "@/components/toggle-pill";

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

export default function FieldSchedule() {
  const { t } = useTranslation();
  const [, navigate] = useLocation();
  const { toast } = useToast();
  const [tickets, setTickets] = useState<ScheduledTicket[]>([]);
  const [loading, setLoading] = useState(true);

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

  return (
    <div className="px-4 pt-6 pb-6 max-w-2xl mx-auto w-full" data-testid="field-schedule">
      <h1 className="text-2xl font-bold mb-1">{t("mySchedule.title")}</h1>
      <p className="text-sm text-muted-foreground mb-5">{t("mySchedule.subtitle")}</p>

      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-[color:var(--brand-primary)]" />
        </div>
      ) : tickets.length === 0 ? (
        <div className="rounded-xl border border-border bg-card p-8 text-center text-sm text-muted-foreground">
          {t("mySchedule.empty")}
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
                className="rounded-xl border border-border bg-card text-card-foreground p-4 shadow-sm"
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
                      <TogglePill color={ackPillColor} className="text-[10px] px-2 py-0.5">
                        {ackLabel}
                      </TogglePill>
                    ) : ackIsRest ? (
                      <TogglePill rest className="text-[10px] px-2 py-0.5">
                        {ackLabel}
                      </TogglePill>
                    ) : (
                      <TogglePill rest className="text-[10px] px-2 py-0.5">
                        {item.status}
                      </TogglePill>
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
                  <div className="flex gap-2 mt-3">
                    {ack === "pending" ? (
                      <TogglePillButton
                        color="red"
                        onClick={() => onDecline(item.id)}
                        className="flex-1 h-10 text-sm"
                        data-testid={`button-decline-${item.id}`}
                      >
                        <X className="w-4 h-4 mr-1.5" />
                        {t("mySchedule.decline")}
                      </TogglePillButton>
                    ) : null}
                    <TogglePillButton
                      color="green"
                      onClick={() => void sendAck(item.id, "confirmed")}
                      className="flex-1 h-10 text-sm"
                      data-testid={`button-confirm-${item.id}`}
                    >
                      <Check className="w-4 h-4 mr-1.5" />
                      {t("mySchedule.confirm")}
                    </TogglePillButton>
                  </div>
                ) : null}

                {item.isForeman ? (
                  <TogglePillButton
                    color="brand"
                    onClick={() => navigate(`/tickets/${item.id}`)}
                    className="w-full h-10 text-sm mt-2"
                    data-testid={`button-foreman-view-${item.id}`}
                  >
                    <Users className="w-4 h-4 mr-1.5" />
                    {t("mySchedule.foremanView")}
                    <ChevronRight className="w-4 h-4 ml-auto" />
                  </TogglePillButton>
                ) : null}

                {canDirections ? (
                  <TogglePillButton
                    color="blue"
                    onClick={() => openInMaps(item.siteLatitude!, item.siteLongitude!, item.siteName ?? undefined)}
                    className="w-full h-10 text-sm mt-2"
                    data-testid={`button-directions-${item.id}`}
                  >
                    <Navigation className="w-4 h-4 mr-1.5" />
                    {t("mySchedule.getDirections")}
                  </TogglePillButton>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
