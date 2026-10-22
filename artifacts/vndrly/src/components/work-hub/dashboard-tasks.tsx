import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Link } from "wouter";
import { Bell, CheckCircle2, CheckSquare2, ChevronRight, Clock3, PlayCircle } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";
import { workHubRequest } from "@/lib/work-hub-client";
import { WorkspacePanel, WorkspaceRow } from "./workspace-panel";

type Task = { id: string; title: string; status: string; assigneeUserId?: number | null };

/** The authenticated home source applies organization and task visibility permissions. */
export default function DashboardTasks() {
  const { user } = useAuth(), { i18n } = useTranslation();
  const es = (i18n?.language ?? "en").startsWith("es"), c = (en: string, spanish: string) => es ? spanish : en;
  const [panel, setPanel] = useState<"new" | "progress" | "completed" | null>(null);
  const home = useQuery<{ tasks: Task[] }>({ queryKey: ["work-hub", "home", user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId], queryFn: () => workHubRequest("/home"), enabled: Boolean(user), retry: false, refetchInterval: 15000 });
  useEffect(() => setPanel(null), [user?.userId, user?.activeMembershipId, user?.vendorId, user?.partnerId]);
  const assigned = home.data?.tasks?.filter(task => task.assigneeUserId === user?.userId);
  const groups = {
    new: assigned?.filter(task => ["new", "open", "assigned", "pending"].includes(task.status)),
    progress: assigned?.filter(task => ["in_progress", "started", "active"].includes(task.status)),
    completed: assigned?.filter(task => task.status === "completed"),
  };
  const toggle = (next: typeof panel) => setPanel(panel === next ? null : next);
  return <WorkspacePanel title={c("Tasks", "Tareas")} subtitle={c("Your assigned work without a ticket", "Su trabajo asignado sin ticket")} icon={CheckSquare2}>
    <WorkspaceRow icon={Bell} label={c("New", "Nuevas")} value={groups.new ? String(groups.new.length) : c("Unavailable", "No disponible")} onClick={() => toggle("new")} expanded={panel === "new"} />
    <WorkspaceRow icon={PlayCircle} label={c("In Progress", "En curso")} value={groups.progress ? String(groups.progress.length) : c("Unavailable", "No disponible")} onClick={() => toggle("progress")} expanded={panel === "progress"} />
    <WorkspaceRow icon={CheckCircle2} label={c("Completed", "Completadas")} value={groups.completed ? String(groups.completed.length) : c("Unavailable", "No disponible")} onClick={() => toggle("completed")} expanded={panel === "completed"} />
    <WorkspaceRow icon={Clock3} label={c("Hours", "Horas")} value={c("Not recorded", "Sin registro")} href="/work-hub/tasks" />
    {panel && <div className="hub-inline-panel" role="region" aria-label={c("Assigned task details", "Detalles de tareas asignadas")}>
      {groups[panel]?.map(task => <Link className="hub-mini-record" href={`/work-hub/tasks?task=${encodeURIComponent(task.id)}`} key={task.id}><div><strong>{task.title}</strong><small>{task.status.replaceAll("_", " ")}</small></div><ChevronRight aria-hidden="true" /></Link>)}
      {!assigned ? <p role="status">{c("Task records are unavailable.", "Los registros de tareas no están disponibles.")}</p> : !groups[panel]?.length && <p>{c("No assigned tasks in this status.", "No hay tareas asignadas con este estado.")}</p>}
    </div>}
  </WorkspacePanel>;
}
