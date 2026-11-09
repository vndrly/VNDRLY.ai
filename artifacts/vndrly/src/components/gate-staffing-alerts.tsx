import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { GateStaffingAlert } from "@workspace/gate-booth";
import { PngPillButton } from "@/components/png-pill-rollover";
import { useAcknowledgeGateStaffingAlert, useGateStaffingAlerts } from "@/hooks/use-gate-staffing-alerts";
import { useNextSteps } from "./next-steps";
import { useGuidedTarget } from "./guided-target";
import { gateGuideMatches, gateGuideScope, gateStaffingTarget } from "@/lib/gate-operational-helpers";

export function GateStaffingAlertCard({ alert, paused = false, allowAcknowledge = false, queryKey, onNavigate }: {
  alert: GateStaffingAlert; paused?: boolean; allowAcknowledge?: boolean;
  queryKey: readonly unknown[]; onNavigate?: () => void;
}) {
  const { i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const [confirm, setConfirm] = useState(false);
  const acknowledgment = useAcknowledgeGateStaffingAlert(queryKey);
  const held = paused || alert.notificationsPaused;
  const critical = alert.severity === "critical";
  const pulse = !held && critical && alert.status === "open";
  const time = (value: string) => new Date(value).toLocaleString(es ? "es" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: alert.timezone });
  const canAcknowledge = allowAcknowledge && !held && alert.canAcknowledge && alert.status === "open";
  const helper = useNextSteps();
  const context = { siteId: alert.siteId, stationId: alert.stationId, shiftId: alert.shiftId, alertId: alert.id, siteName: alert.siteName, stationName: alert.gateName, day: new URL(alert.href, "https://vndrly.ai").searchParams.get("date") ?? undefined };
  const scopeId = gateGuideScope("staffing", context);
  const guide = gateStaffingTarget({ ...alert, paused: held });
  const activeGuide = allowAcknowledge && gateGuideMatches(helper?.selected, "gate-staffing-recovery", context);
  useGuidedTarget(guide && { ...guide, scopeId, targetId: confirm && guide.targetId === "acknowledge" ? "confirm-acknowledgment" : guide.targetId }, activeGuide && !acknowledgment.isPending, 40);
  return <article data-guidance-scope={scopeId} data-testid={`staffing-alert-${alert.id}`} data-severity={held ? "neutral" : alert.severity}
    className={`rounded-lg border-2 p-4 text-sm ${held ? "border-current/20" : critical ? "border-red-500 bg-red-950 text-white" : "border-amber-500 bg-amber-950 text-white"} ${pulse ? "motion-safe:animate-pulse" : ""}`}>
    <p className="font-bold">{held ? c("Recorded staffing · notifications paused", "Personal registrado · notificaciones pausadas") : critical ? c("Critical coverage gap", "Falta crítica de cobertura") : c("Upcoming staffing warning", "Aviso de personal próximo")}</p>
    <h3 className="mt-1 font-bold">{alert.title}</h3>
    <p>{alert.siteName} · {alert.gateName}</p>
    <p><time dateTime={alert.startsAt}>{time(alert.startsAt)}</time> — <time dateTime={alert.endsAt}>{time(alert.endsAt)}</time> · {alert.timezone}</p>
    {critical ? <p className="mt-2">{c(`${alert.actualCount} of ${alert.requiredCount} required gatekeepers are on watch. ${Math.max(0, alert.requiredCount - alert.actualCount)} more needed.`, `${alert.actualCount} de ${alert.requiredCount} guardias requeridos están de vigilancia. Faltan ${Math.max(0, alert.requiredCount - alert.actualCount)}.`)}</p>
      : <p className="mt-2">{alert.kind === "watch_radar" ? c("No one is assigned. Arrange coverage before this watch starts.", "No hay nadie asignado. Organiza la cobertura antes de que comience esta guardia.") : c("This scheduled watch still needs confirmation.", "Esta guardia programada aún necesita confirmación.")}</p>}
    {alert.status === "acknowledged" && <p role="status" className="mt-2 font-semibold">
      {c(`Acknowledged by ${alert.acknowledgedBy?.name ?? "a company admin"}`, `Reconocido por ${alert.acknowledgedBy?.name ?? "un administrador"}`)}{alert.acknowledgedAt && <> · <time dateTime={alert.acknowledgedAt}>{time(alert.acknowledgedAt)}</time></>}
      <span className="block font-normal">{c("Reminders stopped for everyone. Coverage is still unresolved.", "Se detuvieron los recordatorios para todos. La cobertura sigue pendiente.")}</span>
    </p>}
    {!held && <p className="mt-2">{c("Assigning someone does not restore coverage. A saved active watch is required.", "Asignar a alguien no restablece la cobertura. Se requiere una guardia activa guardada.")}</p>}
    <div className="mt-3 flex flex-wrap items-center gap-3">
      <a data-guidance-id="calendar" href={alert.href} onClick={onNavigate} className="font-semibold underline underline-offset-4">{c("Open staffing calendar", "Abrir calendario de personal")}</a>
      {canAcknowledge && !confirm && <PngPillButton data-guidance-id="acknowledge" color="blue" onClick={() => { acknowledgment.reset(); setConfirm(true); }}>{c("Acknowledge responsibility", "Reconocer responsabilidad")}</PngPillButton>}
      {helper?.enabled && allowAcknowledge && <button type="button" className="underline underline-offset-4" onClick={() => helper.startHelper("gate-staffing-recovery", context)}>{c("Guide coverage recovery", "Guiar recuperación de cobertura")}</button>}
    </div>
    {canAcknowledge && confirm && <div className="mt-3 space-y-2 border-t border-current/30 pt-3" role="group" aria-label={c("Confirm staffing acknowledgment", "Confirmar reconocimiento de personal")}>
      <p>{c("Take responsibility for arranging coverage? This stops reminders for all admins. The gap remains open until actual watch coverage is saved.", "¿Aceptar la responsabilidad de organizar la cobertura? Esto detiene los recordatorios para todos los administradores. La falta de cobertura continúa hasta que se guarde una guardia real.")}</p>
      <div className="flex flex-wrap gap-3"><PngPillButton data-guidance-id="confirm-acknowledgment" color="blue" disabled={acknowledgment.isPending} onClick={() => acknowledgment.mutate(alert.id)}>{acknowledgment.isPending ? c("Saving acknowledgment…", "Guardando reconocimiento…") : c("Confirm acknowledgment", "Confirmar reconocimiento")}</PngPillButton>
      <PngPillButton color="blue" disabled={acknowledgment.isPending} onClick={() => { setConfirm(false); acknowledgment.reset(); }}>{c("Cancel", "Cancelar")}</PngPillButton></div>
      {acknowledgment.error && <p role="alert">{acknowledgment.error instanceof Error ? acknowledgment.error.message : c("Acknowledgment was not confirmed. Retry.", "No se confirmó el reconocimiento. Reintentar.")}</p>}
    </div>}
  </article>;
}

/** The bell uses this list even when ordinary notifications are already read. */
export default function GateStaffingAlerts({ onNavigate }: { onNavigate?: () => void }) {
  const staffing = useGateStaffingAlerts();
  const { i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  if (staffing.data?.notificationsPaused) return null;
  const alerts = (staffing.data?.alerts ?? []).filter(alert => alert.status !== "resolved" && !alert.notificationsPaused);
  if (!staffing.isPending && !staffing.isError && !alerts.length) return null;
  return <section className="max-h-[50dvh] shrink-0 space-y-3 overflow-y-auto p-3" aria-label={c("Gate staffing alerts", "Avisos de personal del acceso")}>
    {staffing.isPending && <p role="status">{c("Loading staffing status…", "Cargando estado del personal…")}</p>}
    {staffing.isError && <p role="status">{c("Staffing status could not load.", "No se pudo cargar el estado del personal.")} <button type="button" className="underline" disabled={staffing.isFetching} onClick={() => void staffing.refetch()}>{c("Retry staffing status", "Reintentar estado del personal")}</button></p>}
    {alerts.map(alert => <GateStaffingAlertCard key={`${staffing.scope}:${alert.id}`} alert={alert} queryKey={staffing.queryKey} allowAcknowledge onNavigate={onNavigate} />)}
  </section>;
}
