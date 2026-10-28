import { useQuery } from "@tanstack/react-query";
import { Radar } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { GateWatchTimeline } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest } from "@/lib/change-over-api";

export default function GateWatchRadar() {
  const { user } = useAuth(), { i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const timeline = useQuery({
    queryKey: ["gate-watch-timeline", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId],
    queryFn: () => changeOverRequest<GateWatchTimeline>("/watch-timeline"),
    retry: false,
    refetchInterval: 30000,
  });
  const watches = timeline.data?.radar ?? [];
  const time = (value: string, timezone: string) => new Date(value).toLocaleString(es ? "es" : "en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: timezone,
  });
  const count = timeline.isPending ? c("Loading…", "Cargando…") : timeline.isError ? c("Unavailable", "No disponible") : watches.length;

  return <details className="gate-panel-disclosure gate-watch-radar">
    <summary><Radar aria-hidden="true" /><span>{c("Watch Radar", "Radar de vigilancia")}</span><small>{count}</small></summary>
    <div className="gate-panel-detail">
      {timeline.isPending ? <p>{c("Checking the next 24 hours…", "Revisando las próximas 24 horas…")}</p>
        : timeline.isError ? <p role="status">{c("Watch Radar is unavailable.", "El radar de vigilancia no está disponible.")}</p>
        : watches.length ? watches.map(watch => <article className="gate-current-watch" key={watch.shiftId}>
          <div className="gate-current-watch-heading"><strong>{watch.title}</strong></div>
          <p>{watch.siteName} · {watch.gateName}</p>
          <p>{c("Starts", "Comienza")} <time dateTime={watch.startsAt}>{time(watch.startsAt, watch.timezone)}</time></p>
          <p>{c("No one is assigned.", "No hay nadie asignado.")}</p>
        </article>)
        : <p>{c("No unassigned watches start within the next 24 hours.", "No hay guardias sin asignar que comiencen en las próximas 24 horas.")}</p>}
    </div>
  </details>;
}
