import { useQuery } from "@tanstack/react-query";
import { Clock3, NotebookPen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import type { GateWatchTimeline as Timeline } from "@workspace/gate-booth";
import { useAuth } from "@/hooks/use-auth";
import { changeOverRequest } from "@/lib/change-over-api";

export default function GateWatchTimeline() {
  const { user } = useAuth(), { i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const timeline = useQuery({
    queryKey: ["gate-watch-timeline", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId],
    queryFn: () => changeOverRequest<Timeline>("/watch-timeline"), retry: false, refetchInterval: 30000,
  });
  const sites = timeline.data?.sites ?? [];
  const time = (value: string, timezone?: string) => new Date(value).toLocaleString(es ? "es" : "en-US", { dateStyle: "medium", timeStyle: "short", ...(timezone ? { timeZone: timezone } : {}) });
  const count = (kind: "previous" | "next") => timeline.isPending ? c("Loading…", "Cargando…") : timeline.isError ? c("Unavailable", "No disponible") : sites.filter(site => site[kind]).length;
  const unavailable = timeline.isPending ? <p>{c("Loading watches…", "Cargando guardias…")}</p> : timeline.isError ? <p role="status">{c("Watch history and schedule unavailable.", "Historial y horario de guardias no disponibles.")}</p> : !sites.length ? <p>{c("No gate sites available.", "No hay sitios de acceso disponibles.")}</p> : null;
  return <>
    <details className="gate-panel-disclosure">
      <summary><NotebookPen aria-hidden="true" /><span>{c("Previous watch", "Vigilancia anterior")}</span><small>{count("previous")}</small></summary>
      <div className="gate-panel-detail">{unavailable ?? sites.map(site => {
        const watch = site.previous;
        return <article className="gate-current-watch" key={site.siteId}>
          {watch ? <>
            <div className="gate-current-watch-heading"><strong>{watch.name}</strong></div>
            <p>{site.siteName} · {watch.gateName}</p>
            <p>{c("Ended", "Finalizó")} <time dateTime={watch.endedAt}>{time(watch.endedAt)}</time></p>
            {watch.filedAt && <p>{c("Notes filed", "Notas archivadas")} <time dateTime={watch.filedAt}>{time(watch.filedAt)}</time></p>}
            <p className="whitespace-pre-wrap">{watch.notes?.trim() || c("No saved shift notes for this watch.", "No hay notas de turno guardadas para esta guardia.")}</p>
            {watch.handoffId && <Link className="gate-watch-text-action" href={`/gate/shift-notes?${new URLSearchParams({ siteId: String(site.siteId), stationId: watch.stationId, handoffId: watch.handoffId })}`}>{c("Open shift notes", "Abrir notas del turno")}</Link>}
          </> : <><strong>{site.siteName}</strong><p>{c("No completed watch recorded.", "No hay guardias completadas registradas.")}</p></>}
        </article>;
      })}</div>
    </details>
    <details className="gate-panel-disclosure">
      <summary><Clock3 aria-hidden="true" /><span>{c("Next Watch", "Próxima guardia")}</span><small>{count("next")}</small></summary>
      <div className="gate-panel-detail">{unavailable ?? sites.map(site => {
        const watch = site.next;
        return <article className="gate-current-watch" key={site.siteId}>
          {watch ? <>
            <div className="gate-current-watch-heading"><strong>{watch.people.length ? watch.people.map(person => person.name).join(", ") : c("Unassigned", "Sin asignar")}</strong></div>
            <p>{site.siteName} · {watch.gateName}</p>
            <p><time dateTime={watch.startsAt}>{time(watch.startsAt, watch.timezone)}</time> — <time dateTime={watch.endsAt}>{time(watch.endsAt, watch.timezone)}</time> ({watch.timezone})</p>
          </> : <><strong>{site.siteName}</strong><p>{c("No upcoming watch scheduled.", "No hay próximas guardias programadas.")}</p></>}
        </article>;
      })}</div>
    </details>
  </>;
}
