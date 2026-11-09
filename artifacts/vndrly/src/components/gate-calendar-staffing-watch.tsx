import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/use-auth";
import { useGateStaffingAlerts } from "@/hooks/use-gate-staffing-alerts";
import { calendarDayFromSearch } from "@/lib/calendar-day-link";
import { canAdministerCalendar } from "@/lib/calendar-action-permissions";
import GateWatchLink from "./gate-watch-link";

/** Cover the saved calendar gate personally through the existing watch review. */
export default function GateCalendarStaffingWatch({ search }: { search: string }) {
  const { user } = useAuth(), { i18n } = useTranslation();
  const staffing = useGateStaffingAlerts();
  const es = (i18n?.language ?? "en").startsWith("es");
  const c = (en: string, spanish: string) => es ? spanish : en;
  const params = new URLSearchParams(search);
  const date = calendarDayFromSearch(search), siteId = Number(params.get("siteId")), stationId = params.get("stationId"), shiftId = params.get("shiftId");
  if (!canAdministerCalendar(user) || !date || !siteId || !stationId || !shiftId) return null;
  const alert = staffing.data?.alerts.find(alert => alert.status !== "resolved" && alert.siteId === siteId && alert.stationId === stationId && alert.shiftId === shiftId
    && calendarDayFromSearch(alert.href.split("?")[1] ?? "") === date);
  if (staffing.isPending) return <p role="status">{c("Loading the saved calendar gate…", "Cargando el acceso guardado del calendario…")}</p>;
  if (staffing.isError) return <p role="status">{c("The saved calendar gate could not load.", "No se pudo cargar el acceso guardado del calendario.")} <button type="button" onClick={() => void staffing.refetch()}>{c("Retry staffing status", "Reintentar estado del personal")}</button></p>;
  if (!alert) return <p role="status">{c("This staffing link is no longer current. Review the saved calendar below.", "Este enlace de personal ya no está vigente. Revisa el calendario guardado abajo.")}</p>;
  return <section className="space-y-3 rounded-lg border border-current/20 p-4" aria-label={c("Cover this calendar watch", "Cubrir esta guardia del calendario")}>
    <h2 className="font-semibold">{alert.siteName} · {alert.gateName} · {alert.title}</h2>
    <p>{date} · {alert.timezone}</p>
    <p>{c("You can cover personally if your current Gate permissions allow it. Review the gate and explicitly assume the watch below.", "Puedes cubrir personalmente si tus permisos actuales lo permiten. Revisa el acceso y asume explícitamente la vigilancia abajo.")}</p>
    <GateWatchLink key={`${staffing.scope}:${alert.id}`} siteId={alert.siteId} stationId={alert.stationId} calendarContext={{ shiftId: alert.shiftId, date, startsAt: alert.startsAt, endsAt: alert.endsAt }} />
    <p>{c("You can return to Admin or Work Hub while your saved watch stays active. Only an explicit handoff or release ends it.", "Puedes regresar a Administración o Centro de trabajo mientras tu guardia guardada sigue activa. Solo un relevo o entrega explícitos la terminan.")}</p>
  </section>;
}
