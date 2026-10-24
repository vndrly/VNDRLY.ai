import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { ChevronRight, Clock3 } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { isWorkHubAdmin, ownerForUser, workHubRequest } from "@/lib/work-hub-client";
import { readDashboardShiftHours, readCompanyDashboardHours, formatRecordedHours, monthlyShiftHoursRange } from "@/lib/dashboard-shift-hours";
import { recordedShiftCalendarHref } from "@/lib/calendar-day-link";
import { WorkspaceRow } from "./workspace-panel";

export default function DashboardShiftHours({ expanded, onToggle }: { expanded: boolean; onToggle: () => void }) {
  const { user } = useAuth(), { i18n } = useTranslation(), owner = ownerForUser(user);
  const es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const range = monthlyShiftHoursRange(), lastDay = new Date(range.end); lastDay.setDate(lastDay.getDate() - 1);
  const company = !user?.managedSubcontractor && (user?.role === "admin" ||
    !["gatekeeper", "gate_supervisor"].includes(user?.vendorRole ?? "") && (isWorkHubAdmin(user) || ["office", "both"].includes(user?.vendorRole ?? "")));
  const hours = useQuery({
    queryKey: ["work-hub", "dashboard-shift-hours", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, range.start, range.end],
    queryFn: ({ signal }) => readDashboardShiftHours({ userId: user!.userId, owner: owner!, ...range }, path => workHubRequest(path, { signal, cache: "no-store" })),
    enabled: Boolean(user && owner && !company), retry: false, refetchInterval: 15000,
  });
  const companyHours = useQuery({
    queryKey: ["work-hub", "dashboard-company-hours", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, range.start, range.end],
    queryFn: ({ signal }) => readCompanyDashboardHours({ userId: user!.userId, owner: owner!, ...range }, path => workHubRequest(path, { signal, cache: "no-store" })),
    enabled: Boolean(user && owner && company), retry: false, refetchInterval: 15000,
  });
  const value = company ? companyHours.isError ? c("Unavailable", "No disponible") : companyHours.data
    ? <span className="hub-hours-totals"><span className="hub-hours-mine">{formatRecordedHours(companyHours.data.mineMilliseconds)} {c("mine", "mías")}</span> | {formatRecordedHours(companyHours.data.totalMilliseconds)} {c("total", "total")}</span>
    : c("Loading…", "Cargando…") : hours.isError ? c("Unavailable", "No disponible") : hours.data
    ? `${formatRecordedHours(hours.data.milliseconds)} ${c("this month", "este mes")}${hours.data.state === "on_break" ? c(" · on break", " · en descanso") : ""}`
    : c("Loading…", "Cargando…");
  return <>
    <WorkspaceRow icon={Clock3} label={c("Hours", "Horas")} value={value} onClick={onToggle} expanded={expanded} />
    {expanded && <div className="hub-inline-panel" role="region" aria-label={company ? c("Employee shift hours", "Horas de turno por empleado") : c("My shift hours", "Mis horas de turno")}>
      <p>{new Date(range.start).toLocaleDateString(undefined, { dateStyle: "medium" })} – {lastDay.toLocaleDateString(undefined, { dateStyle: "medium" })}</p>
      {company ? companyHours.isError ? <p role="status">{c("Employee hours are unavailable.", "Las horas de los empleados no están disponibles.")}</p> : companyHours.isPending ? <p role="status">{c("Loading employee hours…", "Cargando horas de empleados…")}</p> : <>
        <div className="hub-hours-shifts">
          {companyHours.data.employees.map(person => <div className={`hub-mini-record hub-hours-person${person.userId === user?.userId ? " hub-hours-mine" : ""}`} key={person.userId}>
            <div><strong>{person.name}</strong>{person.userId === user?.userId && <small>{c("Me", "Yo")}</small>}</div><span>{formatRecordedHours(person.milliseconds)}</span>
          </div>)}
        </div>
        <p>{c("Recorded hours this month, including active shift time and excluding unpaid breaks. Total includes your hours.", "Horas registradas este mes, incluido el turno activo y sin descansos no remunerados. El total incluye sus horas.")}</p>
      </> : hours.isError ? <p role="status">{c("Shift records are unavailable.", "Los registros de turnos no están disponibles.")}</p> : hours.isPending ? <p role="status">{c("Loading shifts…", "Cargando turnos…")}</p> : <>
        <div className="hub-hours-shifts">
          {hours.data?.shifts.map(shift => <Link className="hub-mini-record" key={shift.id} href={recordedShiftCalendarHref(shift)}>
            <div><strong>{new Date(shift.startedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}</strong><small>{shift.endedAt ? `${c("Ended", "Finalizó")} ${new Date(shift.endedAt).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` : shift.state === "on_break" ? c("On unpaid break", "En descanso no remunerado") : c("Shift in progress", "Turno en curso")}</small></div>
            <span>{formatRecordedHours(shift.milliseconds)}</span><ChevronRight aria-hidden="true" />
          </Link>)}
        </div>
        {!hours.data?.shifts.length && <p>{c("No recorded shifts in these dates.", "No hay turnos registrados en estas fechas.")}</p>}
        {!!hours.data?.shifts.length && <p>{c("Hours within these dates, excluding unpaid breaks. Select a shift to open its calendar day.", "Horas dentro de estas fechas, sin descansos no remunerados. Seleccione un turno para abrir su día en el calendario.")}</p>}
      </>}
    </div>}
  </>;
}
