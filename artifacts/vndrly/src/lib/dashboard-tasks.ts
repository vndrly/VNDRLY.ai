export type DashboardTask = {
  id: string; title: string; status: string; assigneeUserId?: number | null;
  assigneeName?: string | null; createdAt: string; assignedAt?: string | null; completedAt?: string | null;
  gateHopper?: { completedById?: number; completedAt?: string; clearedAt?: string } | null;
};
export type DashboardTaskPage = { tasks: DashboardTask[]; scope: "self" | "company"; nextCursor: string | null };
export type DashboardTaskGroup = "new" | "unstarted" | "progress" | "stale" | "completed";
const HOUR = 3600000;

export function dashboardTaskGroup(task: DashboardTask, company: boolean, now: number): DashboardTaskGroup | null {
  if (task.gateHopper && !task.assigneeUserId && task.status !== "completed") return null;
  if (task.status === "completed") return "completed";
  const unstarted = ["new", "open", "assigned", "pending"].includes(task.status);
  const progress = ["in_progress", "started", "active"].includes(task.status);
  if (!unstarted && !progress) return null;
  const age = now - Date.parse(task.assignedAt ?? task.createdAt);
  if (company && age > 30 * 24 * HOUR) return "stale";
  if (progress) return "progress";
  return age >= 0 && age < 48 * HOUR ? "new" : "unstarted";
}

export function taskElapsed(task: DashboardTask, now: number): string | null {
  const start = Date.parse(task.assignedAt ?? task.createdAt);
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
