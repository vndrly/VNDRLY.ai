import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Bell, CheckCircle2, CheckSquare2, ChevronRight, CirclePause, ClipboardList, ClockAlert, PlayCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { workHubRequest } from "@/lib/work-hub-client";
import { dashboardTasksForGroup, isStaleDashboardTask, isUnassignedDashboardTask, readDashboardTasks, readDashboardUnassigned, taskElapsed, type DashboardTaskGroup } from "@/lib/dashboard-tasks";
import DashboardShiftHours from "./dashboard-shift-hours";
import DashboardTaskAssignment from "./dashboard-task-assignment";
import DashboardTaskCompletion from "./dashboard-task-completion";
import { WorkspacePanel, WorkspaceRow } from "./workspace-panel";

/** The server returns personal tasks or the authorized company's complete task list. */
export default function DashboardTasks() {
  const { user } = useAuth(), { i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const [panel, setPanel] = useState<DashboardTaskGroup | "hours" | null>(null);
  const [now, setNow] = useState(Date.now);
  const tasks = useQuery({ queryKey: ["work-hub", "dashboard-tasks", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, user?.role, user?.vendorRole],
    queryFn: ({ signal }) => readDashboardTasks(path => workHubRequest(path, { signal, cache: "no-store" })), enabled: Boolean(user), retry: false, refetchInterval: 15000 });
  const hopper = useQuery({ queryKey: ["work-hub", "dashboard-unassigned", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, user?.role, user?.vendorRole],
    queryFn: ({ signal }) => readDashboardUnassigned(path => workHubRequest(path, { signal, cache: "no-store" })), enabled: Boolean(user), retry: false, refetchInterval: 15000 });
  useEffect(() => setPanel(null), [user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId, user?.role, user?.vendorRole]);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(timer); }, []);
  const company = tasks.data?.scope === "company";
  const allTasks = [...new Map([...(tasks.data?.tasks ?? []), ...(hopper.data ?? [])].map(task => [task.id, task])).values()];
  const rows = [
    { key: "new" as const, icon: Bell, label: c("New", "Nuevas") },
    { key: "unassigned" as const, icon: ClipboardList, label: c("Unassigned", "Sin asignar") },
    { key: "unstarted" as const, icon: CirclePause, label: c("Unstarted", "Sin iniciar") },
    { key: "progress" as const, icon: PlayCircle, label: c("In Progress", "En curso") },
    { key: "stale" as const, icon: ClockAlert, label: c("Stale", "Estancadas") },
    { key: "completed" as const, icon: CheckCircle2, label: c("Completed", "Completadas") },
  ];
  const toggle = (next: typeof panel) => setPanel(panel === next ? null : next);
  return <WorkspacePanel title={c("Tasks", "Tareas")} subtitle={c("A task is an unticketed work assignment", "Una tarea es una asignación de trabajo sin ticket")} icon={CheckSquare2}>
    {rows.map(row => {
      const needsHopper = row.key === "unassigned" || row.key === "stale";
      const failed = tasks.isError || needsHopper && hopper.isError;
      const group = tasks.data && (!needsHopper || hopper.data) ? dashboardTasksForGroup(allTasks, row.key, company, now) : undefined;
      const mine = group?.filter(task => (task.gateHopper?.completedById ?? task.assigneeUserId) === user?.userId).length;
      const unassigned = group?.filter(isUnassignedDashboardTask).length;
      const value = failed ? c("Unavailable", "No disponible") : !group ? c("Loading…", "Cargando…") : row.key === "unassigned" ? <span className="hub-task-unassigned-total">{group.length} {c("total", "total")}</span> : <>
        {company && <><span className="hub-task-mine">{mine} {c("mine", "mías")}</span> | </>}{group.length}{company || row.key === "stale" ? ` ${c("total", "total")}` : ""}
        {row.key === "stale" && <> | <span className="hub-task-unassigned-total">{unassigned} {c("unassigned", "sin asignar")}</span></>}</>;
      return <div className={`hub-task-group${row.key === "stale" ? " hub-task-group-stale" : ""}`} key={row.key}>
        <WorkspaceRow icon={row.icon} label={row.label} value={value} onClick={() => toggle(row.key)} expanded={panel === row.key} />
        {panel === row.key && <div className="hub-inline-panel hub-task-list" role="region" aria-label={c("Assigned task details", "Detalles de tareas asignadas")}>
          {group?.map(task => {
            const elapsed = taskElapsed(task, now), own = company && (task.gateHopper?.completedById ?? task.assigneeUserId) === user?.userId;
            const staleUnassigned = isUnassignedDashboardTask(task) && isStaleDashboardTask(task, now);
            return <div className={`hub-task-record${own ? " hub-task-mine" : ""}${staleUnassigned ? " hub-task-stale" : ""}`} key={task.id}><Link className={`hub-mini-record${own ? " hub-task-mine" : ""}${staleUnassigned ? " hub-task-stale" : ""}`} href={`/work-hub/tasks?task=${encodeURIComponent(task.id)}`}>
              <div><strong>{task.title}</strong><div className="hub-task-meta"><small>{task.assigneeName ?? (task.assigneeUserId ? `${c("Employee", "Empleado")} ${task.assigneeUserId}` : c("Unassigned", "Sin asignar"))} · {task.status.replaceAll("_", " ")}</small>
                <small className="hub-task-elapsed">{elapsed ? task.status === "completed" ? `${c("Completed in", "Completada en")} ${elapsed}` : `${isUnassignedDashboardTask(task) ? c("Created", "Creada hace") : c("Assigned", "Asignada hace")} ${elapsed}${es ? "" : " ago"}` : c("Elapsed time unavailable", "Tiempo transcurrido no disponible")}{staleUnassigned && ` · ${c("Over 30 days", "Más de 30 días")}`}</small></div>
                {task.siteName && <small>{task.siteName}{task.gateName ? ` · ${task.gateName}` : ""}</small>}
                </div><ChevronRight aria-hidden="true" />
            </Link><div className="hub-task-footer">
              {company && !["completed", "cancelled"].includes(task.status) && <DashboardTaskAssignment task={task} />}
              <DashboardTaskCompletion task={task} />
            </div></div>;
          })}
          {failed ? <p role="status">{c("Task records are unavailable.", "Los registros de tareas no están disponibles.")}</p> : group?.length === 0 && <p>{c("No tasks in this status.", "No hay tareas con este estado.")}</p>}
        </div>}
      </div>;
    })}
    <DashboardShiftHours key={JSON.stringify([user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId])} expanded={panel === "hours"} onToggle={() => toggle("hours")} />
  </WorkspacePanel>;
}
