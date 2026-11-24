import React, { useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { router } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/hooks/use-auth";
import { apiFetch } from "@/lib/api";
import { useGateCopy } from "@/components/gate/GateChrome";
import { WorkspacePanel, WorkspaceRow } from "./WorkspacePanel";
import HomeTaskActions, { type HomeTask } from "./HomeTaskActions";
import HomeShiftHours from "./HomeShiftHours";
import HomeTaskCardRow, { TaskIcon } from "./HomeTaskCardRow";
import HomeTaskCardRecord from "./HomeTaskCardRecord";

type Group = "new" | "unassigned" | "unstarted" | "progress" | "stale" | "completed";
type Task = HomeTask;
type Summary = { scope: "self" | "company"; groups: Record<Group, { mine: number; total: number; unassigned: number }> };
type Page = { tasks: Task[]; scope: "self" | "company"; nextCursor: string | null };
const groups: { key: Group; icon: React.ComponentProps<typeof import("@expo/vector-icons").Feather>["name"]; en: string; es: string }[] = [
  { key: "new", icon: "bell", en: "New", es: "Nuevas" },
  { key: "unassigned", icon: "clipboard", en: "Unassigned", es: "Sin asignar" },
  { key: "unstarted", icon: "pause-circle", en: "Unstarted", es: "Sin iniciar" },
  { key: "progress", icon: "play-circle", en: "In Progress", es: "En curso" },
  { key: "stale", icon: "alert-circle", en: "Stale", es: "Estancadas" },
  { key: "completed", icon: "check-circle", en: "Completed", es: "Completadas" },
];
const unfinished = (task: Task) => !task.gateHopper?.clearedAt && ["new", "open", "assigned", "pending", "in_progress", "started", "active"].includes(task.status);
const unassigned = (task: Task) => unfinished(task) && !task.assigneeUserId;
const stale = (task: Task, now: number) => unfinished(task) && now - Date.parse(task.createdAt) > 30 * 86400000;
const elapsed = (task: Task, now: number) => {
  const start = Date.parse(unassigned(task) ? task.createdAt : task.assignedAt ?? task.createdAt);
  const end = task.status === "completed" ? Date.parse(task.completedAt ?? "") : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const minutes = Math.floor((end - start) / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  return days ? `${days}d ${hours % 24}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
};
function taskGroup(task: Task, now: number): Group | null {
  if (task.gateHopper?.clearedAt) return null;
  if (task.status === "completed") return "completed";
  const unstarted = ["new", "open", "assigned", "pending"].includes(task.status);
  const progress = ["in_progress", "started", "active"].includes(task.status);
  if (!unstarted && !progress) return null;
  if (stale(task, now)) return "stale";
  if (unassigned(task)) return "unassigned";
  if (progress) return "progress";
  const age = now - Date.parse(task.assignedAt ?? task.createdAt);
  return age >= 0 && age < 48 * 3600000 ? "new" : "unstarted";
}
async function allTasks(): Promise<Page> {
  const tasks: Task[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  let scope: Page["scope"] = "self";
  do {
    const page: Page = await apiFetch(`/api/work-hub/tasks?dashboard=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    scope = page.scope;
    tasks.push(...page.tasks);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Repeated task cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { tasks, scope, nextCursor: null };
}
async function hopperTasks(): Promise<Task[]> {
  const tasks: Task[] = [], seen = new Set<string>();
  let before: string | null = null;
  do {
    let page: { tasks: Task[]; nextBefore: string | null };
    try { page = await apiFetch(`/api/work-hub/gate-task-hopper${before ? `?before=${encodeURIComponent(before)}` : ""}`); }
    catch (error) { if ((error as { status?: number }).status === 403) return []; throw error; }
    tasks.push(...page.tasks);
    before = page.nextBefore;
    if (before && seen.has(before)) throw new Error("Repeated hopper cursor");
    if (before) seen.add(before);
  } while (before);
  return tasks;
}

export default function HomeDashboardTasks({ webCard = false, onPanelChange }: { webCard?: boolean; onPanelChange?: (panel: Group | "hours") => void } = {}) {
  const { user, activeMembershipId } = useAuth();
  const c = useGateCopy();
  const [panel, setPanel] = useState<Group | "hours" | null>(null);
  const identity = [user?.id, activeMembershipId, user?.vendorId, user?.partnerId, user?.role, user?.vendorRole];
  const summary = useQuery({ queryKey: ["work-hub", "dashboard-task-summary", ...identity], queryFn: () => apiFetch<Summary>("/api/work-hub/tasks?dashboard=summary"), enabled: !!user, retry: false, refetchInterval: 15000 });
  const tasks = useQuery({ queryKey: ["work-hub", "dashboard-tasks", ...identity], queryFn: allTasks, enabled: !!user && (!!panel || !summary.data), retry: false, refetchInterval: panel ? 15000 : false });
  const selfScope = summary.data?.scope === "self" || !summary.data && tasks.data?.scope !== "company";
  const hopper = useQuery({ queryKey: ["work-hub", "dashboard-unassigned", ...identity], queryFn: hopperTasks, enabled: !!user && selfScope, retry: false, refetchInterval: 15000 });
  const company = summary.data?.scope === "company" || !summary.data && tasks.data?.scope === "company";
  const all = [...new Map([...(tasks.data?.tasks ?? []), ...(hopper.data ?? [])].map(task => [task.id, task])).values()];
  const now = Date.now();
  return <WorkspacePanel title={c("Tasks", "Tareas")} subtitle={c("A task is an unticketed work assignment", "Una tarea es una asignación de trabajo sin ticket")} icon="check-square" iconElement={webCard ? <TaskIcon kind="tasks" size={20} /> : undefined}>
    {groups.map(group => {
      const matches = all.filter(task => group.key === "unassigned" ? unassigned(task) : taskGroup(task, now) === group.key).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
      const saved = summary.data?.groups[group.key];
      const hopperMatches = hopper.data?.filter(task => group.key === "unassigned" ? unassigned(task) : taskGroup(task, now) === group.key) ?? [];
      const total = saved ? saved.total + (selfScope ? hopperMatches.length : 0) : matches.length;
      const mine = saved ? saved.mine + hopperMatches.filter(task => (task.gateHopper?.completedById ?? task.assigneeUserId) === user?.id).length : matches.filter(task => task.assigneeUserId === user?.id).length;
      const unassignedCount = saved ? saved.unassigned + hopperMatches.filter(unassigned).length : matches.filter(unassigned).length;
      const failed = summary.isError || tasks.isError || selfScope && hopper.isError;
      const loading = !saved && !tasks.data || selfScope && !hopper.data && !hopper.isError;
      const value = failed ? c("Unavailable", "No disponible") : loading ? c("Loading…", "Cargando…") : group.key === "unassigned" ? `${total} ${c("total", "total")}` : `${company ? `${mine} ${c("mine", "mías")} | ` : ""}${total}${company || group.key === "stale" ? ` ${c("total", "total")}` : ""}${group.key === "stale" ? ` | ${unassignedCount} ${c("unassigned", "sin asignar")}` : ""}`;
      return <React.Fragment key={group.key}>
        {webCard ? <HomeTaskCardRow kind={group.key} label={c(group.en, group.es)} value={value} company={!!company} onPress={() => { setPanel(panel === group.key ? null : group.key); onPanelChange?.(group.key); }} expanded={panel === group.key} /> : <WorkspaceRow icon={group.icon} label={c(group.en, group.es)} value={value} onPress={() => { setPanel(panel === group.key ? null : group.key); onPanelChange?.(group.key); }} expanded={panel === group.key} />}
        {panel === group.key ? <ScrollView style={webCard ? { maxHeight: 360 } : undefined} contentContainerStyle={{ borderTopWidth: 1, borderTopColor: "#3a3a3a", paddingLeft: 30, paddingTop: webCard ? 4 : 0, paddingBottom: 10 }}>
          {tasks.isPending ? <Text style={{ color: "#a3a3a3", paddingVertical: 10 }}>{c("Loading task records…", "Cargando registros de tareas…")}</Text> : null}
          {tasks.isError ? <Text style={{ color: "#a3a3a3", paddingVertical: 10 }}>{c("Task records are unavailable.", "Los registros de tareas no están disponibles.")}</Text> : null}
          {!failed && !loading && matches.length === 0 ? <Text style={{ color: "#a3a3a3", paddingVertical: 10 }}>{c("No tasks in this status.", "No hay tareas con este estado.")}</Text> : null}
          {matches.map(task => webCard ? <HomeTaskCardRecord key={task.id} task={task} company={!!company} mine={!!company && (task.gateHopper?.completedById ?? task.assigneeUserId) === user?.id} stale={unassigned(task) && stale(task, now)} elapsed={elapsed(task, now)} /> : <View key={task.id} style={{ borderBottomWidth: 1, borderBottomColor: "#3a3a3a", paddingVertical: 6 }}>
            <WorkspaceRow icon="check-square" label={task.title} onPress={() => router.push(`/work-hub/record?kind=task&id=${encodeURIComponent(task.id)}` as never)} />
            <Text style={{ color: "#a3a3a3", fontSize: 12, paddingLeft: 30 }}>{task.assigneeName ?? (task.assigneeUserId ? `Employee ${task.assigneeUserId}` : c("Unassigned", "Sin asignar"))} · {task.status.replaceAll("_", " ")}</Text>
            <Text style={{ color: "#a3a3a3", fontSize: 12, paddingLeft: 30 }}>{elapsed(task, now) ? `${task.status === "completed" ? "Completed in" : unassigned(task) ? "Created" : "Assigned"} ${elapsed(task, now)}${task.status === "completed" ? "" : " ago"}` : "Elapsed time unavailable"}{unassigned(task) && stale(task, now) ? " · Over 30 days" : ""}</Text>
            {task.siteName ? <Text style={{ color: "#a3a3a3", fontSize: 12, paddingLeft: 30 }}>{task.siteName}{task.gateName ? ` · ${task.gateName}` : ""}</Text> : null}
            <View style={{ paddingLeft: 30 }}><HomeTaskActions task={task} company={!!company} /></View>
          </View>)}
        </ScrollView> : null}
      </React.Fragment>;
    })}
    <HomeShiftHours expanded={panel === "hours"} onToggle={() => { setPanel(panel === "hours" ? null : "hours"); onPanelChange?.("hours"); }} webCard={webCard} />
  </WorkspacePanel>;
}
