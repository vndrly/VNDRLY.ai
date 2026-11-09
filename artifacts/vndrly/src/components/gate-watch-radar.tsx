import { Radar } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGateStaffingAlerts } from "@/hooks/use-gate-staffing-alerts";
import { GateStaffingAlertCard } from "./gate-staffing-alerts";

export default function GateWatchRadar() {
  const { i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const staffing = useGateStaffingAlerts();
  const alerts = (staffing.data?.alerts ?? []).filter(alert => alert.status !== "resolved");
  const count = staffing.isPending ? c("Loading…", "Cargando…") : staffing.isError ? c("Unavailable", "No disponible") : alerts.length;

  return <details className="gate-panel-disclosure gate-watch-radar">
    <summary><Radar aria-hidden="true" /><span>{c("Watch Radar", "Radar de vigilancia")}</span><small>{count}</small></summary>
    <div className="gate-panel-detail space-y-3">
      {staffing.isPending && <p role="status">{c("Checking current gaps and the next 24 hours…", "Revisando faltas actuales y las próximas 24 horas…")}</p>}
      {staffing.isError && <p role="status">{c("Watch Radar is unavailable.", "El radar de vigilancia no está disponible.")} <button type="button" className="underline" disabled={staffing.isFetching} onClick={() => void staffing.refetch()}>{c("Retry staffing status", "Reintentar estado del personal")}</button></p>}
      {alerts.map(alert => <GateStaffingAlertCard key={`${staffing.scope}:${alert.id}`} alert={alert} paused={staffing.data?.notificationsPaused} queryKey={staffing.queryKey} />)}
      {!staffing.isPending && !staffing.isError && !alerts.length && <p>{c("No current staffing gaps or unassigned watches within the next 24 hours.", "No hay faltas actuales ni guardias sin asignar en las próximas 24 horas.")}</p>}
    </div>
  </details>;
}
