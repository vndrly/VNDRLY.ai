export type DashboardTask = {
  id: string; title: string; status: string; assigneeUserId?: number | null;
  assigneeName?: string | null; createdAt: string; assignedAt?: string | null; completedAt?: string | null;
  siteName?: string; gateName?: string;
  version?: number; ownerOrgType?: "vendor" | "partner"; ownerOrgId?: number;
  gateHopper?: { completedById?: number; completedAt?: string; clearedAt?: string } | null;
};
export type DashboardTaskPage = { tasks: DashboardTask[]; scope: "self" | "company"; nextCursor: string | null };
export type DashboardTaskGroup = "new" | "unassigned" | "unstarted" | "progress" | "stale" | "completed";
const HOUR = 3600000;

function unfinished(task: DashboardTask) {
  return !task.gateHopper?.clearedAt && ["new", "open", "assigned", "pending", "in_progress", "started", "active"].includes(task.status);
}
export function isUnassignedDashboardTask(task: DashboardTask) {
  return unfinished(task) && !task.assigneeUserId;
}
export function isStaleDashboardTask(task: DashboardTask, now: number) {
  return unfinished(task) && now - Date.parse(task.createdAt) > 30 * 24 * HOUR;
}
export function dashboardTasksForGroup(tasks: DashboardTask[], group: DashboardTaskGroup, company: boolean, now: number) {
  // Stale is an age view: old unassigned tasks remain in the hopper as well.
  return tasks.filter(task => group === "unassigned" ? isUnassignedDashboardTask(task) : dashboardTaskGroup(task, company, now) === group)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
}
export function dashboardTaskGroup(task: DashboardTask, _company: boolean, now: number): DashboardTaskGroup | null {
  if (task.gateHopper?.clearedAt) return null;
  if (task.status === "completed") return "completed";
  const unstarted = ["new", "open", "assigned", "pending"].includes(task.status);
  const progress = ["in_progress", "started", "active"].includes(task.status);
  if (!unstarted && !progress) return null;
  const age = now - Date.parse(task.assignedAt ?? task.createdAt);
  if (isStaleDashboardTask(task, now)) return "stale";
  if (isUnassignedDashboardTask(task)) return "unassigned";
  if (progress) return "progress";
  return age >= 0 && age < 48 * HOUR ? "new" : "unstarted";
}

export async function readDashboardUnassigned(request: (path: string) => Promise<{ tasks: DashboardTask[]; nextBefore: string | null }>) {
  const tasks: DashboardTask[] = [], seen = new Set<string>();
  let before: string | null = null;
  do {
    let page;
    try { page = await request(`/gate-task-hopper${before ? `?before=${encodeURIComponent(before)}` : ""}`); }
    catch (error) { if ((error as { status?: number }).status === 403) return []; throw error; }
    tasks.push(...page.tasks);
    before = page.nextBefore;
    if (before && seen.has(before)) throw new Error("Repeated hopper cursor");
    if (before) seen.add(before);
  } while (before);
  return tasks;
}

export function taskElapsed(task: DashboardTask, now: number): string | null {
  const start = Date.parse(isUnassignedDashboardTask(task) ? task.createdAt : task.assignedAt ?? task.createdAt);
  const end = task.status === "completed" ? Date.parse(task.completedAt ?? "") : now;
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const minutes = Math.floor((end - start) / 60000), hours = Math.floor(minutes / 60), days = Math.floor(hours / 24);
  return days ? `${days}d ${hours % 24}h` : hours ? `${hours}h ${minutes % 60}m` : `${minutes}m`;
}

export async function readDashboardTasks(request: (path: string) => Promise<DashboardTaskPage>) {
  let cursor: string | null = null, scope: DashboardTaskPage["scope"] | undefined;
  const tasks: DashboardTask[] = [], seen = new Set<string>();
  do {
    const page = await request(`/tasks?dashboard=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    if (scope && scope !== page.scope) throw new Error("Task scope changed");
    scope = page.scope;
    tasks.push(...page.tasks);
    cursor = page.nextCursor;
    if (cursor && seen.has(cursor)) throw new Error("Repeated task cursor");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return { tasks, scope };
}
