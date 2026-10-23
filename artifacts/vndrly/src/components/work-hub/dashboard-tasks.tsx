import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Bell, CheckCircle2, CheckSquare2, ChevronRight, CirclePause, ClockAlert, PlayCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { workHubRequest } from "@/lib/work-hub-client";
import { dashboardTaskGroup, readDashboardTasks, taskElapsed, type DashboardTaskGroup } from "@/lib/dashboard-tasks";
import DashboardShiftHours from "./dashboard-shift-hours";
import { WorkspacePanel, WorkspaceRow } from "./workspace-panel";

/** The server returns personal tasks or the authorized company's complete task list. */
export default function DashboardTasks() {
  const { user } = useAuth(), { i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const [panel, setPanel] = useState<DashboardTaskGroup | "hours" | null>(null);
  const [now, setNow] = useState(Date.now);
  const tasks = useQuery({ queryKey: ["work-hub", "dashboard-tasks", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, user?.role, user?.vendorRole],
    queryFn: ({ signal }) => readDashboardTasks(path => workHubRequest(path, { signal, cache: "no-store" })), enabled: Boolean(user), retry: false, refetchInterval: 15000 });
  useEffect(() => setPanel(null), [user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, user?.role, user?.vendorRole]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const company = tasks.data?.scope === "company";
  const rows = [
    { key: "new" as const, icon: Bell, label: c("New", "Nuevas") },
    { key: "unstarted" as const, icon: CirclePause, label: c("Unstarted", "Sin iniciar") },
    { key: "progress" as const, icon: PlayCircle, label: c("In Progress", "En curso") },
    ...(company ? [{ key: "stale" as const, icon: ClockAlert, label: c("Stale", "Estancadas") }] : []),
    { key: "completed" as const, icon: CheckCircle2, label: c("Completed", "Completadas") },
  ];
  const toggle = (next: typeof panel) => setPanel(panel === next ? null : next);
  return <WorkspacePanel title={c("Tasks", "Tareas")} subtitle={c("A task is an unticketed work assignment", "Una tarea es una asignación de trabajo sin ticket")} icon={CheckSquare2}>
    {rows.map(row => {
      const group = tasks.data?.tasks.filter(task => dashboardTaskGroup(task, company, now) === row.key);
      const mine = group?.filter(task => task.assigneeUserId === user?.userId).length;
      const value = tasks.isError ? c("Unavailable", "No disponible") : !group ? c("Loading…", "Cargando…") : company
        ? <><span className="hub-task-mine">{mine} {c("mine", "mías")}</span> | {group.length} {c("total", "total")}</> : String(group.length);
      return <div className="hub-task-group" key={row.key}>
        <WorkspaceRow icon={row.icon} label={row.label} value={value} onClick={() => toggle(row.key)} expanded={panel === row.key} />
        {panel === row.key && <div className="hub-inline-panel hub-task-list" role="region" aria-label={c("Assigned task details", "Detalles de tareas asignadas")}>
          {group?.map(task => {
            const elapsed = taskElapsed(task, now), own = company && task.assigneeUserId === user?.userId;
            return <Link className={`hub-mini-record${own ? " hub-task-mine" : ""}`} href={`/work-hub/tasks?task=${encodeURIComponent(task.id)}`} key={task.id}>
              <div><strong>{task.title}</strong><small>{task.assigneeName ?? (task.assigneeUserId ? `${c("Employee", "Empleado")} ${task.assigneeUserId}` : c("Unassigned", "Sin asignar"))} · {task.status.replaceAll("_", " ")}</small>
                <small>{elapsed ? task.status === "completed" ? `${c("Completed in", "Completada en")} ${elapsed}` : `${c("Assigned", "Asignada hace")} ${elapsed}${es ? "" : " ago"}` : c("Elapsed time unavailable", "Tiempo transcurrido no disponible")}</small></div><ChevronRight aria-hidden="true" />
            </Link>;
          })}
          {tasks.isError ? <p role="status">{c("Task records are unavailable.", "Los registros de tareas no están disponibles.")}</p> : group?.length === 0 && <p>{c("No assigned tasks in this status.", "No hay tareas asignadas con este estado.")}</p>}
        </div>}
      </div>;
    })}
    <DashboardShiftHours key={JSON.stringify([user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId])} expanded={panel === "hours"} onToggle={() => toggle("hours")} />
  </WorkspacePanel>;
}
